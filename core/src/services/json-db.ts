export {};
const fs = require('node:fs');
const path = require('node:path');
function ensureParentDir(filePath: string): void {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

function readTextFile(filePath: string, fallback = ''): string {
    try {
        if (!fs.existsSync(filePath)) return fallback;
        return fs.readFileSync(filePath, 'utf8');
    } catch {
        return fallback;
    }
}

function readJsonFile(filePath: string, fallbackFactory: () => any = () => ({})): any {
    const fallback = typeof fallbackFactory === 'function' ? fallbackFactory() : (fallbackFactory || {});
    try {
        if (!fs.existsSync(filePath)) return fallback;
        const raw = fs.readFileSync(filePath, 'utf8');
        if (!raw || !raw.trim()) return fallback;
        return JSON.parse(raw);
    } catch {
        return fallback;
    }
}

// Configuration reads must distinguish a missing file from a damaged or unreadable one.
// Keep the existing tolerant readers unchanged for their current callers.
function storageError(action: string, filePath: string, cause: any): Error {
    if (String(cause?.code || '').startsWith('STORAGE_')) return cause;
    const code = action === '读取' ? 'STORAGE_READ_FAILED'
        : action === '迁移' ? 'STORAGE_MIGRATION_FAILED' : 'STORAGE_WRITE_FAILED';
    return Object.assign(new Error(`${action} ${path.basename(filePath)} 失败，请检查数据文件、目录权限和磁盘空间`, { cause }), {
        code, filePath,
    });
}

function readJsonFileStrict(filePath: string, fallbackFactory?: () => any): any {
    let raw: string;
    try {
        raw = fs.readFileSync(filePath, 'utf8');
    } catch (error: any) {
        if (error.code === 'ENOENT' && fallbackFactory) return fallbackFactory();
        throw storageError('读取', filePath, error);
    }
    try {
        return JSON.parse(raw);
    } catch (error: any) {
        throw storageError('读取', filePath, error);
    }
}

function writeJsonFileAtomic(filePath: string, data: any, space = 2): void {
    const json = JSON.stringify(data, null, space);
    writeTextFileAtomic(filePath, json);
}

function writeTextFileAtomic(filePath: string, text = ''): void {
    ensureParentDir(filePath);
    const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;

    try {
        fs.writeFileSync(tmpPath, String(text), 'utf8');
        fs.renameSync(tmpPath, filePath);
    } finally {
        try {
            if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
        } catch {
            // ignore cleanup errors
        }
    }
}

module.exports = {
    readTextFile,
    readJsonFile,
    readJsonFileStrict,
    storageError,
    writeTextFileAtomic,
    writeJsonFileAtomic,
};
