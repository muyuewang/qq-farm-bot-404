export {};
const { TsdkRuntime } = require('./tsdk-runtime');

let runtime: any = null;

function getRuntime(): any {
    if (!runtime) runtime = new TsdkRuntime();
    return runtime;
}

async function initWasm(): Promise<void> {
    await getRuntime().init();
}

async function encryptBuffer(buffer: Buffer): Promise<Buffer> {
    await initWasm();
    return getRuntime().transform(buffer, false);
}

async function decryptBuffer(buffer: Buffer): Promise<Buffer> {
    await initWasm();
    return getRuntime().transform(buffer, true);
}

async function bindUser(openId: string): Promise<void> {
    await initWasm();
    getRuntime().bindUser(openId);
}

function getEncryptedInitInfo(): string {
    return getRuntime().getEncryptedInitInfo();
}

function getDataToServer(): Buffer {
    return getRuntime().getDataToServer();
}

function sendDataFromServer(data: Buffer): void {
    getRuntime().sendDataFromServer(data);
}

function heartbeatTick(): void {
    getRuntime().heartbeatTick();
}

function processReceivedData(): void {
    getRuntime().processReceivedData();
}

function sendStatus(): void {
    getRuntime().sendStatus();
}

function detectSpeedHack(elapsedMs: number): void {
    getRuntime().detectSpeedHack(elapsedMs);
}

function destroyWasm(): void {
    if (runtime) runtime.destroy();
    runtime = null;
}

module.exports = {
    getDiagnostics: () => runtime ? runtime.getDiagnostics() : null,
    initWasm,
    encryptBuffer,
    decryptBuffer,
    bindUser,
    getEncryptedInitInfo,
    getDataToServer,
    sendDataFromServer,
    heartbeatTick,
    processReceivedData,
    sendStatus,
    detectSpeedHack,
    destroyWasm,
};
