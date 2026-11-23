const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');

const read = rel => readFileSync(resolve(__dirname, '..', 'src', rel), 'utf8');

const routes = read('controllers/admin/update-routes.ts');
const adminIndex = read('controllers/admin/index.ts');

/**
 * 面板内更新（上游 PR#178）。
 *
 * 容器不能自己升级：检查、构建、重启都交给宿主机的 tools/updater，面板只读写数据目录里的
 * 状态与请求文件。因此这里钉住三件事——必须挂在鉴权后面、三条路由齐全、没有状态文件时
 * 明确回 unknown 而不是伪装成「已是最新」。
 */
test('更新接口挂在鉴权中间件后面，且检查、更新、状态三条路由齐全', () => {
    assert.match(routes, /app\.use\('\/api\/update', createAuthRequired\(ctx\)\)/, '更新接口不能绕过鉴权');
    for (const route of ['status', 'check', 'apply'])
        assert.match(routes, new RegExp(`app\\.(get|post)\\('/api/update/${route}'`), `缺少 /api/update/${route} 路由`);
    assert.match(adminIndex, /mountUpdateRoutes\(app, ctx\)/, '更新路由没有挂载到管理端');

    // 面板自己不执行外部命令：出现这些调用说明职责越界到容器内了（注释里提到 docker 不算）。
    assert.doesNotMatch(routes, /child_process|execSync|spawnSync|exec\(/, '更新路由不应在容器内执行 git/docker 命令');
});

test('没有状态文件时回 unknown，不把「未安装更新器」说成已是最新', () => {
    assert.match(routes, /readJson\(STATUS_FILE\) \|\| \{ state: 'unknown', hasUpdate: false, checkedAt: 0 \}/,
        '状态文件缺失时必须给出 unknown 与 checkedAt=0，前端据此提示未安装更新器');
    // 请求文件存在时回报 requestPending，避免界面在宿主机接手前就显示「更新中」。
    assert.match(routes, /requestPending: !!requested/);
});

test('更新请求先写临时文件再改名，避免宿主机读到半份 JSON', () => {
    assert.match(routes, /const tmp = `\$\{file\}\.tmp`/);
    assert.match(routes, /fs\.renameSync\(tmp, file\)/);
});
