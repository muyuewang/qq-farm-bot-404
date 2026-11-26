const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// 本项目数据目录由 runtime-paths.getDataFile 计算（不是 FARM_DATA_DIR 环境变量），
// 所以先在加载 shared-state / gid-cache 前替换 getDataFile，让 KNOWN_FRIEND_GIDS_DIR
// 指向临时目录，并清模块缓存后重新 require，避免污染真实 data 目录。
function loadGidCache(dir) {
    const runtimePaths = require('../dist/config/runtime-paths');
    const originalGetDataFile = runtimePaths.getDataFile;
    runtimePaths.getDataFile = (filename) => path.join(dir, filename);

    const sharedPath = require.resolve('../dist/models/store/shared-state');
    const cachePath = require.resolve('../dist/models/store/gid-cache');
    const savedShared = require.cache[sharedPath];
    const savedCache = require.cache[cachePath];
    delete require.cache[sharedPath];
    delete require.cache[cachePath];
    try {
        return require('../dist/models/store/gid-cache');
    }
    finally {
        delete require.cache[sharedPath];
        delete require.cache[cachePath];
        if (savedShared) require.cache[sharedPath] = savedShared;
        if (savedCache) require.cache[cachePath] = savedCache;
        runtimePaths.getDataFile = originalGetDataFile;
    }
}

// 场景：accounts.json 只挂一个账号（本地常见），但缓存目录里有多个账号的
// <id>.json。面板好友池必须以目录为准，否则只剩本号好友，看不到历史账号的好友。
function withTempCaches(files, fn) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yshf-gids-'));
    const gidDir = path.join(dir, 'known_friend_gids');
    fs.mkdirSync(gidDir, { recursive: true });
    for (const [name, data] of Object.entries(files)) {
        fs.writeFileSync(path.join(gidDir, `${name}.json`), JSON.stringify(data));
    }
    try {
        return fn(loadGidCache(dir));
    }
    finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

test('listAllKnownFriendGidsCaches reads every account file, not just the current account', () => {
    withTempCaches({
        '1': { gids: [], updatedAt: 1 },
        '2': { gids: [111001, 111002], updatedAt: 2 },
        '3': { gids: [222001], updatedAt: 3 },
    }, (gidCache) => {
        const caches = gidCache.listAllKnownFriendGidsCaches();
        const byId = new Map(caches.map(entry => [entry.accountId, entry.gids]));
        assert.equal(byId.get('1').length, 0, '空缓存也要列出');
        assert.deepEqual(byId.get('2'), [111001, 111002]);
        assert.deepEqual(byId.get('3'), [222001]);
    });
});

test('a damaged cache file does not hide the other accounts', () => {
    withTempCaches({
        '2': { gids: [111001] },
        '4': { broken: true },
        '9': { gids: [999001] },
    }, (gidCache) => {
        const caches = gidCache.listAllKnownFriendGidsCaches();
        assert.equal(caches.length, 2, '损坏文件被跳过，其余仍可读');
        assert.ok(caches.some(entry => entry.accountId === '2'));
        assert.ok(caches.some(entry => entry.accountId === '9'));
    });
});
