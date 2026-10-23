const assert = require('node:assert/strict');
const test = require('node:test');

const {
    runExclusiveAutomationTask,
} = require('../dist/services/automation-lock');

test('automation lock serializes top-level tasks', async () => {
    let active = 0;
    let maxActive = 0;

    const task = async (delay) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise(resolve => setTimeout(resolve, delay));
        active -= 1;
    };

    await Promise.all([
        runExclusiveAutomationTask('task-a', () => task(15)),
        runExclusiveAutomationTask('task-b', () => task(5)),
        runExclusiveAutomationTask('task-c', () => task(10)),
    ]);

    assert.equal(maxActive, 1);
});

test('automation lock allows nested calls in the same task', async () => {
    let active = 0;
    let maxActive = 0;

    await runExclusiveAutomationTask('outer', async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await runExclusiveAutomationTask('inner', async () => {
            active += 1;
            maxActive = Math.max(maxActive, active);
            await new Promise(resolve => setTimeout(resolve, 5));
            active -= 1;
        });
        active -= 1;
    });

    assert.equal(maxActive, 2);
});
