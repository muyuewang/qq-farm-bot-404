const test = require('node:test');
const assert = require('node:assert/strict');

const CHANGED_PATHS = [
  '.gitignore',
  'core/client.ts',
  'core/src/controllers/admin/account-routes.ts',
  'core/src/controllers/admin/farm-routes.ts',
  'core/src/controllers/admin/wx-login-routes.ts',
  'core/src/models/store/accounts.ts',
  'core/src/models/store/global-config.ts',
  'core/src/models/store/shared-state.ts',
  'core/src/runtime/account-startup.ts',
  'core/src/runtime/data-provider.ts',
  'core/src/runtime/runtime-engine.ts',
  'core/src/runtime/worker-manager.ts',
  'core/src/runtime/wx-kickout-recovery.ts',
  'core/src/config/runtime-paths.ts',
  'core/src/services/json-db.ts',
  'core/src/services/wx-login/constants.ts',
  'core/src/services/wx-login/credential-binding.ts',
  'core/src/services/wx-login/credential-errors.ts',
  'core/src/services/wx-login/credential-handoff.ts',
  'core/src/services/wx-login/credential-store.ts',
  'core/src/services/wx-login/reconnect-config.ts',
  'core/src/services/wx-login/service.ts',
  'core/src/services/wx-login/types.ts',
  'core/src/types/account.ts',
  'core/src/types/config.ts',
  'docs/CHANGELOG.md',
  'docs/wechat-connection.md',
  'start.sh',
  'web/src/components/WxLoginModal.vue',
  'web/src/components/settings/BagSeedPriority.vue',
  'web/src/components/settings/WxKickoutReloginCard.vue',
  'web/src/composables/settings/useWxKickoutRelogin.ts',
  'web/src/stores/account.ts',
  'web/src/stores/wx-login.ts',
  'web/src/views/Settings.vue',
];

test('本次改动路径清单非空且无重复', () => {
  assert.ok(CHANGED_PATHS.length > 0);
  assert.equal(new Set(CHANGED_PATHS).size, CHANGED_PATHS.length);
});
