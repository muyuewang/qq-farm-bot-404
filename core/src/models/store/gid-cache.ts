export {};
const fs = require('node:fs');
const path = require('node:path');
const { readJsonFile, writeJsonFileAtomic } = require('../../services/json-db');

const { KNOWN_FRIEND_GIDS_DIR } = require('./shared-state');

function ensureKnownFriendGidsDir(): string {
    if (!fs.existsSync(KNOWN_FRIEND_GIDS_DIR)) {
        fs.mkdirSync(KNOWN_FRIEND_GIDS_DIR, { recursive: true });
    }
    return KNOWN_FRIEND_GIDS_DIR;
}

function getKnownFriendGidsCacheFile(accountId: unknown): string {
    const safeId = String(accountId || '').replace(/[^\w-]/g, '_');
    return path.join(ensureKnownFriendGidsDir(), `${safeId}.json`);
}

function readKnownFriendGidsCache(accountId: unknown): number[] | null {
    try {
        const file = getKnownFriendGidsCacheFile(accountId);
        if (fs.existsSync(file)) {
            const data = readJsonFile(file);
            if (data && Array.isArray(data.gids)) {
                return data.gids;
            }
        }
    } catch {
        // 忽略读取错误
    }
    return null;
}

/**
 * 列出缓存目录里所有账号的好友 GID，不依赖 accounts.json 的账号列表。
 *
 * 面板可能只挂一个账号，但历史账号落盘的好友缓存依然有比价价值；只按当前账号
 * 列表读会漏掉这些文件，候选池就退化成「只有本号好友」。单个文件损坏只跳过
 * 该文件，不影响其它账号。
 */
function listAllKnownFriendGidsCaches(): Array<{ accountId: string; gids: number[] }> {
    const result: Array<{ accountId: string; gids: number[] }> = [];
    try {
        const dir = ensureKnownFriendGidsDir();
        const files = fs.readdirSync(dir).filter((name: string) => /\.json$/i.test(name));
        for (const file of files) {
            const accountId = file.replace(/\.json$/i, '');
            if (!accountId) continue;
            try {
                const data = readJsonFile(path.join(dir, file));
                if (data && Array.isArray(data.gids)) {
                    result.push({ accountId, gids: data.gids });
                }
            } catch {
                // 单个缓存文件损坏不影响其它账号
            }
        }
    } catch {
        // 目录读不到就当没有缓存
    }
    return result;
}

function writeKnownFriendGidsCache(accountId: unknown, gids: number[]): void {
    try {
        const file = getKnownFriendGidsCacheFile(accountId);
        writeJsonFileAtomic(file, {
            gids: gids || [],
            updatedAt: Date.now(),
        });
    } catch {
        // 忽略写入错误
    }
}

module.exports = {
    ensureKnownFriendGidsDir,
    getKnownFriendGidsCacheFile,
    readKnownFriendGidsCache,
    writeKnownFriendGidsCache,
    listAllKnownFriendGidsCaches,
};
