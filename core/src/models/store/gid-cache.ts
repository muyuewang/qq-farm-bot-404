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
    } catch (e) {
        // 忽略读取错误
    }
    return null;
}

function writeKnownFriendGidsCache(accountId: unknown, gids: number[]): void {
    try {
        const file = getKnownFriendGidsCacheFile(accountId);
        writeJsonFileAtomic(file, {
            gids: gids || [],
            updatedAt: Date.now(),
        });
    } catch (e) {
        // 忽略写入错误
    }
}

module.exports = {
    ensureKnownFriendGidsDir,
    getKnownFriendGidsCacheFile,
    readKnownFriendGidsCache,
    writeKnownFriendGidsCache,
};
