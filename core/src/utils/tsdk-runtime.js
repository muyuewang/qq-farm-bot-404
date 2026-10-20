const crypto = require('node:crypto');
const fs = require('node:fs');
const https = require('node:https');
const os = require('node:os');
const path = require('node:path');
const process = require('node:process');
const { performance } = require('node:perf_hooks');

const { ensureDataDir } = require('../config/runtime-paths');

const DEFAULT_APP_ID = '1112386029';
const OFFICIAL_VERSION = 'v3.9.0.1792070537';
const OFFICIAL_SHA256 = '837bd271557dc9a21d5cd28b66076ea012eb39a4f4cbe298f529716469c087fc';
// QQ 与微信各自一份 wasm：两份官方构建的导出符号相同，但内部埋点版本与小程应用标识不同，
// 用错构建会让 ACE 上报与网关版本号不一致。
const TSDK_BUILDS = Object.freeze({
    qq: { file: 'tsdk-v3.9.0.1792070537.wasm', version: OFFICIAL_VERSION, sha256: OFFICIAL_SHA256 },
    wx: { file: 'tsdk-wx.wasm', version: 'v3.9.0.1792070005', sha256: '1a9416db8b328e8957a079c583ffc5fc7e48d6af8c45aa40d9969dd68157beca' },
});
const MINI_PROGRAM_APP_IDS = Object.freeze({
    qq: DEFAULT_APP_ID,
    wx: 'wx5306c5978fdb76e4',
});

const DEFAULT_GAME_ID = 3167;
const DEFAULT_APP_KEY = '0';

function resolveTsdkPlatform(value) {
    const normalized = String(value || '').trim().toLowerCase();
    return normalized === 'wx' || normalized === 'wechat' ? 'wx' : 'qq';
}

const OFFICIAL_EXPORTS = {
    memory: 'w',
    createStats: 'y',
    reportUrls: 'z',
    createBuffer: 'A',
    destroyBuffer: 'B',
    getResult: 'C',
    reportStackHash: 'D',
    sendStatus: 'E',
    setFeatureGrayValue: 'F',
    initRuntime: 'G',
    getEncryptedInitInfo: 'H',
    getMsgLen: 'I',
    getMsg: 'J',
    checkFuncArray: 'K',
    addJsInfo: 'L',
    sendHeartbeatTick: 'M',
    getDataToServer: 'N',
    sendDataFromServer: 'O',
    processReceivedData: 'P',
    sendToGs: 'Q',
    sendToGsFast: 'R',
    notify: 'S',
    notifyUpper: 'T',
    generateToken: 'aa',
    encryptData: 'ba',
    decryptData: 'ca',
    encryptDataV2: 'da',
    decryptDataV2: 'ea',
    detectSpeedHack: 'fa',
};

const REQUIRED_EXPORTS = [
    'memory', 'createBuffer', 'destroyBuffer', 'getResult', 'initRuntime',
    'sendHeartbeatTick', 'getDataToServer', 'sendDataFromServer',
    'generateToken', 'encryptData', 'decryptData',
];
const MERGED_DATA_KEY = 1871261153;
// v3.9.0.1792070537 起只需预解密该元数据段，其余数据段由 wasm 的 decrypt_all_data 处理。
const MERGED_DATA_METADATA = [67371008, 404];

// This 64-byte table is part of the matching official JavaScript host wrapper.
const OFFICIAL_RUNTIME_TABLE = Buffer.from([
    93, 86, 110, 34, 65, 129, 8, 113, 53, 192, 121, 32, 86, 162, 255, 139,
    217, 70, 223, 0, 45, 176, 85, 103, 234, 116, 120, 194, 206, 7, 176, 222,
    56, 6, 161, 159, 154, 231, 93, 229, 39, 107, 197, 136, 167, 52, 155, 228,
    209, 117, 218, 8, 107, 241, 32, 62, 53, 200, 238,
]);

function sha256(buffer) {
    return crypto.createHash('sha256').update(buffer).digest('hex');
}

function asBuffer(value) {
    if (Buffer.isBuffer(value)) return value;
    if (value instanceof Uint8Array) return Buffer.from(value);
    if (value == null) return Buffer.alloc(0);
    return Buffer.from(value);
}

class TsdkRuntime {
    constructor(options = {}) {
        this.platform = resolveTsdkPlatform(options.platform);
        this.build = TSDK_BUILDS[this.platform];
        this.accountId = String(options.accountId || process.env.FARM_ACCOUNT_ID || 'unknown');
        this.appId = String(options.appId || MINI_PROGRAM_APP_IDS[this.platform]);
        this.gameId = Number(options.gameId || process.env.FARM_TSDK_GAME_ID || DEFAULT_GAME_ID);
        this.appKey = String(options.appKey ?? process.env.FARM_TSDK_APP_KEY ?? DEFAULT_APP_KEY);
        this.wasmPath = options.wasmPath || path.join(__dirname, this.build.file);
        this.loadedSha256 = '';
        this.dataDir = options.dataDir || path.join(ensureDataDir(), 'tsdk', this.accountId);
        this.deviceInfo = options.deviceInfo || {};
        this.logger = typeof options.logger === 'function' ? options.logger : () => {};
        this.instance = null;
        this.exports = null;
        this.memory = null;
        this.ready = false;
        this.destroyed = false;
        this.initializing = null;
        this.warned = new Set();
        this.serverTimeRequest = 0;
        this.metrics = {
            initializedAt: 0,
            tokenCount: 0,
            lastTokenLength: 0,
            lastTokenAt: 0,
            heartbeatTicks: 0,
            processTicks: 0,
            statusReports: 0,
            functionChecks: 0,
            userBound: false,
            lastError: '',
        };
    }

    warnOnce(key, message) {
        if (this.warned.has(key)) return;
        this.warned.add(key);
        this.logger('warn', message);
    }

    refreshViews() {
        if (!this.memory) throw new Error('TSDK memory is unavailable');
        this.u8 = new Uint8Array(this.memory.buffer);
        this.i32 = new Int32Array(this.memory.buffer);
        this.u32 = new Uint32Array(this.memory.buffer);
    }

    ensureBounds(ptr, length = 1) {
        const start = Number(ptr);
        const size = Number(length);
        if (!Number.isInteger(start) || !Number.isInteger(size) || start < 0 || size < 0
            || start + size > this.memory.buffer.byteLength) {
            throw new RangeError(`TSDK memory out of bounds: ptr=${start}, length=${size}`);
        }
    }

    readCString(ptr, maxLength = 1024 * 1024) {
        this.refreshViews();
        this.ensureBounds(ptr, 1);
        const limit = Math.min(this.u8.length, ptr + maxLength);
        let end = ptr;
        while (end < limit && this.u8[end] !== 0) end += 1;
        if (end === limit) throw new Error('TSDK string is not null terminated');
        return Buffer.from(this.u8.subarray(ptr, end)).toString('utf8');
    }

    writeCString(value, ptr, capacity) {
        const data = Buffer.from(String(value), 'utf8');
        if (data.length + 1 > capacity) return 0;
        this.refreshViews();
        this.ensureBounds(ptr, capacity);
        this.u8.set(data, ptr);
        this.u8[ptr + data.length] = 0;
        return ptr;
    }

    writeBytes(value, ptr, capacity) {
        const data = asBuffer(value);
        if (data.length > capacity) return 0;
        this.refreshViews();
        this.ensureBounds(ptr, capacity);
        this.u8.set(data, ptr);
        return data.length;
    }

    resolveDataPath(input) {
        const value = String(input || '').replaceAll('\\', '/');
        const relative = value.replace(/^\/+/, '');
        const target = path.resolve(this.dataDir, relative);
        const root = `${path.resolve(this.dataDir)}${path.sep}`;
        if (target !== path.resolve(this.dataDir) && !target.startsWith(root)) {
            throw new Error('TSDK file path escaped its account data directory');
        }
        return target;
    }

    createImports() {
        const runtime = this;
        const device = () => {
            const model = runtime.deviceInfo.deviceModel || `${os.type()} ${os.arch()}`;
            const platform = runtime.deviceInfo.platform || process.platform;
            const system = runtime.deviceInfo.system || os.release();
            const brand = runtime.deviceInfo.deviceBrand || 'Node.js';
            const deviceId = runtime.deviceInfo.deviceId || '';
            const deviceMac = runtime.deviceInfo.deviceMac || '';
            const imei = runtime.deviceInfo.imei || '';
            return `${model};${platform};${system};${brand};${deviceId};${deviceMac};${imei};`;
        };
        const stringProvider = value => (ptr, capacity) => runtime.writeCString(value(), ptr, capacity);

        return {
            a: {
                // Official mapping: assertion, filesystem, stack, version, JS integrity,
                // sensors, file read, clock, user path, device, runtime table, debug,
                // app id, game id, function integrity, stat, server time, memory growth,
                // wall clock, append, abort and TQOS network report.
                a: (expr, file, line, func) => {
                    throw new Error(`TSDK assertion: ${runtime.readCString(expr)} at ${file ? runtime.readCString(file) : 'unknown'}:${line} ${func ? runtime.readCString(func) : ''}`);
                },
                b: (filePtr, dataPtr, encodingPtr) => {
                    try {
                        const target = runtime.resolveDataPath(runtime.readCString(filePtr));
                        fs.mkdirSync(path.dirname(target), { recursive: true });
                        fs.writeFileSync(target, runtime.readCString(dataPtr), runtime.readCString(encodingPtr) || 'utf8');
                        return 1;
                    } catch (error) {
                        runtime.warnOnce('file-write', `TSDK file write unavailable: ${error.message}`);
                        return 0;
                    }
                },
                c: (ptr, capacity) => {
                    const stack = new Error('TSDK stack capture').stack || '';
                    return runtime.writeCString(stack, ptr, capacity)
                        ? Buffer.byteLength(stack, 'utf8') + 1 : 0;
                },
                d: stringProvider(() => runtime.build.version),
                e: () => {
                    runtime.warnOnce('acevm', 'TSDK JS integrity VM is unavailable in Node.js; using the official empty-result downgrade.');
                    return 0;
                },
                f: () => runtime.warnOnce('sensors', 'TSDK touch and gyroscope input is unavailable in Node.js.'),
                g: (filePtr, outPtr, capacity, encodingPtr) => {
                    try {
                        const data = fs.readFileSync(
                            runtime.resolveDataPath(runtime.readCString(filePtr)),
                            runtime.readCString(encodingPtr) || 'utf8',
                        );
                        return runtime.writeCString(data, outPtr, capacity);
                    } catch {
                        return 0;
                    }
                },
                h: (clockId, low, high, outPtr) => {
                    if (clockId < 0 || clockId > 3) return 28;
                    const value = Math.round((clockId === 0 ? Date.now() : performance.now()) * 1e6);
                    runtime.refreshViews();
                    runtime.ensureBounds(outPtr, 8);
                    runtime.u32[outPtr >> 2] = value >>> 0;
                    runtime.u32[(outPtr + 4) >> 2] = Math.floor(value / 0x100000000) >>> 0;
                    return 0;
                },
                i: stringProvider(() => `${runtime.dataDir}${path.sep}`),
                j: stringProvider(device),
                k: (ptr, capacity) => runtime.writeBytes(OFFICIAL_RUNTIME_TABLE, ptr, capacity),
                l: () => 2,
                m: stringProvider(() => runtime.appId),
                n: stringProvider(() => runtime.appId),
                o: () => runtime.warnOnce('integrity-functions', 'TSDK mini-program function integrity checks are unavailable in Node.js.'),
                p: (filePtr) => {
                    try {
                        const stat = fs.statSync(runtime.resolveDataPath(runtime.readCString(filePtr)));
                        if (!runtime.exports || !runtime.exports.createStats) return 0;
                        return runtime.exports.createStats(
                            stat.mode,
                            Math.min(0x7FFFFFFF, stat.size),
                            Math.floor(stat.atimeMs),
                            Math.floor(stat.mtimeMs),
                        );
                    } catch {
                        return 0;
                    }
                },
                q: (outPtr) => {
                    const generation = ++runtime.serverTimeRequest;
                    runtime.refreshViews();
                    runtime.ensureBounds(outPtr, 4);
                    runtime.i32[outPtr >> 2] = Math.floor(Date.now() / 1000);
                    https.get('https://api.anticheatexpert.com/test', { timeout: 3000 }, (response) => {
                        response.resume();
                        if (generation !== runtime.serverTimeRequest) return;
                        const parsed = Date.parse(response.headers.date || '');
                        runtime.refreshViews();
                        if (parsed) runtime.i32[outPtr >> 2] = Math.floor(parsed / 1000);
                    }).on('error', () => {});
                    return 1;
                },
                r: size => {
                    throw new Error(`TSDK cannot grow memory to ${size} bytes`);
                },
                s: () => Date.now(),
                t: (filePtr, dataPtr, encodingPtr) => {
                    try {
                        const target = runtime.resolveDataPath(runtime.readCString(filePtr));
                        fs.mkdirSync(path.dirname(target), { recursive: true });
                        fs.appendFileSync(target, runtime.readCString(dataPtr), runtime.readCString(encodingPtr) || 'utf8');
                        return 1;
                    } catch {
                        return 0;
                    }
                },
                u: () => {
                    throw new Error('TSDK aborted');
                },
                v: (ptr, length) => {
                    try {
                        runtime.refreshViews();
                        runtime.ensureBounds(ptr, length);
                        const report = JSON.parse(
                            Buffer.from(runtime.u8.subarray(ptr, ptr + length)).toString('utf8'),
                        );
                        const body = typeof report.message === 'string'
                            ? report.message
                            : JSON.stringify(report.message ?? {});
                        const request = https.request('https://api.anticheatexpert.com/tqos', {
                            method: 'POST',
                            headers: report.headers || {},
                            timeout: 5000,
                        }, response => response.resume());
                        request.on('error', error => runtime.warnOnce('tqos', `TSDK TQOS report failed: ${error.message}`));
                        request.end(body);
                        return 1;
                    } catch (error) {
                        runtime.warnOnce('tqos', `TSDK TQOS report rejected: ${error.message}`);
                        return 0;
                    }
                },
            },
        };
    }

    bindExports(rawExports) {
        const bound = {};
        for (const [name, symbol] of Object.entries(OFFICIAL_EXPORTS)) {
            bound[name] = rawExports[symbol];
        }
        const missing = REQUIRED_EXPORTS.filter(name => !bound[name]);
        if (missing.length) throw new Error(`TSDK exports mismatch: missing ${missing.join(', ')}`);
        return bound;
    }

    async init() {
        if (this.ready) return this;
        if (this.initializing) return this.initializing;
        if (this.destroyed) throw new Error('TSDK runtime has been destroyed');

        this.initializing = (async () => {
            const startedAt = performance.now();
            const wasm = fs.readFileSync(this.wasmPath);
            const actualHash = sha256(wasm);
            if (actualHash !== this.build.sha256) {
                throw new Error(`TSDK WASM checksum mismatch: expected ${this.build.sha256}, got ${actualHash}`);
            }
            this.loadedSha256 = actualHash;
            fs.mkdirSync(this.dataDir, { recursive: true });
            const { instance } = await WebAssembly.instantiate(wasm, this.createImports());
            this.instance = instance;
            this.memory = instance.exports[OFFICIAL_EXPORTS.memory];
            this.exports = this.bindExports(instance.exports);
            this.refreshViews();
            const decryptSegment = instance.exports.__mergewasm_shared____wasm_decrypt_strings;
            if (typeof decryptSegment !== 'function') {
                throw new TypeError('TSDK merged-data decryptor is missing');
            }
            const decryptAllData = instance.exports.decrypt_all_data;
            if (typeof decryptAllData !== 'function') {
                throw new TypeError('TSDK full-data decryptor is missing');
            }
            // v3.9.0.1792070537 起官方 mergewasm 改由 wasm 自身解密全部数据段：
            // 宿主只预解密元数据段 [67371008, 404]，再调用 decrypt_all_data()，
            // 最后调用导出 x() 触发构造。与上游仓库接口保持一致，不再逐段手动解密。
            const [metadataPtr, metadataLength] = MERGED_DATA_METADATA;
            this.ensureBounds(metadataPtr, metadataLength);
            decryptSegment(metadataPtr, metadataLength, MERGED_DATA_KEY);
            decryptAllData();
            if (typeof instance.exports.x !== 'function') {
                throw new TypeError('TSDK runtime bootstrap export x is missing');
            }
            instance.exports.x();

            const key = this.allocCString(this.appKey);
            try {
                this.exports.initRuntime(this.gameId, key.ptr);
            } finally {
                this.free(key.ptr);
            }
            this.ready = true;
            this.metrics.initializedAt = Date.now();
            this.logger('info', `ACE 初始化成功：${this.build.version}（${this.platform}），耗时 ${Math.round(performance.now() - startedAt)}ms`);
            return this;
        })().catch((error) => {
            this.metrics.lastError = error.message;
            this.logger('error', `ACE 初始化失败：${error.message}`);
            this.destroy();
            throw error;
        });
        return this.initializing;
    }

    assertReady() {
        if (!this.ready || !this.exports || this.destroyed) throw new Error('TSDK runtime is not ready');
    }

    alloc(length) {
        this.assertNotDestroyed();
        const size = Math.max(1, Number(length) || 0);
        const ptr = this.exports.createBuffer(size);
        if (!ptr) throw new Error(`TSDK failed to allocate ${size} bytes`);
        this.refreshViews();
        this.ensureBounds(ptr, size);
        return ptr;
    }

    allocBytes(value) {
        const data = asBuffer(value);
        const ptr = this.alloc(data.length || 1);
        if (data.length) this.u8.set(data, ptr);
        return { ptr, length: data.length };
    }

    allocCString(value) {
        const data = Buffer.from(String(value), 'utf8');
        const ptr = this.alloc(data.length + 1);
        this.u8.set(data, ptr);
        this.u8[ptr + data.length] = 0;
        return { ptr, length: data.length };
    }

    free(ptr) {
        if (ptr && this.exports && this.exports.destroyBuffer) this.exports.destroyBuffer(ptr);
    }

    assertNotDestroyed() {
        if (this.destroyed) throw new Error('TSDK runtime has been destroyed');
        if (!this.exports) throw new Error('TSDK runtime is not initialized');
    }

    transformInPlace(value, operation) {
        this.assertReady();
        const input = this.allocBytes(value);
        try {
            operation(input.ptr, input.length);
            this.refreshViews();
            this.ensureBounds(input.ptr, input.length);
            return Buffer.from(this.u8.subarray(input.ptr, input.ptr + input.length));
        } finally {
            this.free(input.ptr);
        }
    }

    encrypt(value) {
        return this.transformInPlace(value, this.exports.encryptData);
    }

    decrypt(value) {
        return this.transformInPlace(value, this.exports.decryptData);
    }

    generateToken(value) {
        this.assertReady();
        const startedAt = performance.now();
        const input = this.allocBytes(value);
        let resultPtr = 0;
        try {
            resultPtr = this.exports.generateToken(input.ptr, input.length);
            if (!resultPtr) throw new Error('TSDK returned an empty token pointer');
            const text = this.readCString(resultPtr, 64 * 1024);
            let result = { token: text, nonce: '' };
            if (text.startsWith('{')) {
                const parsed = JSON.parse(text);
                result = { token: String(parsed.token || ''), nonce: String(parsed.nonce || '') };
            }
            if (!result.token) {
                throw new Error('TSDK returned an invalid token result');
            }
            this.metrics.tokenCount += 1;
            this.metrics.lastTokenLength = result.token.length;
            this.metrics.lastTokenAt = Date.now();
            this.logger('debug', `TSDK Token 已生成：长度 ${result.token.length}，耗时 ${Math.round(performance.now() - startedAt)}ms`);
            return result;
        } finally {
            this.free(input.ptr);
            this.free(resultPtr);
        }
    }

    heartbeatTick() {
        this.assertReady();
        this.exports.sendHeartbeatTick();
        this.metrics.heartbeatTicks += 1;
    }

    processReceivedData() {
        this.assertReady();
        this.exports.processReceivedData();
        this.metrics.processTicks += 1;
    }

    sendStatus() {
        this.assertReady();
        this.exports.sendStatus();
        this.metrics.statusReports += 1;
    }

    detectSpeedHack(elapsedMs) {
        this.assertReady();
        if (typeof this.exports.detectSpeedHack === 'function') {
            this.exports.detectSpeedHack(Math.max(0, Math.floor(Number(elapsedMs) || 0)));
        }
    }

    checkFunctionArray(functions, type) {
        this.assertReady();
        const values = (functions || [])
            .filter(value => typeof value === 'function' || typeof value === 'string')
            .map(value => typeof value === 'function' ? value.toString() : value);
        if (!values.length) return;

        const strings = values.map(value => this.allocCString(value));
        const pointers = this.alloc(strings.length * 4);
        try {
            this.refreshViews();
            strings.forEach((value, index) => {
                this.u32[(pointers >> 2) + index] = value.ptr;
            });
            this.exports.checkFuncArray(pointers, strings.length, Number(type) || 0);
            this.metrics.functionChecks += 1;
        } finally {
            strings.forEach(value => this.free(value.ptr));
            this.free(pointers);
        }
    }

    bindUser(openId) {
        this.assertReady();
        const value = String(openId || '').trim();
        if (!value) return false;
        const input = this.allocCString(value);
        try {
            // 官方 AnoUserLogin(0, openId) 后，封装用账号身份刷新运行时。
            this.exports.initRuntime(this.gameId, input.ptr);
            this.metrics.userBound = true;
            return true;
        } finally {
            this.free(input.ptr);
        }
    }

    getEncryptedInitInfo() {
        this.assertReady();
        const ptr = this.exports.getEncryptedInitInfo();
        return ptr ? this.readCString(ptr, 64 * 1024) : '';
    }

    getDataToServer() {
        this.assertReady();
        const lengthPtr = this.alloc(4);
        try {
            this.refreshViews();
            this.i32[lengthPtr >> 2] = 0;
            const dataPtr = this.exports.getDataToServer(lengthPtr);
            this.refreshViews();
            const length = this.i32[lengthPtr >> 2];
            if (!dataPtr || length <= 0) return Buffer.alloc(0);
            this.ensureBounds(dataPtr, length);
            return Buffer.from(this.u8.subarray(dataPtr, dataPtr + length));
        } finally {
            this.free(lengthPtr);
        }
    }

    sendDataFromServer(value) {
        this.assertReady();
        const input = this.allocBytes(value);
        try {
            this.exports.sendDataFromServer(input.ptr, input.length);
        } finally {
            this.free(input.ptr);
        }
    }

    getResult() {
        this.assertReady();
        const ptr = this.exports.getResult();
        if (!ptr) return [];
        this.refreshViews();
        this.ensureBounds(ptr, 64);
        return Array.from(this.u8.subarray(ptr, ptr + 64));
    }

    getStatus() {
        return {
            accountId: this.accountId,
            platform: this.platform,
            version: this.build.version,
            wasmPath: this.wasmPath,
            wasmSha256: this.loadedSha256,
            ready: this.ready,
            destroyed: this.destroyed,
            ...this.metrics,
        };
    }

    destroy() {
        this.ready = false;
        this.destroyed = true;
        this.serverTimeRequest += 1;
        this.instance = null;
        this.exports = null;
        this.memory = null;
        this.u8 = null;
        this.i32 = null;
        this.u32 = null;
    }
}

module.exports = {
    TsdkRuntime,
    OFFICIAL_VERSION,
    OFFICIAL_SHA256,
    OFFICIAL_EXPORTS,
    TSDK_BUILDS,
    MINI_PROGRAM_APP_IDS,
    resolveTsdkPlatform,
};
