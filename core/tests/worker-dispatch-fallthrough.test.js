const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
// eslint-disable-next-line test/no-import-node-test
const test = require('node:test');

/**
 * worker 的 callWorkerApi 是一个巨大的 switch，每个 case 都必须自己收尾。
 * 少写一个 break 就会**穿透到下一个 case**：调用 A 顺手也执行了 B，
 * 而且 B 的返回值会覆盖 result —— 表面「操作成功」，实际做了两件事。
 *
 * 真实事故（2026-11-28）：加「移出比价」时把新 case 插在 import 之后、
 * 忘了给 import 补 break。结果点「加入比价」→ 先写入标识，紧接着又执行
 * 「移出比价」把它删掉，界面提示「已把 xxx 移出比价列表」，池子里始终少一家。
 */
test('worker 的 callWorkerApi 每个 case 都必须 break/return', () => {
    const file = path.join(__dirname, '../src/core/worker.ts');
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    const unterminated = [];
    let current = null;
    let body = [];

    const terminated = () => /\b(break|return|throw|continue)\b/.test(body.join('\n'));

    for (const line of lines) {
        const caseMatch = line.match(/^\s*case '([^']+)':/);
        if (caseMatch) {
            if (current && !terminated())
                unterminated.push(current);
            current = caseMatch[1];
            body = [];
            continue;
        }
        if (/^\s*default:/.test(line)) {
            if (current && !terminated())
                unterminated.push(current);
            current = null;
            body = [];
            continue;
        }
        if (current)
            body.push(line);
    }
    if (current && !terminated())
        unterminated.push(current);

    assert.deepEqual(unterminated, [], `这些 case 会穿透到下一个分支：${unterminated.join('、')}`);
});
