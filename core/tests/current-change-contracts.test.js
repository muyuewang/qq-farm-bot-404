const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');

function read(relative) {
    return fs.readFileSync(path.join(ROOT, relative), 'utf8');
}

function block(source, startMarker, endMarker) {
    const start = source.indexOf(startMarker);
    assert.notEqual(start, -1, `missing block start: ${startMarker}`);
    const end = source.indexOf(endMarker, start);
    assert.notEqual(end, -1, `missing block end: ${endMarker}`);
    return source.slice(start, end);
}

test('既有无关改动保持原样，仅纳入静态契约覆盖', () => {
    assert.match(read('.gitignore'), /\.codebuddy/);
    const bag = read('web/src/components/settings/BagSeedPriority.vue');
    assert.match(bag, /seedList/);
    assert.match(bag, /priorityIds/);
});

test('启动恢复与持久化 autoStart 已接线', () => {
    assert.match(read('core/client.ts'), /autoStartAccounts:\s*true/);
    assert.match(read('core/src/runtime/runtime-engine.ts'), /createAccountStartupService/);
    assert.match(read('core/src/runtime/runtime-engine.ts'), /await startAllAccounts\(\)/);
    assert.match(read('core/src/types/account.ts'), /autoStart\?:\s*boolean/);
    assert.match(read('core/src/models/store/accounts.ts'), /'autoStart'/);
    assert.match(read('core/src/models/store/accounts.ts'), /旧账号没有该字段时默认视为未启用/);
});

test('配置归一化、默认设置与 API 契约覆盖', () => {
    assert.match(read('core/src/types/config.ts'), /interface WxKickoutReloginConfig/);
    assert.match(read('core/src/models/store/global-config.ts'), /normalizeWxKickoutRelogin/);
    assert.match(read('core/src/models/store/shared-state.ts'), /wxKickoutRelogin/);
    assert.match(read('core/src/controllers/admin/account-routes.ts'), /wxAutoReconnectReady/);
    assert.match(read('core/src/controllers/admin/farm-routes.ts'), /await ctx\.provider\.startAccount/);
});

test('账号状态接口 fallback 字段必须与 getStatus 对齐', () => {
    const source = read('core/src/controllers/admin/account-routes.ts');
    const fallback = block(source, "data: status || {", "},\n            });");
    for (const field of ['enabled', 'bound', 'blocked', 'credentialReady', 'pending', 'nextRunAt', 'attempts', 'failures', 'expiresAt', 'lastSuccessAt', 'delayMinutes', 'dailyLimit', 'validUntil']) {
        assert.match(fallback, new RegExp(`\\b${field}\\b`), `fallback missing ${field}`);
    }
});

test('微信凭据模块保持安全边界并新增 peek / 回滚能力', () => {
    const binding = read('core/src/services/wx-login/credential-binding.ts');
    assert.match(binding, /handoff\.peek/);
    assert.match(binding, /findAccount/);
    assert.match(binding, /handoff\.consume/);

    const handoff = read('core/src/services/wx-login/credential-handoff.ts');
    assert.match(handoff, /function peek\(/);
    assert.match(handoff, /onEvicted/);
    assert.match(handoff, /MAX_PENDING/);

    const credentialStore = read('core/src/services/wx-login/credential-store.ts');
    assert.doesNotMatch(credentialStore, /chmodSync\(dir,\s*0o700\)/);
    assert.match(credentialStore, /mode:\s*0o600/);

    assert.match(read('core/src/services/json-db.ts'), /mode:\s*0o600/);
    assert.match(read('core/src/config/runtime-paths.ts'), /FARM_DATA_DIR/);
    assert.match(read('core/src/services/wx-login/service.ts'), /REFRESH_TOKEN_URL/);
    assert.match(read('core/src/services/wx-login/constants.ts'), /TARGET_APP_ID/);
    assert.match(read('core/src/services/wx-login/types.ts'), /WxCredentialSnapshot/);
    assert.match(read('core/src/services/wx-login/reconnect-config.ts'), /DEFAULT_WX_KICKOUT_RELOGIN/);
    assert.match(read('core/src/services/wx-login/credential-errors.ts'), /code=-101/);
});

test('扫码路由按操作拆锁、有任务上限且复用 Code 响应常量', () => {
    const source = read('core/src/controllers/admin/wx-login-routes.ts');
    assert.match(source, /MAX_TASKS/);
    assert.match(source, /pollPending/);
    assert.match(source, /confirmPending/);
    assert.match(source, /codePending/);
    assert.match(source, /codeResult/);
    assert.match(source, /LOGIN_OK_MESSAGE/);
    assert.doesNotMatch(source, /task\.pending/);
});

test('Worker manager 不再把启动副作用写进 startWorker，并保护 WS 400 单次终止', () => {
    const source = read('core/src/runtime/worker-manager.ts');
    const startWorkerBlock = block(source, 'function startWorker(account: any): boolean {', 'function stopWorker(');
    assert.doesNotMatch(startWorkerBlock, /autoStart:\s*true/);
    const ws400Block = block(source, "} else if (msg.type === 'ws_error') {", "} else if (msg.type === 'account_kicked') {");
    assert.match(ws400Block, /terminalHandled\s*=\s*true/);
});

test('恢复服务共享换码 singleflight，并在配置关闭时保留保活', () => {
    const source = read('core/src/runtime/wx-kickout-recovery.ts');
    assert.match(source, /codeRefreshInFlight/);
    assert.match(source, /codeRefreshInFlight\.has\(key\)/);
    assert.match(source, /cancelReloginTasks/);
    assert.match(source, /keepaliveTaskName/);
    assert.match(source, /toISOString\(\)\.slice\(0,\s*10\)/);
});

test('启动恢复服务支持有限并发', () => {
    const source = read('core/src/runtime/account-startup.ts');
    assert.match(source, /concurrency/);
    assert.match(source, /Promise\.all/);
});

test('数据提供者使用操作序号保护启停竞态', () => {
    const source = read('core/src/runtime/data-provider.ts');
    assert.match(source, /startIntent/);
    assert.match(source, /isCurrentIntent/);
});

test('start.sh 覆盖新增核心模块，systemd 部署文档明确构建前置', () => {
    assert.match(read('start.sh'), /CORE_NEW_MODULE_OUTPUTS/);
    assert.match(read('docs/wechat-connection.md'), /systemd/);
    assert.match(read('docs/wechat-connection.md'), /ExecStartPre|构建/);
});

test('文档明确启动恢复边界、内存中预算与重新开启开关的行为', () => {
    const docs = read('docs/wechat-connection.md');
    assert.match(docs, /已绑定可复用凭据/);
    assert.match(docs, /进程重启会清零/);
    assert.match(docs, /重新开启不会补回/);
    assert.match(read('docs/CHANGELOG.md'), /微信被踢自动连回/);
});

test('测试基线不会脱离构建，也不会污染真实 core/data', () => {
    assert.match(read('core/package.json'), /"test":\s*"pnpm run build:ts && node --test tests\/\*\.test\.js"/);
    assert.match(read('core/tests/email-daily-persistence.test.js'), /os\.tmpdir\(\)/);
    assert.match(read('core/tests/friend-pet-cache.test.js'), /os\.tmpdir\(\)/);
    const recoveryTests = read('core/tests/wx-kickout-recovery.test.js');
    assert.match(recoveryTests, /await task\.fn\(\);[\s\S]{0,240}tasks\.delete\(name\)/);
});
