export {};

/**
 * 以薯换福：好友铺子的「分享标识」缓存。
 *
 * 背景（2026-11-28 15:29 抓包）：每日分享（cmd 98）后，分享出去的铺子卡片会带一个
 * 当天唯一的 share_key（UUID 形式）。别人点卡片进活动卖薯时，cmd 92 / cmd 93 的
 * params 里必须原样带上 {activity_id, gid, share_key}，只带 gid 的旧「强制卖」方式
 * 从这天起不再成交。
 *
 * 标识只在「本人分享」的回包里下发，服务端没有按 gid 反查好友标识的接口，
 * 所以：
 *   - 本账号每次分享成功后，把自己的标识落盘；
 *   - 面板里其它账号分享过，也会各自落盘到同一目录，本账号扫描时直接读文件；
 *   - 没有落盘标识的好友，连价都查不到（服务端会退回自己铺子的数据），前端会明确提示原因。
 *
 * 时效：**同一个 gid 当天标识固定不变，第二天换新**。所以按 dateKey 记账即可，
 * 当天不必重复分享；跨日对不上就当没有，等它下次分享自动补回来。
 *
 * 按 gid 一文件：每个账号进程只写自己的那一个，多进程不会互相覆盖，
 * 也不需要额外的文件锁。跨日自动失效（dateKey 对不上就当没有）。
 */
const fs = require('node:fs');
const path = require('node:path');
const { readJsonFile, writeJsonFileAtomic } = require('../../services/json-db');
const { YISHU_SHARE_KEYS_DIR } = require('./shared-state');

const SHARE_KEY_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const HEX_KEY_PATTERN = /^[0-9a-fA-F]{32}$/;

function ensureYishuShareKeysDir(): string {
    if (!fs.existsSync(YISHU_SHARE_KEYS_DIR)) {
        fs.mkdirSync(YISHU_SHARE_KEYS_DIR, { recursive: true });
    }
    return YISHU_SHARE_KEYS_DIR;
}

function shareKeyFile(gid: unknown): string {
    const safe = String(gid || '').replace(/[^\w-]/g, '_');
    return path.join(ensureYishuShareKeysDir(), `${safe}.json`);
}

/**
 * 把任意来源（分享链接、手填、抓包）里的标识规范化成 UUID 形式。
 * 接受带连字符的 UUID、32 位裸十六进制、以及含 share_key=... 的整条链接/文本。
 * 解析不出来返回空串，由调用方决定是报错还是跳过。
 */
function normalizeShareKey(input: unknown): string {
    const text = String(input || '').trim();
    if (!text) return '';
    const uuid = text.match(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/);
    if (uuid) return uuid[0].toLowerCase();
    const hex = text.match(/[0-9a-fA-F]{32}/);
    if (hex && HEX_KEY_PATTERN.test(hex[0])) {
        const raw = hex[0].toLowerCase();
        return `${raw.slice(0, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}-${raw.slice(16, 20)}-${raw.slice(20)}`;
    }
    return '';
}

function isValidShareKey(value: unknown): boolean {
    return SHARE_KEY_PATTERN.test(String(value || ''));
}

function readYishuShareKey(gid: unknown): { gid: string; shareKey: string; activityId: string; dateKey: string; source: string; updatedAt: number } | null {
    const id = String(gid || '').trim();
    if (!id) return null;
    try {
        const file = shareKeyFile(id);
        if (!fs.existsSync(file)) return null;
        const data = readJsonFile(file);
        const shareKey = normalizeShareKey(data?.shareKey);
        if (!shareKey) return null;
        return {
            gid: id,
            shareKey,
            activityId: String(data?.activityId || ''),
            dateKey: String(data?.dateKey || ''),
            // share = 本账号分享时自动落盘；manual = 用户手填的标识。
            // 界面上要区分：手填那条如果是错的，只能靠用户自己认出来。
            source: String(data?.source || 'share'),
            updatedAt: Number(data?.updatedAt) || 0,
        };
    } catch {
        // 单个文件损坏当作没有，不影响比价与出售流程。
        return null;
    }
}

/**
 * 取某 gid 在指定日期（服务器日期，形如 2026-11-28）的分享标识。
 * dateKey 传空表示不校验日期，只读文件里的值（导入功能用）。
 */
function findYishuShareKey(gid: unknown, dateKey: string): { shareKey: string; activityId: string } | null {
    const entry = readYishuShareKey(gid);
    if (!entry) return null;
    if (dateKey && entry.dateKey && entry.dateKey !== dateKey) return null;
    return { shareKey: entry.shareKey, activityId: entry.activityId };
}

function writeYishuShareKey(gid: unknown, input: { shareKey: unknown; activityId?: unknown; dateKey?: unknown; source?: unknown }): boolean {
    const id = String(gid || '').trim();
    const shareKey = normalizeShareKey(input?.shareKey);
    if (!id || !shareKey) return false;
    try {
        writeJsonFileAtomic(shareKeyFile(id), {
            shareKey,
            activityId: String(input?.activityId || ''),
            dateKey: String(input?.dateKey || ''),
            source: String(input?.source || 'share'),
            updatedAt: Date.now(),
        });
        return true;
    } catch {
        return false;
    }
}

/** 一次读出目录下所有标识，供比价扫描时按 gid 查表，避免每家铺子都读一次盘。 */
function listYishuShareKeys(): Map<string, { shareKey: string; activityId: string; dateKey: string; source: string }> {
    const result = new Map<string, { shareKey: string; activityId: string; dateKey: string; source: string }>();
    try {
        const dir = ensureYishuShareKeysDir();
        for (const file of fs.readdirSync(dir)) {
            if (!/\.json$/i.test(file)) continue;
            const entry = readYishuShareKey(file.replace(/\.json$/i, ''));
            if (entry) {
                result.set(entry.gid, {
                    shareKey: entry.shareKey,
                    activityId: entry.activityId,
                    dateKey: entry.dateKey,
                    source: entry.source,
                });
            }
        }
    } catch {
        // 目录不存在就当作没有任何标识
    }
    return result;
}

/** 删掉某个 gid 的标识：比价列表里「移除这家」走这里。 */
function removeYishuShareKey(gid: unknown): boolean {
    const id = String(gid || '').trim();
    if (!id) return false;
    try {
        const file = shareKeyFile(id);
        if (!fs.existsSync(file)) return false;
        fs.unlinkSync(file);
        return true;
    } catch {
        return false;
    }
}

module.exports = {
    ensureYishuShareKeysDir,
    normalizeShareKey,
    isValidShareKey,
    readYishuShareKey,
    findYishuShareKey,
    writeYishuShareKey,
    listYishuShareKeys,
    removeYishuShareKey,
};
