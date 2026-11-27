export {};
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { getDataDir } = require('../config/runtime-paths');
const { CONFIG } = require('../config/config');
const { formatDateKeyInTimeZone } = require('../utils/utils');

/**
 * 按天分片的 NDJSON 账本存储，供货币流水、农作物流水、牧场流水共用。
 *
 * 目录布局：<data>/<namespace>/<账号>/<YYYY-MM-DD>.ndjson，逐行追加，读取时跳过写坏的半行。
 * 写入发生在账号 worker 内，读取发生在主进程 API 内，两边只通过磁盘文件交互。
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const DAY_FILE = /^(\d{4}-\d{2}-\d{2})\.ndjson$/;
const lastPrunedDay: Map<string, string> = new Map();

function accountKey(accountId: string): string {
    const id = String(accountId || '').trim();
    if (/^[A-Za-z0-9_-]{1,64}$/.test(id)) return id;
    return crypto.createHash('sha256').update(id).digest('hex').slice(0, 32);
}

function namespaceDir(namespace: string, accountId: string): string {
    return path.join(getDataDir(), namespace, accountKey(accountId));
}

function dateKeyOf(ts: number): string {
    return formatDateKeyInTimeZone(ts, CONFIG.timeZone);
}

function dayFileOf(ts: number): string {
    return `${dateKeyOf(ts)}.ndjson`;
}

function appendEntry(namespace: string, accountId: string, ts: number, entry: any): void {
    const dir = namespaceDir(namespace, accountId);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.appendFileSync(path.join(dir, dayFileOf(ts)), `${JSON.stringify(entry)}\n`, { encoding: 'utf8', mode: 0o600 });
}

/** 读取 startKey 当天及之后的全部条目；损坏行与不可解析的行直接跳过。 */
function readEntries<T = any>(namespace: string, accountId: string, startKey: string, accept?: (entry: any) => boolean): T[] {
    const dir = namespaceDir(namespace, accountId);
    let names: string[] = [];
    try { names = fs.readdirSync(dir); } catch { return []; }
    const entries: T[] = [];
    for (const name of names) {
        const match = DAY_FILE.exec(name);
        if (!match || match[1] < startKey) continue;
        let text: string;
        try { text = fs.readFileSync(path.join(dir, name), 'utf8'); } catch { continue; }
        for (const line of text.split('\n')) {
            if (!line.trim()) continue;
            try {
                const entry = JSON.parse(line);
                if (!entry || !Number.isFinite(Number(entry.ts))) continue;
                if (accept && !accept(entry)) continue;
                entries.push(entry);
            } catch {
                // 写入中断留下的半行
            }
        }
    }
    return entries;
}

/** 每个账号每天最多清理一次，避免每条流水都扫目录。 */
function pruneBefore(namespace: string, accountId: string, now: number, keepDays: number): void {
    const todayKey = dateKeyOf(now);
    const pruneKey = `${namespace}:${accountKey(accountId)}`;
    if (lastPrunedDay.get(pruneKey) === todayKey) return;
    lastPrunedDay.set(pruneKey, todayKey);
    const cutoffKey = dateKeyOf(now - (keepDays - 1) * DAY_MS);
    const dir = namespaceDir(namespace, accountId);
    let names: string[] = [];
    try { names = fs.readdirSync(dir); } catch { return; }
    for (const name of names) {
        const match = DAY_FILE.exec(name);
        if (!match || match[1] >= cutoffKey) continue;
        try { fs.unlinkSync(path.join(dir, name)); } catch {}
    }
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
}

/** 统一分页：返回页内条目、是否还有更多、游标是否已失效。 */
function paginate<T extends { id: string }>(entries: T[], limit: number, before?: string) {
    let startIndex = 0;
    let cursorInvalid = false;
    if (before) {
        const index = entries.findIndex(entry => entry.id === before);
        if (index >= 0) {
            startIndex = index + 1;
        } else {
            cursorInvalid = true;
            startIndex = entries.length;
        }
    }
    const page = entries.slice(startIndex, startIndex + limit);
    const hasMore = startIndex + limit < entries.length;
    return {
        entries: page,
        hasMore,
        cursorInvalid,
        nextCursor: hasMore && page.length > 0 ? page[page.length - 1].id : '',
    };
}

function resetPrunedStateForTest(): void {
    lastPrunedDay.clear();
}

module.exports = {
    DAY_MS,
    accountKey,
    appendEntry,
    clampInt,
    dateKeyOf,
    namespaceDir,
    paginate,
    pruneBefore,
    readEntries,
    resetPrunedStateForTest,
};
