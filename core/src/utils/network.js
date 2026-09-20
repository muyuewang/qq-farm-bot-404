const { Buffer } = require('node:buffer');
const EventEmitter = require('node:events');
/**
 * WebSocket 网络层 - 连接/消息编解码/登录/心跳
 *
 * 架构对齐上游 liyangpengs/qq-farm-bot：
 * - 请求队列 + 按类别分派（requestQueue + drainRequestQueue）
 * - 按类别在途限制（critical/foreground/farm/friend/background）
 * - 心跳走队列 criticalLane
 * - 登录串行化
 */

const process = require('node:process');
const WebSocket = require('ws');
const { CONFIG } = require('../config/config');
const { AceService } = require('../services/ace-service');
const { createScheduler } = require('../services/scheduler');
const { updateStatusFromLogin, updateStatusGold, updateStatusLevel } = require('../services/status');
const { recordOperation, recordTongQiGift, getTongQiGiftCount } = require('../services/stats');
const { types } = require('./proto');
const { toLong, toNum, syncServerTime, log, logWarn } = require('./utils');
const cryptoWasm = require('./crypto-wasm');
const { createGatewayToken, GatewayTokenProvider } = require('./gateway-token');
const { evaluateGatewayHealth, getOldestPendingAgeMs } = require('./gateway-health');
const {
    resolveRequestClass,
    selectDispatchIndex,
    isClassQueueFull,
    maxQueuedForClass,
    describeRequestClassMarker,
    classOf,
    getRequestPriority,
} = require('./request-priority');
const { TsdkRuntime } = require('./tsdk-runtime');

const CLIENT_VERSION_RE = /^\d+(?:\.\d+){2,4}_\d{8}$/;

function extractServerClientVersion(versionInfo) {
    const source = versionInfo && typeof versionInfo === 'object' ? versionInfo : {};
    const candidates = [source.version_force, source.version_recommend];
    for (const candidate of candidates) {
        const value = String(candidate || '').trim();
        if (CLIENT_VERSION_RE.test(value)) return value;
    }
    return '';
}

function applyServerVersionInfo(versionInfo) {
    const clientVersion = extractServerClientVersion(versionInfo);
    if (!clientVersion || clientVersion === CONFIG.clientVersion) return false;
    const previous = CONFIG.clientVersion;
    CONFIG.clientVersion = clientVersion;
    log('系统', `服务端版本信息已自动更新客户端版本: ${previous} -> ${clientVersion}`);
    networkEvents.emit('client_version_update', { clientVersion, previous });
    return true;
}

// 延迟加载 store 模块避免循环依赖
let storeModule = null;
function getStoreModule() {
    if (!storeModule) {
        storeModule = require('../models/store');
    }
    return storeModule;
}

// ============ 事件发射器 (用于推送通知) ============
const networkEvents = new EventEmitter();

// ============ 内部状态 ============
let ws = null;
let clientSeq = 1;
let serverSeq = 0;
const pendingCallbacks = new Map();
const pendingStartedAt = new Map();
// 请求队列（替代 requestGate 信号量）
const requestQueue = [];
let nextRequestId = 1;
const networkScheduler = createScheduler('network');
let tsdkRuntime = null;
let aceService = null;
let initialGamePackInfo = '';
let loginReady = false;
const gatewayTokens = new GatewayTokenProvider();

const DEFAULT_DEVICE_FINGERPRINT = Object.freeze({
    os: 'iOS',
    sysSoftware: 'iOS 26.2.1',
    deviceBrand: 'Apple',
    deviceModel: 'iPhone18,3',
    deviceId: 'iPhone X<iPhone18,3>',
    memory: '7672',
});

function resolveDeviceFingerprint(deviceProtocol) {
    const custom = deviceProtocol && deviceProtocol.enabled ? deviceProtocol : null;
    if (!custom) return { ...DEFAULT_DEVICE_FINGERPRINT, userAgent: '' };

    const userAgent = String(custom.userAgent || '').trim();
    const isAndroid = /android/i.test(userAgent);
    const isApple = /iphone|ipad|ios/i.test(userAgent)
        || /apple/i.test(String(custom.deviceBrand || ''));
    if (isAndroid && isApple) {
        throw new Error('设备协议矛盾：Android UA 不能与 Apple/iOS 设备信息混用');
    }

    const deviceBrand = String(custom.deviceBrand || '').trim();
    const deviceModel = String(custom.deviceModel || '').trim();
    const deviceId = String(custom.deviceId || custom.deviceMac || custom.imei || '').trim();
    if (!deviceBrand || !deviceModel || !deviceId) {
        throw new Error('设备协议不完整：启用自定义设备时必须设置品牌、型号和稳定设备ID');
    }

    const osName = isAndroid ? 'Android' : 'iOS';
    return {
        os: osName,
        sysSoftware: osName,
        deviceBrand,
        deviceModel,
        deviceId,
        memory: DEFAULT_DEVICE_FINGERPRINT.memory,
        userAgent,
    };
}

function logAce(level, message) {
    if (level === 'warn' || level === 'error') logWarn('ACE', message);
    else log('ACE', message);
}

function buildTsdkDeviceInfo(deviceProtocol) {
    const custom = deviceProtocol && deviceProtocol.enabled ? deviceProtocol : null;
    if (!custom) {
        return { platform: CONFIG.os };
    }

    const device = resolveDeviceFingerprint(custom);
    return {
        deviceModel: device.deviceModel,
        deviceBrand: device.deviceBrand,
        deviceId: device.deviceId,
        deviceMac: String(custom.deviceMac || '').trim(),
        imei: String(custom.imei || '').trim(),
        platform: device.os,
        system: device.sysSoftware,
    };
}

function createTsdkRuntime(deviceProtocol) {
    return new TsdkRuntime({
        accountId: process.env.FARM_ACCOUNT_ID,
        gameId: CONFIG.tsdkGameId,
        appKey: CONFIG.tsdkAppKey,
        deviceInfo: buildTsdkDeviceInfo(deviceProtocol),
        logger: logAce,
    });
}

async function startSecurityRuntime(deviceProtocol) {
    stopSecurityRuntime('重新初始化');
    if (!CONFIG.tsdkAceEnabled) {
        throw new Error('TSDK/ACE 已通过 FARM_TSDK_ACE_ENABLED=false 关闭，网关请求不会使用伪造 Token');
    }
    tsdkRuntime = createTsdkRuntime(deviceProtocol);
    initialGamePackInfo = '';
    cryptoWasm.setRuntime(tsdkRuntime);
    await tsdkRuntime.init();
}

function startAceService() {
    if (!tsdkRuntime || !tsdkRuntime.ready) throw new Error('TSDK 尚未就绪');
    if (aceService) aceService.stop('重新启动');
    aceService = new AceService({
        runtime: tsdkRuntime,
        sendRequest: sendMsgAsync,
        isConnected,
        types,
        logger: logAce,
    });
    aceService.start();
}

function stopSecurityRuntime(reason = '停止') {
    if (aceService) {
        aceService.stop(reason);
        aceService = null;
    }
    if (tsdkRuntime) {
        tsdkRuntime.destroy();
        tsdkRuntime = null;
    }
    initialGamePackInfo = '';
    cryptoWasm.setRuntime(null);
}

// ============ 请求队列与分派 ============

function settleQueuedRequest(request, error, value) {
    if (request.settled) return;
    request.settled = true;
    networkScheduler.clear(request.timeoutKey);
    networkScheduler.clear(request.queueWaitKey);
    if (error) request.reject(error);
    else request.resolve(value);
}

function pendingClassCount(requestClass) {
    let count = 0;
    for (const pending of pendingCallbacks.values()) {
        if (pending.requestClass === requestClass) count += 1;
    }
    return count;
}

function pendingBusinessCount() {
    return pendingClassCount('foreground') + pendingClassCount('farm') + pendingClassCount('friend');
}

function oldestPendingAgeMs() {
    const now = Date.now();
    let oldest = 0;
    for (const [seq, startedAt] of pendingStartedAt) {
        const age = Math.max(0, now - startedAt);
        if (age > oldest) oldest = age;
    }
    return oldest;
}

function getGatewayLoad() {
    return {
        pending: pendingCallbacks.size,
        queued: requestQueue.length,
        criticalPending: pendingClassCount('critical'),
        businessPending: pendingBusinessCount(),
        foregroundPending: pendingClassCount('foreground'),
        backgroundPending: pendingClassCount('background'),
        heartbeatMisses: heartbeatMissCount,
        oldestPendingAgeMs: oldestPendingAgeMs(),
    };
}

function isCurrentConnection(context) {
    return currentConnection === context && ws === context.socket && !context.finalized;
}

/**
 * 挑出下一个可发送的请求。分层与容量规则全部在 utils/request-priority.ts 里，
 * 这里只负责清掉已结算的队列项、把选中项摘出来。
 */
function takeDispatchableRequest() {
    // 清理已结算的队列项
    for (let index = requestQueue.length - 1; index >= 0; index--) {
        if (requestQueue[index].settled) requestQueue.splice(index, 1);
    }
    if (requestQueue.length === 0) return null;
    const index = selectDispatchIndex(requestQueue, Array.from(pendingCallbacks.values()), Date.now());
    if (index < 0) return null;
    return requestQueue.splice(index, 1)[0];
}

function drainRequestQueue() {
    while (requestQueue.length > 0) {
        const request = takeDispatchableRequest();
        if (!request) break;

        if (!isCurrentConnection(request.context) || request.context.phase !== 'online') {
            settleQueuedRequest(request, new Error(`连接未打开: ${request.methodName}`));
            continue;
        }

        const seq = clientSeq;
        request.seq = seq;
        const pending = request.expectReply ? {
            serviceName: request.serviceName,
            methodName: request.methodName,
            startedAt: Date.now(),
            requestClass: request.requestClass,
            criticalLane: request.criticalLane,
            expectedErrorCodes: request.expectedErrorCodes,
            callback(err, body, meta) {
                if (err) settleQueuedRequest(request, err);
                else settleQueuedRequest(request, undefined, { body, meta });
                drainRequestQueue();
            },
        } : undefined;
        sendMsg(request.context, request.serviceName, request.methodName, request.bodyBytes, pending).then((sent) => {
            if (sent) {
                if (!request.expectReply) {
                    settleQueuedRequest(request, undefined, { body: Buffer.alloc(0), meta: {} });
                    drainRequestQueue();
                }
                return;
            }
            if (pending) pendingCallbacks.delete(seq);
            settleQueuedRequest(request, new Error(`发送失败: ${request.methodName}`));
            drainRequestQueue();
        }).catch((error) => {
            if (pending) pendingCallbacks.delete(seq);
            settleQueuedRequest(request, error instanceof Error ? error : new Error(String(error)));
            drainRequestQueue();
        });
    }
}

function rejectAllQueuedRequests(reason) {
    const entries = requestQueue.splice(0);
    for (const request of entries) settleQueuedRequest(request, new Error(reason));
    return entries.length;
}

function rejectAllPendingRequests(reason = '请求被中断') {
    const entries = Array.from(pendingCallbacks.entries());
    pendingCallbacks.clear();
    pendingStartedAt.clear();
    for (const [, pending] of entries) {
        try {
            pending.callback(new Error(reason));
        } catch {
            // ignore callback failure
        }
    }
    return entries.length;
}

function describePendingRequests() {
    if (pendingCallbacks.size === 0) return 'none';
    const now = Date.now();
    const entries = Array.from(pendingCallbacks.entries());
    return entries
        .slice(0, 6)
        .map(([seq, pending]) => {
            const method = pending.methodName || 'unknown';
            const ageMs = pending.startedAt ? Math.max(0, now - pending.startedAt) : 0;
            return `${method}#${seq}:${ageMs}ms`;
        })
        .join(',');
}

function describeQueuedRequests() {
    if (requestQueue.length === 0) return 'none';
    return requestQueue
        .slice(0, 8)
        .map(request => `${describeRequestClassMarker(request)}${request.methodName || 'unknown'}`)
        .join(',');
}

// ============ 用户状态 (登录后设置) ============
const userState = {
    gid: 0,
    name: '',
    level: 0,
    gold: 0,
    exp: 0,
    coupon: 0, // 点券(ID:1002)
    diamond: 0, // 钻石(ID:1004)
    goldBean: 0, // 金豆豆(ID:1005)
    openId: '',
    avatar: '',
};

function getUserState() { return userState; }
function getWsErrorState() { return { ...wsErrorState }; }
function setWsErrorState(code, message) {
    wsErrorState = { code: Number(code) || 0, at: Date.now(), message: message || '' };
}
function clearWsErrorState() {
    wsErrorState = { code: 0, at: 0, message: '' };
}

function logLoginSummary(loginTimeMs) {
    const lines = [
        `GID: ${userState.gid}`,
        `昵称: ${userState.name}`,
        `等级: ${userState.level}`,
        `金币: ${userState.gold}`,
    ];
    if (loginTimeMs) {
        lines.push(`时间: ${new Date(loginTimeMs).toLocaleString()}`);
    }
    log('系统', `登录摘要\n${lines.join('\n')}`);
}

async function fetchUserSettings() {
    try {
        const body = types.GetUserSettingsRequest.encode(types.GetUserSettingsRequest.create({})).finish();
        const { body: replyBody } = await sendMsgAsync('gamepb.userpb.UserService', 'GetUserSettings', body);
        const reply = types.GetUserSettingsReply.decode(replyBody);
        if (reply.settings) {
            log('系统', '用户设置已同步');
        }
    } catch {
        // 忽略获取失败
    }
}

function hasOwn(obj, key) {
    return !!obj && Object.hasOwn(obj, key);
}

// ============ 消息编解码 ============
async function encodeMsg(serviceName, methodName, bodyBytes, clientSeqValue) {
    let finalBody = bodyBytes || Buffer.alloc(0);
    if (finalBody.length > 0) {
        finalBody = await cryptoWasm.encryptBuffer(finalBody);
    }
    const gatewayToken = gatewayTokens.next();
    const msg = types.GateMessage.create({
        meta: {
            service_name: serviceName,
            method_name: methodName,
            message_type: 1,
            client_seq: toLong(clientSeqValue),
            server_seq: toLong(serverSeq),
        },
        body: finalBody,
        auth_token: gatewayToken,
    });
    return types.GateMessage.encode(msg).finish();
}

async function sendMsg(context, serviceName, methodName, bodyBytes, pending) {
    if (!isCurrentConnection(context) || context.socket.readyState !== WebSocket.OPEN) {
        log('系统', '[WS] 连接未打开');
        return false;
    }
    const seq = clientSeq;
    clientSeq += 1;
    // 加密前登记在途请求，确保排队器能准确计算并发槽位。
    if (pending) {
        pendingCallbacks.set(seq, pending);
        pendingStartedAt.set(seq, Date.now());
    }
    const encoded = await encodeMsg(serviceName, methodName, bodyBytes, seq);
    if (pending && pendingCallbacks.get(seq) !== pending) return false;
    if (!isCurrentConnection(context) || context.socket.readyState !== WebSocket.OPEN) {
        if (pending) {
            pendingCallbacks.delete(seq);
            pendingStartedAt.delete(seq);
            pending.callback(new Error(`连接未打开: ${methodName}`));
        }
        return false;
    }
    try {
        context.socket.send(encoded);
    } catch (err) {
        if (pending) {
            pendingCallbacks.delete(seq);
            pendingStartedAt.delete(seq);
            pending.callback(err);
        }
        return false;
    }
    return true;
}

// ============ 兼容旧接口 ============
async function sendMsgLegacy(serviceName, methodName, bodyBytes, callback) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        log('系统', '[WS] 连接未打开');
        return false;
    }
    const seq = clientSeq;
    clientSeq += 1;
    const encoded = await encodeMsg(serviceName, methodName, bodyBytes, seq);
    if (callback) {
        pendingCallbacks.set(seq, callback);
        pendingStartedAt.set(seq, Date.now());
    }
    try {
        ws.send(encoded);
    } catch (err) {
        if (callback) {
            pendingCallbacks.delete(seq);
            pendingStartedAt.delete(seq);
            callback(err);
        }
        return false;
    }
    return true;
}

/** Promise 版发送 — 走请求队列 + 按类别分派 */
function sendMsgAsync(serviceName, methodName, bodyBytes, timeoutOrOptions, options) {
    // 兼容旧调用：sendMsgAsync(service, method, body, timeout, { priority })
    let timeoutMs;
    let sendOptions;
    if (typeof timeoutOrOptions === 'number') {
        timeoutMs = timeoutOrOptions;
        sendOptions = options || {};
    } else if (timeoutOrOptions && typeof timeoutOrOptions === 'object') {
        timeoutMs = Number(timeoutOrOptions.timeoutMs) || 10000;
        sendOptions = timeoutOrOptions;
    } else {
        timeoutMs = 10000;
        sendOptions = {};
    }
    timeoutMs = Math.max(1, timeoutMs);

    const expectedErrorCodes = new Set((sendOptions.expectedErrorCodes || []).map(Number).filter(Number.isFinite));
    const criticalLane = (sendOptions.criticalLane === 'heartbeat' || sendOptions.criticalLane === 'ace')
        ? sendOptions.criticalLane
        : undefined;
    const expectReply = sendOptions.expectReply !== false;

    // 班次由「显式 requestClass > priority 兼容映射 > 调度器注入的环境班次 > 前台」决定。
    const requestClass = resolveRequestClass(
        { priority: sendOptions.priority, requestClass: sendOptions.requestClass, criticalLane },
        getRequestPriority(),
    );

    const context = currentConnection;
    if (!context || !isCurrentConnection(context) || context.socket.readyState !== WebSocket.OPEN) {
        return Promise.reject(new Error(`连接未打开: ${methodName}`));
    }
    if (context.phase !== 'online') {
        return Promise.reject(new Error(`账号尚未登录: ${methodName}`));
    }

    // 每个班次有独立的排队配额
    if (isClassQueueFull(requestQueue, requestClass)) {
        return Promise.reject(new Error(
            `请求等待队列已满: ${methodName} (class=${requestClass}, limit=${maxQueuedForClass(requestClass)}, `
            + `queued=${requestQueue.length}, pending=${pendingCallbacks.size})`,
        ));
    }

    return new Promise((resolve, reject) => {
        const requestId = nextRequestId++;
        const request = {
            context,
            serviceName,
            methodName,
            bodyBytes,
            expectedErrorCodes,
            resolve,
            reject,
            timeoutKey: `request_timeout_${requestId}`,
            queueWaitKey: `request_queue_wait_${requestId}`,
            seq: null,
            settled: false,
            requestClass,
            criticalLane,
            enqueuedAt: Date.now(),
            expectReply,
        };
        requestQueue.push(request);
        networkScheduler.setTimeoutTask(request.timeoutKey, timeoutMs, () => {
            if (request.seq !== null) {
                pendingCallbacks.delete(request.seq);
                pendingStartedAt.delete(request.seq);
            }
            const index = requestQueue.indexOf(request);
            if (index >= 0) requestQueue.splice(index, 1);
            const stage = request.seq === null ? 'queued' : 'pending';
            settleQueuedRequest(request, new Error(
                `请求超时: ${methodName} (stage=${stage}, pending=${pendingCallbacks.size}, queued=${requestQueue.length}, active=${describePendingRequests()})`,
            ));
            drainRequestQueue();
        });
        // background 班次请求：拿不到空闲槽位就早点让路
        if (requestClass === 'background') {
            const queueWaitMs = Math.min(timeoutMs, 5000);
            networkScheduler.setTimeoutTask(request.queueWaitKey, queueWaitMs, () => {
                if (request.settled || request.seq !== null) return;
                const index = requestQueue.indexOf(request);
                if (index >= 0) requestQueue.splice(index, 1);
                settleQueuedRequest(request, new Error(
                    `网关繁忙，后台请求已让路: ${methodName} (waited=${queueWaitMs}ms, `
                    + `pending=${pendingCallbacks.size}, queued=${requestQueue.length})`,
                ));
            });
        }
        drainRequestQueue();
    });
}

// ============ 消息处理 ============
let lastInboundAt = Date.now();

function handleMessage(data) {
    try {
        const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
        const msg = types.GateMessage.decode(buf);
        lastInboundAt = Date.now();
        const meta = msg.meta;
        if (!meta) return;

        if (meta.server_seq) {
            const seq = toNum(meta.server_seq);
            if (seq > serverSeq) serverSeq = seq;
        }

        const msgType = meta.message_type;

        // Notify
        if (msgType === 3) {
            handleNotify(msg);
            return;
        }

        // Response
        if (msgType === 2) {
            const errorCode = toNum(meta.error_code);
            const clientSeqVal = toNum(meta.client_seq);

            const entry = pendingCallbacks.get(clientSeqVal);
            if (entry) {
                pendingCallbacks.delete(clientSeqVal);
                pendingStartedAt.delete(clientSeqVal);
                const fn = typeof entry === 'function' ? entry : (entry && entry.callback);
                if (typeof fn === 'function') {
                    if (errorCode !== 0) {
                        fn(new Error(`${meta.service_name}.${meta.method_name} 错误: code=${errorCode} ${meta.error_message || ''}`));
                    } else {
                        fn(null, msg.body, meta);
                    }
                }
                return;
            }

            if (errorCode !== 0) {
                logWarn('错误', `${meta.service_name}.${meta.method_name} code=${errorCode} ${meta.error_message || ''}`);
            }
        }
    } catch (err) {
        logWarn('解码', err.message);
    }
}

function handleNotify(msg) {
    if (!msg.body || msg.body.length === 0) return;
    try {
        const event = types.EventMessage.decode(msg.body);
        const type = event.message_type || '';
        const eventBody = event.body;

        // 通知只携带交易上下文，不在网关推送处理中追加支付查询。
        if (type.includes('RechargeInfoNotify')) {
            return;
        }

        // 被踢下线
        if (type.includes('Kickout')) {
            log('推送', `被踢下线! ${type}`);
            try {
                const notify = types.KickoutNotify.decode(eventBody);
                log('推送', `原因: ${notify.reason_message || '未知'}`);
                networkEvents.emit('kickout', {
                    type,
                    reason: notify.reason_message || '未知',
                });
            } catch { }
            return;
        }

        // 土地状态变化 (被放虫/放草/偷菜等)
        if (type.includes('LandsNotify')) {
            try {
                const notify = types.LandsNotify.decode(eventBody);
                const hostGid = toNum(notify.host_gid);
                const lands = notify.lands || [];
                if (lands.length > 0) {
                    if (hostGid === userState.gid || hostGid === 0) {
                        networkEvents.emit('landsChanged', lands);
                    } else {
                        networkEvents.emit('friendLandsObserved', {
                            gid: hostGid,
                            lands,
                            source: 'lands_notify',
                        });
                    }
                }
            } catch { }
            return;
        }

        if (type.includes('PendingGiftCountNotify')) {
            try {
                const notify = types.PendingGiftCountNotify.decode(eventBody);
                networkEvents.emit('dogSkillGiftPending', Math.max(0, toNum(notify.count)));
            } catch { }
            return;
        }

        // 物品变化通知 (经验/金币等)
        if (type.includes('ItemNotify')) {
            try {
                const notify = types.ItemNotify.decode(eventBody);
                const items = notify.items || [];
                for (const itemChg of items) {
                    const item = itemChg.item;
                    if (!item) continue;
                    const id = toNum(item.id);
                    const count = toNum(item.count);
                    const delta = toNum(itemChg.delta);

                    if (id === 1101) {
                        if (count > 0) userState.exp = count;
                        else if (delta !== 0) userState.exp = Math.max(0, Number(userState.exp || 0) + delta);
                        updateStatusLevel(userState.level, userState.exp);
                    } else if (id === 1 || id === 1001) {
                        if (count > 0) {
                            userState.gold = count;
                        } else if (delta !== 0) {
                            userState.gold = Math.max(0, Number(userState.gold || 0) + delta);
                        }
                        updateStatusGold(userState.gold);
                    } else if (id === 1002) {
                        if (count > 0) {
                            userState.coupon = count;
                        } else if (delta !== 0) {
                            userState.coupon = Math.max(0, Number(userState.coupon || 0) + delta);
                        }
                    } else if (id === 1005) {
                        if (count > 0) {
                            userState.goldBean = count;
                        } else if (delta !== 0) {
                            userState.goldBean = Math.max(0, Number(userState.goldBean || 0) + delta);
                        }
                    } else if (id === 1004) {
                        if (count > 0) {
                            userState.diamond = count;
                        } else if (delta !== 0) {
                            userState.diamond = Math.max(0, Number(userState.diamond || 0) + delta);
                        }
                    } else if (id === 101351) {
                        if (delta > 0 || count > 0) {
                            const giftDelta = delta > 0 ? delta : (count > 0 ? 1 : 0);
                            recordTongQiGift(giftDelta);
                            const currentCount = getTongQiGiftCount();
                            log('好友', `获得同气连枝礼包 +${giftDelta} (今日: ${currentCount})`, {
                                module: 'friend',
                                event: '同气连枝礼包',
                                result: 'ok',
                                count: giftDelta,
                                dailyTotal: currentCount,
                            });
                        }
                    }
                }
            } catch { }
            return;
        }

        // 基本信息变化 (升级等)
        if (type.includes('BasicNotify')) {
            try {
                const notify = types.BasicNotify.decode(eventBody);
                if (notify.basic) {
                    const oldLevel = userState.level;
                    if (hasOwn(notify.basic, 'level')) {
                        const nextLevel = toNum(notify.basic.level);
                        if (Number.isFinite(nextLevel) && nextLevel > 0) userState.level = nextLevel;
                    }
                    let shouldUpdateGoldView = false;
                    if (hasOwn(notify.basic, 'gold')) {
                        const nextGold = toNum(notify.basic.gold);
                        if (Number.isFinite(nextGold) && nextGold >= 0) {
                            userState.gold = nextGold;
                            shouldUpdateGoldView = true;
                        }
                    }
                    if (hasOwn(notify.basic, 'exp')) {
                        const exp = toNum(notify.basic.exp);
                        if (Number.isFinite(exp) && exp >= 0) {
                            userState.exp = exp;
                            updateStatusLevel(userState.level, exp);
                        }
                    }
                    if (shouldUpdateGoldView) {
                        updateStatusGold(userState.gold);
                    }
                    if (userState.level !== oldLevel) {
                        recordOperation('levelUp', 1);
                    }
                }
            } catch { }
            return;
        }

        // 好友申请通知 (微信同玩)
        if (type.includes('FriendApplicationReceivedNotify')) {
            try {
                const notify = types.FriendApplicationReceivedNotify.decode(eventBody);
                const applications = notify.applications || [];
                if (applications.length > 0) {
                    networkEvents.emit('friendApplicationReceived', applications);
                }
            } catch { }
            return;
        }

        // 好友添加成功通知
        if (type.includes('FriendAddedNotify')) {
            try {
                const notify = types.FriendAddedNotify.decode(eventBody);
                const friends = notify.friends || [];
                if (friends.length > 0) {
                    const names = friends.map(f => f.name || f.remark || `GID:${toNum(f.gid)}`).join(', ');
                    log('好友', `新好友: ${names}`);
                }
            } catch { }
            return;
        }

        // 商品解锁通知 (升级后解锁新种子等)
        if (type.includes('GoodsUnlockNotify')) {
            try {
                const notify = types.GoodsUnlockNotify.decode(eventBody);
                const goods = notify.goods_list || [];
                if (goods.length > 0) {
                    networkEvents.emit('goodsUnlockNotify', goods);
                }
            } catch { }
            return;
        }

        // 任务状态变化通知
        if (type.includes('TaskInfoNotify')) {
            try {
                const notify = types.TaskInfoNotify.decode(eventBody);
                if (notify.task_info) {
                    networkEvents.emit('taskInfoNotify', notify.task_info);
                }
            } catch { }
            return;
        }
    } catch (e) {
        logWarn('推送', `解码失败: ${e.message}`);
    }
}

// ============ 登录 ============
let currentConnection = null;
let wsErrorState = { code: 0, at: 0, message: '' };

function buildLoginDeviceInfo(deviceProtocol) {
    const custom = deviceProtocol && deviceProtocol.enabled ? deviceProtocol : null;
    if (!custom) {
        return {
            client_version: CONFIG.clientVersion,
            sys_software: 'Windows',
        };
    }

    const device = resolveDeviceFingerprint(custom);
    return {
        client_version: CONFIG.clientVersion,
        sys_software: device.sysSoftware,
        sys_hardware: `${device.deviceBrand} ${device.deviceModel}`,
        network: 'wifi',
        memory: device.memory,
        device_id: device.deviceId,
    };
}

function buildLoginBody(deviceProtocol) {
    return Buffer.from(types.LoginRequest.encode(types.LoginRequest.create({
        sharer_id: toLong(0),
        sharer_open_id: '',
        device_info: buildLoginDeviceInfo(deviceProtocol),
        share_cfg_id: toLong(0),
        scene_id: '1234567',
        report_data: {
            callback: '', cd_extend_info: '', click_id: '', clue_token: '',
            minigame_channel: 'other-qq', minigame_platid: 2, req_id: '', trackid: '',
        },
        extra: Buffer.alloc(0),
    })).finish());
}

async function sendLogin(context, onLoginSuccess, deviceProtocol) {
    const body = buildLoginBody(deviceProtocol);

    await sendMsg(context, 'gamepb.userpb.UserService', 'Login', body, {
        expectedErrorCodes: new Set(),
        requestClass: 'critical',
        callback(err, bodyBytes, _meta) {
            if (!isCurrentConnection(context)) return;
            if (err) {
                log('登录', `失败: ${err.message}`);
                if (err.message.includes('code=')) {
                    log('系统', '账号验证失败，即将停止运行...');
                    networkScheduler.setTimeoutTask('login_error_exit', 1000, () => process.exit(0));
                }
                return;
            }
            try {
                const reply = types.LoginReply.decode(bodyBytes);
                applyServerVersionInfo(reply.version_info);
                if (reply.basic) {
                    clearWsErrorState();
                    userState.gid = toNum(reply.basic.gid);
                    userState.name = reply.basic.name || '未知';
                    userState.level = toNum(reply.basic.level);
                    userState.gold = toNum(reply.basic.gold);
                    userState.exp = toNum(reply.basic.exp);
                    userState.openId = String(reply.basic.open_id || '').trim();
                    userState.avatar = String(reply.basic.avatar_url || '').trim();
                    if (tsdkRuntime && userState.openId) {
                        tsdkRuntime.bindUser(userState.openId);
                        const initTokenLength = gatewayTokens.stageInitToken(tsdkRuntime.getEncryptedInitInfo());
                        if (initTokenLength > 0) {
                            logAce('info', `ACE 用户身份已绑定：初始化凭据长度 ${initTokenLength}`);
                        }
                    }

                    updateStatusFromLogin({
                        gid: userState.gid,
                        name: userState.name,
                        level: userState.level,
                        gold: userState.gold,
                        exp: userState.exp,
                        openId: userState.openId,
                        avatar: userState.avatar,
                    });

                    log('系统', `登录成功: ${userState.name} (Lv${userState.level})`);

                    let loginTimeMs = 0;
                    if (reply.time_now_millis) {
                        const loginTime = toNum(reply.time_now_millis);
                        loginTimeMs = loginTime > 1e12 ? loginTime : loginTime * 1000;
                        syncServerTime(loginTimeMs);
                    }
                    logLoginSummary(loginTimeMs);
                }

                // 串行化登录引导：先设置用户同步，再调用 onLoginSuccess
                networkScheduler.clear('login_timeout');
                context.phase = 'online';
                startAceService();
                loginReady = true;
                startHeartbeat();
                // 登录后同步用户设置（串行），无论成功失败都调用 onLoginSuccess
                (async () => {
                    try { await fetchUserSettings(); } catch { /* 忽略 */ }
                    if (!isCurrentConnection(context)) return;
                    if (onLoginSuccess) onLoginSuccess();
                })();
            } catch (e) {
                log('登录', `解码失败: ${e.message}`);
            }
        },
    });
}

// ============ 心跳 ============
let lastHeartbeatResponse = Date.now();
let heartbeatMissCount = 0;
const HEARTBEAT_TIMEOUT = 15000;
const MAX_HEARTBEAT_MISS = 2;
const HEARTBEAT_REQUEST_TIMEOUT = 20000;

function getGatewayHealth() {
    const result = evaluateGatewayHealth({
        connected: isConnected(),
        heartbeatMisses: heartbeatMissCount,
        oldestPendingAgeMs: getOldestPendingAgeMs(pendingStartedAt.values(), Date.now()),
        pendingLimitMs: 5000,
    });
    return {
        ...result,
        pending: pendingCallbacks.size,
        queued: requestQueue.length,
    };
}

function buildHeartbeatBody(gid) {
    return Buffer.from(types.HeartbeatRequest.encode(types.HeartbeatRequest.create({
        gid: toLong(gid),
        client_version: CONFIG.clientVersion,
        field_3: toLong(0),
    })).finish());
}

function startHeartbeat() {
    networkScheduler.clear('heartbeat_interval');
    lastHeartbeatResponse = Date.now();
    lastInboundAt = Date.now();
    heartbeatMissCount = 0;

    networkScheduler.setIntervalTask('heartbeat_interval', CONFIG.heartbeatInterval, async () => {
        if (!userState.gid) return;

        const body = buildHeartbeatBody(userState.gid);
        try {
            const { body: replyBody } = await sendMsgAsync(
                'gamepb.userpb.UserService',
                'Heartbeat',
                body,
                { timeoutMs: HEARTBEAT_REQUEST_TIMEOUT, priority: 'high', criticalLane: 'heartbeat' },
            );
            lastHeartbeatResponse = Date.now();
            lastInboundAt = Date.now();
            heartbeatMissCount = 0;
            try {
                const reply = types.HeartbeatReply.decode(replyBody);
                applyServerVersionInfo(reply.version_info);
                if (reply.server_time) {
                    const serverTime = toNum(reply.server_time);
                    const serverTimeMs = serverTime > 1e12 ? serverTime : serverTime * 1000;
                    syncServerTime(serverTimeMs);
                }
            } catch { }
        } catch {
            if (!isConnected()) return;
            heartbeatMissCount += 1;
            const now = Date.now();
            const inboundSilenceMs = Math.max(0, now - lastInboundAt);
            const heartbeatSilenceMs = Math.max(0, now - lastHeartbeatResponse);
            logWarn(
                '心跳',
                `心跳未响应 (miss=${heartbeatMissCount}/${MAX_HEARTBEAT_MISS}, `
                + `heartbeat=${Math.round(heartbeatSilenceMs / 1000)}s, inbound=${Math.round(inboundSilenceMs / 1000)}s, `
                + `pending=${pendingCallbacks.size}, queued=${requestQueue.length}, active=${describePendingRequests()})`,
            );
            // 双重终止条件：心跳连续失联 AND 连接无入站数据
            if (heartbeatMissCount >= MAX_HEARTBEAT_MISS && inboundSilenceMs > HEARTBEAT_TIMEOUT * 2) {
                log('心跳', '连续心跳超时且连接无入站数据，账号将停止运行...');
                networkEvents.emit('disconnect', { code: 'heartbeat_timeout' });
                rejectAllPendingRequests('心跳超时，已清理');
                rejectAllQueuedRequests('心跳超时，已清理');
                try { if (ws) ws.close(); } catch { }
                return;
            }
            // 硬超时：心跳失联超过 45s 无条件强制重连
            if (heartbeatSilenceMs > 45000) {
                logWarn('心跳', '心跳失联超过 45s，强制重连...');
                try { if (ws) ws.close(); } catch { }
                networkEvents.emit('disconnect', { code: 'heartbeat_hard_timeout' });
                rejectAllPendingRequests('心跳硬超时，已清理');
                rejectAllQueuedRequests('心跳硬超时，已清理');
                reconnect(null);
                return;
            }
        }
    }, { preventOverlap: true });
}

// ============ WebSocket 连接 ============
let savedLoginCallback = null;
let savedCode = null;
let reconnectAttempts = 0;
let networkStopped = false;

function buildWebSocketHeaders(deviceProtocol) {
    const resourceVersion = String(CONFIG.clientVersion || '').split('_')[0];
    const headers = {
        'Origin': 'https://gate-obt.nqf.qq.com',
        'Referer': `https://appservice.qq.com/1112386029/${resourceVersion}/page-frame.html`,
    };
    const userAgent = resolveDeviceFingerprint(deviceProtocol).userAgent;
    if (userAgent) headers['User-Agent'] = userAgent;
    return headers;
}

const MAX_RECONNECT_ATTEMPTS = 10;
const RECONNECT_BASE_DELAY_MS = 2000;
const RECONNECT_MAX_DELAY_MS = 15000;

function closeCurrentWs({ terminate = false } = {}) {
    const current = ws;
    if (!current) return;
    ws = null;
    current.removeAllListeners();
    try {
        if (terminate && typeof current.terminate === 'function') current.terminate();
        else current.close();
    } catch { }
}

function getReconnectDelayMs() {
    const delay = RECONNECT_BASE_DELAY_MS * (2 ** Math.max(0, reconnectAttempts - 1));
    return Math.min(RECONNECT_MAX_DELAY_MS, delay);
}

function scheduleReconnect(reason) {
    if (networkStopped || !savedLoginCallback) return;
    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
        const message = `自动重连失败次数过多，已停止重连${reason ? ` (${reason})` : ''}`;
        logWarn('系统', `[WS] ${message}`);
        networkEvents.emit('reconnect_failed', {
            attempts: reconnectAttempts,
            reason: reason || '',
        });
        return;
    }

    reconnectAttempts += 1;
    const delayMs = getReconnectDelayMs();
    networkScheduler.setTimeoutTask('auto_reconnect', delayMs, () => {
        if (networkStopped || !savedLoginCallback) return;
        log('系统', `[WS] 尝试自动重连... (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);
        reconnect(null);
    });
}

function connect(code, onLoginSuccess) {
    networkStopped = false;
    savedLoginCallback = onLoginSuccess;
    if (code) savedCode = code;
    let deviceProtocol = null;
    try {
        const store = getStoreModule();
        deviceProtocol = store.getDeviceProtocolForAccount(process.env.FARM_ACCOUNT_ID);
    // eslint-disable-next-line unused-imports/no-unused-vars
    } catch (e) {
        log('system', `failed to load device protocol config: ${e.message}`, {
            module: 'network',
            event: 'device_protocol',
            isWarn: true,
        });
    }

    let deviceFingerprint;
    try {
        deviceFingerprint = resolveDeviceFingerprint(deviceProtocol);
    } catch (error) {
        logWarn('系统', `设备协议校验失败，已中止连接：${error.message}`);
        networkEvents.emit('security_error', { message: error.message });
        return;
    }
    const url = `${CONFIG.serverUrl}?platform=${CONFIG.platform}&os=${deviceFingerprint.os}&ver=${CONFIG.clientVersion}&code=${savedCode}&openID=`;
    closeCurrentWs({ terminate: true });

    if (deviceProtocol && deviceProtocol.enabled) {
        const deviceInfo = [
            `品牌: ${deviceProtocol.deviceBrand || '未设置'}`,
            `型号: ${deviceProtocol.deviceModel || '未设置'}`,
            `MAC: ${deviceProtocol.deviceMac || '未设置'}`,
            `设备ID: ${deviceProtocol.deviceId || '未设置'}`,
            `IMEI: ${deviceProtocol.imei || '未设置'}`,
        ].join(' | ');
        const userAgent = String(deviceProtocol.userAgent || '').trim();
        log('系统', `使用自定义设备协议登录\n${deviceInfo}\nUA: ${userAgent ? `${userAgent.substring(0, 100)}...` : '不发送'}`, {
            module: 'network',
            event: '设备协议',
        });
    }

    const socket = new WebSocket(url, {
        headers: buildWebSocketHeaders(deviceProtocol),
    });
    ws = socket;
    const context = {
        id: Date.now(),
        socket,
        phase: 'connecting',
        intentionalClose: false,
        finalized: false,
        loginInitialized: false,
    };
    currentConnection = context;

    socket.binaryType = 'arraybuffer';

    socket.on('open', async () => {
        if (!isCurrentConnection(context)) return;
        context.phase = 'login';
        reconnectAttempts = 0;
        networkScheduler.setTimeoutTask('login_timeout', 20000, () => {
            if (!isCurrentConnection(context) || context.phase !== 'login') return;
            logWarn('登录', '登录响应超时，账号将停止运行...');
            finalizeConnection(context, { source: 'login_timeout', reason: '登录响应超时' });
            try { socket.terminate(); } catch {}
        });
        try {
            await startSecurityRuntime(deviceProtocol);
            if (!isCurrentConnection(context)) return;
            await sendLogin(context, onLoginSuccess, deviceProtocol);
        } catch (error) {
            logWarn('ACE', `安全运行时启动失败，已中止登录：${error.message}`);
            networkEvents.emit('security_error', { message: error.message });
            stopSecurityRuntime('初始化失败');
            closeCurrentWs({ terminate: true });
        }
    });

    socket.on('message', (data) => {
        if (!isCurrentConnection(context)) return;
        handleMessage(Buffer.isBuffer(data) ? data : Buffer.from(data));
    });

    socket.on('close', (code, _reason) => {
        if (ws === socket) ws = null;
        const reason = Buffer.isBuffer(_reason) ? _reason.toString('utf8') : String(_reason || '');
        logWarn('系统', `[WS] 连接关闭 (code=${code})`);
        finalizeConnection(context, { source: 'ws_close', code: Number(code) || 0, reason });
        scheduleReconnect(`close:${code}`);
    });

    socket.on('error', (err) => {
        if (!isCurrentConnection(context)) return;
        const message = err && err.message ? String(err.message) : '';
        logWarn('系统', `[WS] 错误: ${message}`);
        const match = message.match(/Unexpected server response:\s*(\d+)/i);
        if (match) {
            const code = Number.parseInt(match[1], 10) || 0;
            if (code) {
                setWsErrorState(code, message);
                networkEvents.emit('ws_error', { code, message });
            }
        }
    });
}

function finalizeConnection(context, details) {
    if (context.finalized) return;
    context.finalized = true;
    const wasCurrent = currentConnection === context;
    if (wasCurrent) {
        currentConnection = null;
        ws = null;
        cleanup(details.reason || details.source);
    }
}

function cleanup(reason = '网络清理') {
    loginReady = false;
    stopSecurityRuntime(reason);
    rejectAllPendingRequests(`请求已中断: ${reason}`);
    rejectAllQueuedRequests(`请求已中断: ${reason}`);
    networkScheduler.clearAll();
}

function reconnect(newCode) {
    if (networkStopped || !savedLoginCallback) return false;
    cleanup('主动重连');
    closeCurrentWs({ terminate: true });
    userState.gid = 0;
    connect(newCode || savedCode, savedLoginCallback);
    return true;
}

function stopNetwork(reason = '停止网络') {
    networkStopped = true;
    loginReady = false;
    savedLoginCallback = null;
    reconnectAttempts = 0;
    stopSecurityRuntime(reason);
    rejectAllPendingRequests(`请求已中断: ${reason}`);
    rejectAllQueuedRequests(`请求已中断: ${reason}`);
    networkScheduler.clearAll();
    gatewayTokens.clear();
    closeCurrentWs({ terminate: true });
    userState.gid = 0;
}

function getWs() { return ws; }
function isConnected() { return !!(ws && ws.readyState === WebSocket.OPEN); }
function getAceStatus() {
    if (aceService) return aceService.getStatus();
    return tsdkRuntime ? { running: false, runtime: tsdkRuntime.getStatus() } : null;
}

module.exports = {
    connect, reconnect, cleanup, stopNetwork, getWs, isConnected,
    sendMsg: sendMsgLegacy, sendMsgAsync,
    getUserState,
    getWsErrorState,
    getGatewayHealth,
    getAceStatus,
    buildLoginDeviceInfo,
    buildLoginBody,
    buildHeartbeatBody,
    buildWebSocketHeaders,
    buildTsdkDeviceInfo,
    resolveDeviceFingerprint,
    extractServerClientVersion,
    applyServerVersionInfo,
    networkEvents,
    handleMessage,
    isLoginReady: () => loginReady,
};
