export {};
const fs = require('node:fs');
const crypto = require('node:crypto');
const { getDataFile, ensureDataDir } = require('../config/runtime-paths');

const LOGIN_ATTEMPTS_FILE: string = getDataFile('login-attempts.json');
const ADMIN_ATTEMPT_KEY = 'admin';

const SALT_LENGTH = 32;
const ITERATIONS = 100000;
const KEY_LENGTH = 64;
const DIGEST = 'sha512';
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION = 15 * 60 * 1000;
const RATE_LIMIT_WINDOW = 60 * 1000;
const MAX_ATTEMPTS_PER_IP = 10;

interface LoginAttempt {
    count: number;
    windowStart?: number;
    firstAttempt?: number;
    lastAttempt?: number;
    lockedUntil?: number;
}

interface PasswordStrengthResult {
    valid: boolean;
    errors: string[];
}

let loginAttempts: Record<string, LoginAttempt> = {};

function loadLoginAttempts(): void {
    ensureDataDir();
    try {
        if (!fs.existsSync(LOGIN_ATTEMPTS_FILE)) {
            loginAttempts = {};
            return;
        }
        const raw = JSON.parse(fs.readFileSync(LOGIN_ATTEMPTS_FILE, 'utf8'));
        const source = raw && typeof raw === 'object' ? raw : {};
        loginAttempts = {};
        for (const [key, value] of Object.entries(source)) {
            if ((key === ADMIN_ATTEMPT_KEY || key.startsWith('ip:')) && value && typeof value === 'object') {
                loginAttempts[key] = value as LoginAttempt;
            }
        }
        const legacyAdmin = source['user:admin'];
        if (!loginAttempts[ADMIN_ATTEMPT_KEY] && legacyAdmin && typeof legacyAdmin === 'object') {
            loginAttempts[ADMIN_ATTEMPT_KEY] = legacyAdmin as LoginAttempt;
        }
    } catch {
        loginAttempts = {};
    }
}

function saveLoginAttempts(): void {
    ensureDataDir();
    try {
        fs.writeFileSync(LOGIN_ATTEMPTS_FILE, JSON.stringify(loginAttempts, null, 2), 'utf8');
    } catch (e: any) {
        console.error('保存登录尝试记录失败:', e.message);
    }
}

function cleanExpiredAttempts(): void {
    const now = Date.now();
    let changed = false;
    for (const key of Object.keys(loginAttempts)) {
        const attempt = loginAttempts[key];
        if ((attempt.lockedUntil && attempt.lockedUntil < now)
            || (attempt.windowStart && now - attempt.windowStart > RATE_LIMIT_WINDOW)) {
            delete loginAttempts[key];
            changed = true;
        }
    }
    if (changed) saveLoginAttempts();
}

function checkRateLimit(ip: string): { allowed: boolean; remainingMs?: number; message?: string } {
    cleanExpiredAttempts();
    const key = `ip:${ip}`;
    const now = Date.now();
    const attempt = loginAttempts[key];
    if (!attempt || now - (attempt.windowStart || 0) > RATE_LIMIT_WINDOW) {
        loginAttempts[key] = { count: 1, windowStart: now };
        saveLoginAttempts();
        return { allowed: true };
    }
    if (attempt.count >= MAX_ATTEMPTS_PER_IP) {
        const remainingMs = RATE_LIMIT_WINDOW - (now - (attempt.windowStart || 0));
        return { allowed: false, remainingMs, message: `请求过于频繁，请 ${Math.ceil(remainingMs / 1000)} 秒后重试` };
    }
    attempt.count++;
    saveLoginAttempts();
    return { allowed: true };
}

function checkAdminLockout(): { locked: boolean; remainingMs?: number; message?: string } {
    cleanExpiredAttempts();
    const attempt = loginAttempts[ADMIN_ATTEMPT_KEY];
    const now = Date.now();
    if (attempt?.lockedUntil && attempt.lockedUntil > now) {
        const remainingMs = attempt.lockedUntil - now;
        return { locked: true, remainingMs, message: `账户已被锁定，请 ${Math.ceil(remainingMs / 60000)} 分钟后重试` };
    }
    return { locked: false };
}

function recordFailedAttempt(): { locked: boolean; message?: string; remainingAttempts?: number } {
    const now = Date.now();
    const attempt = loginAttempts[ADMIN_ATTEMPT_KEY] || { count: 0, firstAttempt: now };
    attempt.count++;
    attempt.lastAttempt = now;
    loginAttempts[ADMIN_ATTEMPT_KEY] = attempt;
    if (attempt.count >= MAX_LOGIN_ATTEMPTS) {
        attempt.lockedUntil = now + LOCKOUT_DURATION;
        saveLoginAttempts();
        return { locked: true, message: `登录失败次数过多，账户已被锁定 ${LOCKOUT_DURATION / 60000} 分钟` };
    }
    saveLoginAttempts();
    return { locked: false, remainingAttempts: MAX_LOGIN_ATTEMPTS - attempt.count };
}

function clearFailedAttempts(): void {
    if (loginAttempts[ADMIN_ATTEMPT_KEY]) {
        delete loginAttempts[ADMIN_ATTEMPT_KEY];
        saveLoginAttempts();
    }
}

function validatePasswordStrength(password: string): PasswordStrengthResult {
    const errors: string[] = [];
    if (password.length < 6) errors.push('密码长度至少6位');
    if (password.length > 128) errors.push('密码长度不能超过128位');
    let typeCount = 0;
    if (/[a-z]/.test(password)) typeCount++;
    if (/[A-Z]/.test(password)) typeCount++;
    if (/\d/.test(password)) typeCount++;
    if (/[!@#$%^&*(),.?":{}|<>_\-+=[\]\\;'/`~]/.test(password)) typeCount++;
    if (typeCount < 2) errors.push('密码必须包含大写字母、小写字母、数字、特殊符号中的至少两种');
    if (['password', '123456', 'qwerty', 'abc123', '111111', '000000'].includes(password.toLowerCase())) {
        errors.push('密码过于简单，请使用更复杂的密码');
    }
    return { valid: errors.length === 0, errors };
}

function hashPassword(password: string, salt: string | null = null): string {
    const nextSalt = salt || crypto.randomBytes(SALT_LENGTH).toString('hex');
    const hash = crypto.pbkdf2Sync(password, nextSalt, ITERATIONS, KEY_LENGTH, DIGEST).toString('hex');
    return `${nextSalt}:${hash}`;
}

function verifyPassword(password: string, storedPassword: string): boolean {
    if (storedPassword.includes(':')) {
        const [salt, hash] = storedPassword.split(':');
        const nextHash = crypto.pbkdf2Sync(password, salt, ITERATIONS, KEY_LENGTH, DIGEST).toString('hex');
        return hash === nextHash;
    }
    return storedPassword === crypto.createHash('sha256').update(password).digest('hex');
}

function needsRehash(storedPassword: string): boolean {
    return !storedPassword.includes(':');
}

module.exports = {
    loadLoginAttempts,
    checkRateLimit,
    checkAdminLockout,
    recordFailedAttempt,
    clearFailedAttempts,
    validatePasswordStrength,
    hashPassword,
    verifyPassword,
    needsRehash,
};
