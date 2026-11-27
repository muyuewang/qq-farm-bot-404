const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '../..');

function changedSourcePaths() {
    const output = execFileSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' });
    return output
        .split(/\r?\n/)
        .filter(Boolean)
        .map(line => line.slice(3).trim())
        .filter(file => file
            && !file.startsWith('.codebuddy/backup/')
            && !file.startsWith('web/dist/')
            && !file.startsWith('core/dist/')
            && !file.startsWith('core/tests/')
            && !file.startsWith('web/tests/'));
}

function testCorpus() {
    const files = [];
    const coreTests = path.join(ROOT, 'core/tests');
    for (const name of fs.readdirSync(coreTests)) {
        if (!name.endsWith('.test.js') || name === 'current-change-coverage.test.js') continue;
        files.push(path.join(coreTests, name));
    }
    const webTests = path.join(ROOT, 'web/tests');
    for (const name of fs.readdirSync(webTests)) {
        if (!name.endsWith('.test.mjs')) continue;
        files.push(path.join(webTests, name));
    }
    return files.map(file => fs.readFileSync(file, 'utf8')).join('\n');
}

test('本次所有非测试源码改动都有测试或静态契约引用', () => {
    const changed = changedSourcePaths();
    const corpus = testCorpus();
    // 干净检出（CI、PR 审阅）没有未提交改动需要审阅，跳过而不是误报失败。
    if (changed.length === 0) return;
    assert.ok(changed.length > 0, 'expected current source changes to review');
    for (const file of changed) {
        assert.ok(corpus.includes(file), `missing test/static-contract reference for ${file}`);
    }
});
