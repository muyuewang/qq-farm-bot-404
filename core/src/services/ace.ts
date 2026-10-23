export {};
/**
 * TSDK/ACE 生命周期 - 提取客户端安全数据并回灌服务端响应
 */
const { createScheduler } = require('./scheduler');
const { types } = require('../utils/proto');
const cryptoWasm = require('../utils/crypto-wasm');
const { log, logWarn } = require('../utils/utils');

const aceScheduler = createScheduler('ace');
let requestRunning = false;
let readyLogged = false;
let roundtripLogged = false;
let generation = 0;
let sendRequest: ((service: string, method: string, body: Buffer, timeout?: number) => Promise<any>) | null = null;
let lastSpeedCheckAt = 0;

function emptyDiagnostics() {
    return {
        requests: 0, replies: 0, nonemptyReplies: 0, failures: 0,
        lastRequestAt: 0, lastReplyAt: 0, lastFailureAt: 0, lastFailureStage: '',
        lastProcessAt: 0, lastProcessFailureAt: 0,
        taskFailures: 0, lastTaskFailureAt: 0, lastFailedTask: '',
    };
}
let diagnostics = emptyDiagnostics();

function getAceDiagnostics() {
    return { ...diagnostics, requestRunning };
}

function runTsdkTask(task: string, action: () => void): void {
    try {
        action();
        if (task === 'process_received_data') diagnostics.lastProcessAt = Date.now();
    } catch (e: any) {
        diagnostics.taskFailures += 1;
        diagnostics.lastTaskFailureAt = Date.now();
        diagnostics.lastFailedTask = task;
        if (task === 'process_received_data') diagnostics.lastProcessFailureAt = diagnostics.lastTaskFailureAt;
        logWarn('ACE', `TSDK ${task} 失败: ${e.message}`, { event: 'tsdk_task_failed', task });
    }
}

async function sendAntiData(): Promise<void> {
    if (!sendRequest || requestRunning) return;
    const currentGeneration = generation;
    const sender = sendRequest;
    let stage = 'collect';
    requestRunning = true;
    try {
        const data = cryptoWasm.getDataToServer();
        if (!data || data.length === 0) return;
        stage = 'encode';
        const body: Uint8Array = types.AntiDataRequest.encode(types.AntiDataRequest.create({ data })).finish();
        stage = 'request';
        diagnostics.requests += 1;
        diagnostics.lastRequestAt = Date.now();
        const { body: replyBody } = await sender('gamepb.acepb.AceService', 'AntiData', Buffer.from(body), 10000);
        // A response from a stopped connection must never reach a new account runtime.
        if (generation !== currentGeneration) return;
        diagnostics.replies += 1;
        diagnostics.lastReplyAt = Date.now();
        stage = 'decode';
        const reply = types.AntiDataReply.decode(replyBody);
        if (!roundtripLogged) {
            roundtripLogged = true;
            log('ACE', 'AntiData 请求已收到有效回复', { event: 'antidata_roundtrip' });
        }
        if (reply.result && reply.result.length > 0) {
            diagnostics.nonemptyReplies += 1;
            stage = 'feed';
            cryptoWasm.sendDataFromServer(Buffer.from(reply.result));
            if (!readyLogged) {
                readyLogged = true;
                log('ACE', '已收到并回灌非空 AntiData 响应', { event: 'antidata_received' });
            }
        }
    } catch (e: any) {
        if (generation !== currentGeneration) return;
        diagnostics.failures += 1;
        diagnostics.lastFailureAt = Date.now();
        diagnostics.lastFailureStage = stage;
        logWarn('ACE', `AntiData 上报或回灌失败: ${e.message}`, { event: 'antidata_failed', stage });
    } finally {
        if (generation === currentGeneration) requestRunning = false;
    }
}

function startAceRuntime(sender: (service: string, method: string, body: Buffer, timeout?: number) => Promise<any>): void {
    stopAceRuntime(false);
    diagnostics = emptyDiagnostics();
    sendRequest = sender;
    readyLogged = false;
    roundtripLogged = false;
    lastSpeedCheckAt = Date.now();

    aceScheduler.setIntervalTask('anti_data', 5000, sendAntiData, { preventOverlap: true });
    aceScheduler.setIntervalTask('process_received_data', 5000, () => runTsdkTask('process_received_data', () => cryptoWasm.processReceivedData()));
    aceScheduler.setIntervalTask('heartbeat_tick', 25000, () => runTsdkTask('heartbeat_tick', () => cryptoWasm.heartbeatTick()));
    aceScheduler.setIntervalTask('speed_check', 30000, () => {
        const now = Date.now();
        runTsdkTask('speed_check', () => cryptoWasm.detectSpeedHack(now - lastSpeedCheckAt));
        lastSpeedCheckAt = now;
    });
    aceScheduler.setIntervalTask('status_report', 150000, () => runTsdkTask('status_report', () => cryptoWasm.sendStatus()));
}

function stopAceRuntime(destroyWasm = false): void {
    generation += 1;
    aceScheduler.clearAll();
    requestRunning = false;
    readyLogged = false;
    roundtripLogged = false;
    sendRequest = null;
    lastSpeedCheckAt = 0;
    if (destroyWasm) cryptoWasm.destroyWasm();
}

module.exports = { sendAntiData, startAceRuntime, stopAceRuntime, getAceDiagnostics };
