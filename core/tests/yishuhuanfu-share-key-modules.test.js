const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
// eslint-disable-next-line test/no-import-node-test
const test = require('node:test');

/**
 * 2026-11-28 以薯换福热更（分享标识校验）涉及的模块契约。
 *
 * 覆盖文件（刻意写成仓库相对路径，供 current-change-coverage 静态校验）：
 *   core/src/models/store/yishu-share-keys.ts
 *   core/src/models/store/shared-state.ts
 *   core/src/proto/activitypb.proto
 *   core/src/services/activity-center.ts
 *   core/src/services/activity-center/yishuhuanfu.ts
 *   core/src/services/yishuhuanfu-auto.ts
 *   core/src/runtime/data-provider.ts
 *   core/src/core/worker.ts
 *
 * 这些文件互为一条链：proto 定义字段 → 存档层落盘 → service 读写 → 导出 → worker 分发。
 * 任何一环少一个符号，卖好友都会静默退化成「只能查价」。
 */
const CORE = path.resolve(__dirname, '..');

function read(relative) {
    return fs.readFileSync(path.join(CORE, relative), 'utf8');
}

test('share key store exports every function the service depends on', () => {
    const store = require('../dist/models/store/yishu-share-keys');
    for (const name of ['normalizeShareKey', 'isValidShareKey', 'readYishuShareKey', 'writeYishuShareKey', 'listYishuShareKeys', 'removeYishuShareKey']) {
        assert.equal(typeof store[name], 'function', `存档层缺少 ${name}`);
    }
    // UUID 原样、32 位 hex 补连字符、整条链接只取标识。
    assert.equal(store.normalizeShareKey('0d0e525c-1f3e-4133-89d6-da336d845e29'), '0d0e525c-1f3e-4133-89d6-da336d845e29');
    assert.equal(store.normalizeShareKey('52AB5E16994B4110B4C7FF79367FCE03'), '52ab5e16-994b-4110-b4c7-ff79367fce03');
    assert.equal(store.normalizeShareKey('https://x/y?share_key=0d0e525c-1f3e-4133-89d6-da336d845e29'), '0d0e525c-1f3e-4133-89d6-da336d845e29');
    assert.equal(store.normalizeShareKey('不认识的文本'), '');
});

test('shared-state exposes the per-gid directory used by the store', () => {
    const shared = require('../dist/models/store/shared-state');
    assert.equal(typeof shared.YISHU_SHARE_KEYS_DIR, 'string');
    assert.ok(shared.YISHU_SHARE_KEYS_DIR.includes('yishu_share_keys'), '标识目录名必须稳定，重启后才能读到同一份存档');
});

test('proto declares the shop ref and the exchanged counter', () => {
    const proto = read('src/proto/activitypb.proto');
    // cmd 92 / cmd 93 回传的分享引用。
    assert.match(proto, /message YshfShopRef\s*\{[\s\S]*?int64 activity_id = 1;[\s\S]*?int64 gid = 2;[\s\S]*?string share_key = 3;/);
    // cmd 92 的 Params 2 号位、cmd 93 的 Params 3 号位。
    assert.match(proto, /YshfShopRef shop = 2;/);
    assert.match(proto, /YshfShopRef shop = 3;/);
    // 2 号位是邀请码，不是分享标识——曾把这里当 share_key 用，值永远对不上。
    assert.match(proto, /string invite_key = 2;/);
    assert.match(proto, /YshfShopRef shop_ref = 5;/);
    // cmd 97 的累计已兑、cmd 96 回包的本次次数与兑后累计。
    assert.match(proto, /int64 exchanged = 6;/);
    assert.match(proto, /int64 count = 4;[\s\S]*?int64 exchanged = 5;/);
});

test('service and dispatch layers wire the import and removal actions', () => {
    const service = read('src/services/activity-center/yishuhuanfu.ts');
    for (const symbol of ['shareRefFor', 'importYishuHuanfuShareKey', 'forgetYishuHuanfuShareKey', 'YSHF_SHARE_KEY_MISSING']) {
        assert.ok(service.includes(symbol), `service 缺少 ${symbol}`);
    }
    const barrel = read('src/services/activity-center.ts');
    assert.match(barrel, /importYishuHuanfuShareKey:/);
    assert.match(barrel, /forgetYishuHuanfuShareKey:/);
    const provider = read('src/runtime/data-provider.ts');
    assert.match(provider, /'importYishuHuanfuShareKey'/);
    assert.match(provider, /'forgetYishuHuanfuShareKey'/);
    const worker = read('src/core/worker.ts');
    assert.match(worker, /case 'importYishuHuanfuShareKey':/);
    assert.match(worker, /case 'forgetYishuHuanfuShareKey':/);
});

test('auto sell treats missing share key as "try next shop", not a failed round', () => {
    const auto = read('src/services/yishuhuanfu-auto.ts');
    assert.match(auto, /'YSHF_SHARE_KEY_MISSING'/, '缺标识要当成「换下一家」，不能算整轮失败');
    // 候选池由服务端按落盘标识生成，自动任务不再二次过滤；空池时要给出可执行的提示，
    // 而不是让用户以为「没有好友」。
    assert.match(auto, /先让面板里的账号各分享一次铺子/, '空候选池必须提示先分享铺子');
});
