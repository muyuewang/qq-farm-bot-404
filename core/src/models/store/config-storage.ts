export {};

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { readJsonFileStrict, writeTextFileAtomic, storageError } = require('../../services/json-db');

const FORMAT_VERSION = 1;
const FORMAT_FILE = '.format.json';

function assertObject(value: any, file: string): Record<string, any> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw storageError('读取', file, new Error('Expected a JSON object'));
    }
    return value;
}

function accountFilename(id: string): string {
    if (!id || id !== id.trim()) throw new Error('Invalid account ID');
    // Numeric IDs stay readable. Hex encoding avoids traversal, Windows reserved
    // names, and case-insensitive filename collisions for other legacy IDs.
    const name = /^\d+$/.test(id) ? id : `id-${Buffer.from(id, 'utf8').toString('hex')}`;
    return `${name}.json`;
}

function accountIdFromFilename(filename: string): string {
    const name = filename.slice(0, -5);
    const id = /^\d+$/.test(name) ? name
        : /^id-(?:[0-9a-f]{2})+$/.test(name) ? Buffer.from(name.slice(3), 'hex').toString('utf8') : '';
    if (accountFilename(id) !== filename) throw new Error('Invalid account filename');
    return id;
}

/** Only account settings use this store; spending ledgers and resource holds do not. */
function createConfigStorage(storeFile: string) {
    const accountDir = path.join(path.dirname(storeFile), 'account-configs');
    const accountJson = new Map<string, string>();
    let split = false;
    let globalDocument: Record<string, any> = {};
    let globalJson: string | null = null;

    function writeDocument(file: string, value: any): string {
        try {
            const json = JSON.stringify(value, null, 2);
            writeTextFileAtomic(file, json);
            return json;
        } catch (error: any) {
            throw storageError('保存', file, error);
        }
    }

    function readSplit(): Record<string, any> {
        const formatFile = path.join(accountDir, FORMAT_FILE);
        const format = readJsonFileStrict(formatFile);
        if (format?.version !== FORMAT_VERSION) throw storageError('读取', formatFile, new Error('Unsupported config format'));
        const configs = Object.create(null);
        const serialized = new Map<string, string>();
        for (const entry of fs.readdirSync(accountDir, { withFileTypes: true })) {
            if (entry.name === FORMAT_FILE || !entry.name.endsWith('.json')) continue;
            const file = path.join(accountDir, entry.name);
            let id: string;
            try { id = accountIdFromFilename(entry.name); }
            catch {
                // Copies such as "1 - 副本.json" can never be an account document.
                // Skipping them keeps one stray file from stopping every account.
                console.warn('[系统] 跳过无法识别的账号配置文件:', file);
                continue;
            }
            if (!entry.isFile()) throw storageError('读取', file, new Error('Expected a regular file'));
            configs[id] = assertObject(readJsonFileStrict(file), file);
            serialized.set(id, JSON.stringify(configs[id], null, 2));
        }
        accountJson.clear();
        for (const [id, json] of serialized) accountJson.set(id, json);
        split = true;
        return configs;
    }

    function saveGlobal(data: Record<string, any>): void {
        const { accountConfigs: _accounts, accountConfigStorageVersion: _version, ...document } = data;
        if (split) document.accountConfigStorageVersion = FORMAT_VERSION;
        let json: string;
        try { json = JSON.stringify(document, null, 2); }
        catch (error: any) { throw storageError('保存', storeFile, error); }
        if (json !== globalJson) {
            try { writeTextFileAtomic(storeFile, json); }
            catch (error: any) { throw storageError('保存', storeFile, error); }
        }
        globalDocument = document;
        globalJson = json;
    }

    function publishSplit(configs: Record<string, any>, backup: boolean): Record<string, any> {
        const stage = `${accountDir}.migrating-${randomUUID()}`;
        try {
            for (const [id, config] of Object.entries(configs)) assertObject(config, path.join(stage, accountFilename(id)));
            // Failed attempts leave the original source intact. A staged directory
            // is never loaded; only its final atomic rename publishes the format.
            if (backup) fs.copyFileSync(storeFile, `${storeFile}.${randomUUID()}.bak`, fs.constants.COPYFILE_EXCL);
            fs.mkdirSync(stage, { recursive: true });
            for (const [id, config] of Object.entries(configs)) {
                const file = path.join(stage, accountFilename(id));
                assertObject(config, file);
                const json = writeDocument(file, config);
                if (JSON.stringify(readJsonFileStrict(file), null, 2) !== json) throw new Error('Migration verification failed');
            }
            writeDocument(path.join(stage, FORMAT_FILE), { version: FORMAT_VERSION });
            try { fs.renameSync(stage, accountDir); }
            catch (error: any) {
                // Another startup may have finished migration first. Never replace
                // that directory with an older staged copy.
                if (!fs.existsSync(accountDir)) throw error;
            }
            return readSplit();
        } catch (error: any) {
            throw storageError('迁移', storeFile, error);
        }
    }

    function load(options: { migrate?: boolean } = {}): Record<string, any> {
        try {
            const data = assertObject(readJsonFileStrict(storeFile, () => ({})), storeFile);
            globalDocument = data;
            globalJson = JSON.stringify(data, null, 2);
            accountJson.clear();
            split = false;
            const version = data.accountConfigStorageVersion;
            if (version !== undefined && version !== FORMAT_VERSION) throw new Error('Unsupported config format');
            const legacy = data.accountConfigs === undefined ? {} : assertObject(data.accountConfigs, storeFile);
            let configs = legacy;
            if (fs.existsSync(accountDir)) {
                configs = readSplit();
                // Leftover aggregate settings (failed cleanup, or edits made by an
                // older version) are about to be dropped; keep a copy first.
                if (options.migrate !== false && Object.keys(legacy).length) {
                    fs.copyFileSync(storeFile, `${storeFile}.${randomUUID()}.bak`, fs.constants.COPYFILE_EXCL);
                }
            }
            else if (version !== undefined) throw new Error('Missing account-configs directory');
            else if (options.migrate !== false && Object.keys(legacy).length) configs = publishSplit(legacy, true);
            if (split && options.migrate !== false) saveGlobal(data);
            return { ...data, accountConfigs: configs };
        } catch (error: any) {
            throw storageError('读取', storeFile, error);
        }
    }

    function saveAccount(id: string, config: any): void {
        let file = storeFile;
        try {
            file = path.join(accountDir, accountFilename(id));
            assertObject(config, file);
            const json = JSON.stringify(config, null, 2);
            if (!split) {
                publishSplit({ [id]: config }, false);
            }
            if (globalDocument.accountConfigStorageVersion !== FORMAT_VERSION) saveGlobal(globalDocument);
            if (accountJson.get(id) !== json) {
                writeTextFileAtomic(file, json);
                accountJson.set(id, json);
            }
        } catch (error: any) {
            throw storageError('保存', file, error);
        }
    }

    function removeAccount(id: string): void {
        if (!split) return;
        const file = path.join(accountDir, accountFilename(id));
        try { fs.unlinkSync(file); }
        catch (error: any) { if (error.code !== 'ENOENT') throw storageError('保存', file, error); }
        accountJson.delete(id);
    }

    return { load, saveGlobal, saveAccount, removeAccount };
}

module.exports = { createConfigStorage };
