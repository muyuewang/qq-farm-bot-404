const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

test('expired enabled battle flag is persisted off at startup and after running across end', () => {
    for (const startup of [true, false]) {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-diary-expiry-'));
        try {
            fs.writeFileSync(path.join(dir, 'store.json'), JSON.stringify({ accountConfigs: {
                fixture: { automation: { pet_diary_battle: true } },
            } }));
            const script = `
                const assert = require('node:assert/strict');
                Date.now = () => ${startup ? 1791820800 : 1789005600} * 1000;
                const store = require('./src/models/store');
                Date.now = () => 1791820800 * 1000;
                const changed = store.persistInactiveActivityAutomation();
                ${startup ? '' : "assert.ok(changed.includes('fixture'));"}
                assert.equal(store.getAutomation('fixture').pet_diary_battle, false);
            `;
            execFileSync(process.execPath, ['-e', script], { cwd: path.join(__dirname, '..'),
                env: { ...process.env, FARM_DATA_DIR: dir }, stdio: 'pipe' });
            const saved = JSON.parse(fs.readFileSync(path.join(dir, 'store.json')));
            assert.equal(saved.accountConfigs.fixture.automation.pet_diary_battle, false);
        } finally { fs.rmSync(dir, { recursive: true, force: true }); }
    }
});
