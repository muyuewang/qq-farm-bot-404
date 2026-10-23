export {};

const { AsyncLocalStorage } = require('node:async_hooks');

interface AutomationLockStore {
    exclusive: true;
}

const storage: any = new AsyncLocalStorage();
let tail: Promise<void> = Promise.resolve();
let running = false;

function runExclusiveAutomationTask<T>(
    taskName: string,
    taskFn: () => T | PromiseLike<T>,
): Promise<T> {
    const store: AutomationLockStore | undefined = storage.getStore();
    if (store && store.exclusive) return Promise.resolve(taskFn());

    const run = tail.then(async () => {
        running = true;
        try {
            return await storage.run({ exclusive: true }, taskFn);
        } finally {
            running = false;
        }
    });
    tail = run.then(() => undefined, () => undefined);
    return run;
}

function isAutomationTaskRunning(): boolean {
    return running;
}

module.exports = {
    runExclusiveAutomationTask,
    isAutomationTaskRunning,
};
