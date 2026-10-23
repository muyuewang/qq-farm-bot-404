export {};
/**
 * 安全模块 - 密码加密与验证
 * 使用bcrypt替代SHA256，增强密码安全性
 */

const crypto = require('node:crypto');
const { createModuleLogger } = require('./logger');

const logger: any = createModuleLogger('security');

interface SecurityConfig {
    saltRounds: number;
    minPasswordLength: number;
    maxPasswordLength: number;
    enablePasswordStrengthCheck: boolean;
    maxLoginAttempts: number;
    lockoutDuration: number;
}

const SECURITY_CONFIG: SecurityConfig = {
    saltRounds: 12,
    minPasswordLength: 4,
    maxPasswordLength: 64,
    enablePasswordStrengthCheck: true,
    maxLoginAttempts: 5,
    lockoutDuration: 300000,
};

function getClientIp(req: any): string {
    const cfIp: string | undefined = req.headers['cf-connecting-ip'];
    if (cfIp) return cfIp.trim();

    const xRealIp: string | undefined = req.headers['x-real-ip'];
    if (xRealIp) return xRealIp.trim();

    const xForwardedFor: string | undefined = req.headers['x-forwarded-for'];
    if (xForwardedFor) {
        const ips: string[] = xForwardedFor.split(',').map((ip: string) => ip.trim()).filter(Boolean);
        if (ips.length > 0) return ips[0];
    }

    if (req.ip && req.ip !== '::1' && req.ip !== '::ffff:127.0.0.1') {
        return req.ip;
    }

    const remoteAddr: string | undefined = req.connection?.remoteAddress || req.socket?.remoteAddress;
    if (remoteAddr) {
        if (remoteAddr.startsWith('::ffff:')) {
            return remoteAddr.substring(7);
        }
        return remoteAddr;
    }

    return 'unknown';
}

interface LoginAttempt {
    count: number;
    firstAttempt: number;
    lastAttempt?: number;
    lockedUntil: number;
}

const loginAttempts: Map<string, LoginAttempt> = new Map();

const useBcrypt: boolean = true;

function generateSalt(): string {
    return crypto.randomBytes(32).toString('hex');
}

async function hashPassword(password: string): Promise<string> {
    if (!useBcrypt) {
        return hashPasswordSHA256(password);
    }

    const salt: string = generateSalt();
    const iterations: number = 100000;
    const keyLength: number = 64;
    const digest: string = 'sha512';

    return new Promise((resolve: (value: string) => void, reject: (reason?: any) => void) => {
        crypto.pbkdf2(password, salt, iterations, keyLength, digest, (err: Error | null, derivedKey: Buffer) => {
            if (err) reject(err);
            else {
                resolve(`$pbkdf2$${salt}$${iterations}$${derivedKey.toString('hex')}`);
            }
        });
    });
}

async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
    if (!useBcrypt) {
        return verifyPasswordSHA256(password, storedHash);
    }

    if (!storedHash || !password) {
        return false;
    }

    try {
        if (storedHash.startsWith('$pbkdf2$')) {
            const parts: string[] = storedHash.split('$');
            if (parts.length !== 5) return false;

            const salt: string = parts[2];
            const iterations: number = Number.parseInt(parts[3], 10);
            const hash: string = parts[4];
            const keyLength: number = 64;
            const digest: string = 'sha512';

            return new Promise((resolve: (value: boolean) => void) => {
                crypto.pbkdf2(password, salt, iterations, keyLength, digest, (err: Error | null, derivedKey: Buffer) => {
                    if (err) {
                        logger.error('PBKDF2验证失败', { error: err.message });
                        resolve(false);
                    } else {
                        resolve(derivedKey.toString('hex') === hash);
                    }
                });
            });
        }

        if (storedHash.length === 64) {
            return verifyPasswordSHA256(password, storedHash);
        }

        return false;
    } catch (error: any) {
        logger.error('密码验证异常', { error: error.message });
        return false;
    }
}

function hashPasswordSHA256(password: string): string {
    return crypto.createHash('sha256')
        .update(String(password || ''))
        .digest('hex');
}

function verifyPasswordSHA256(password: string, storedHash: string): boolean {
    const hash: string = hashPasswordSHA256(password);
    return crypto.timingSafeEqual(
        Buffer.from(hash),
        Buffer.from(storedHash)
    );
}

interface PasswordStrengthResult {
    score: number;
    valid: boolean;
    feedback: string[];
}

function checkPasswordStrength(password: string): PasswordStrengthResult {
    if (!SECURITY_CONFIG.enablePasswordStrengthCheck) {
        return { score: 0, valid: true, feedback: [] };
    }

    const feedback: string[] = [];
    let score: number = 0;

    if (!password) {
        return { score: 0, valid: false, feedback: ['密码不能为空'] };
    }

    if (password.length < SECURITY_CONFIG.minPasswordLength) {
        feedback.push(`密码长度至少${SECURITY_CONFIG.minPasswordLength}位`);
        return { score: 0, valid: false, feedback };
    }

    if (password.length >= 8) score += 1;
    if (password.length >= 12) score += 1;

    if (/[a-z]/.test(password)) score += 1;
    if (/[A-Z]/.test(password)) score += 1;
    if (/\d/.test(password)) score += 1;
    if (/[^a-z0-9]/i.test(password)) score += 1;

    const commonPasswords: string[] = [
        'password', '123456', 'qwerty', 'admin', 'letmein',
        'welcome', 'monkey', 'dragon', 'master', 'login'
    ];
    if (commonPasswords.includes(password.toLowerCase())) {
        score = 0;
        feedback.push('密码过于简单，请使用更复杂的密码');
    }

    if (score < 3) {
        feedback.push('建议使用字母、数字和特殊符号的组合');
    }

    return {
        score,
        valid: true,
        feedback: feedback.length > 0 ? feedback : ['密码强度良好']
    };
}

function recordLoginAttempts(identifier: string): { attemptsLeft: number } {
    const key: string = String(identifier || '').toLowerCase();
    const now: number = Date.now();

    const attempts: LoginAttempt = loginAttempts.get(key) || { count: 0, firstAttempt: now, lockedUntil: 0 };

    if (attempts.lockedUntil > now) {
        const remaining: number = Math.ceil((attempts.lockedUntil - now) / 1000);
        throw new Error(`账号已锁定，请${remaining}秒后重试`);
    }

    attempts.count += 1;
    attempts.lastAttempt = now;

    if (attempts.count >= SECURITY_CONFIG.maxLoginAttempts) {
        attempts.lockedUntil = now + SECURITY_CONFIG.lockoutDuration;
        logger.warn('登录尝试过多，账号已锁定', { identifier: key });
        throw new Error(`登录尝试过多，账号已锁定${SECURITY_CONFIG.lockoutDuration / 60000}分钟`);
    }

    loginAttempts.set(key, attempts);
    return {
        attemptsLeft: SECURITY_CONFIG.maxLoginAttempts - attempts.count
    };
}

function clearLoginAttempts(identifier: string): void {
    const key: string = String(identifier || '').toLowerCase();
    loginAttempts.delete(key);
}

function generateToken(length: number = 32): string {
    return crypto.randomBytes(length).toString('hex');
}

interface SessionToken {
    token: string;
    expiresAt: number;
    createdAt: number;
}

function generateSessionToken(): SessionToken {
    return {
        token: generateToken(32),
        expiresAt: Date.now() + 24 * 60 * 60 * 1000,
        createdAt: Date.now(),
    };
}

function verifySessionToken(token: string, expiresAt: number): boolean {
    if (!token || !expiresAt) return false;
    if (Date.now() > expiresAt) return false;
    return true;
}

function passwordHashMiddleware(req: any, res: any, next: any): any {
    const { password } = req.body || {};

    if (password && req.path.includes('/api/')) {
        const strength: PasswordStrengthResult = checkPasswordStrength(password);
        if (!strength.valid) {
            return res.status(400).json({
                ok: false,
                error: strength.feedback[0],
                feedback: strength.feedback
            });
        }
    }

    next();
}

interface RateLimitRecord {
    count: number;
    resetAt: number;
}

const rateLimitStore: Map<string, RateLimitRecord> = new Map();

function rateLimitMiddleware(options: any = {}): (req: any, res: any, next: any) => void {
    const {
        windowMs = 60000,
        maxRequests = 100,
        keyGenerator = (req: any) => getClientIp(req),
    } = options;

    return (req: any, res: any, next: any): void => {
        const key: string = keyGenerator(req);
        const now: number = Date.now();

        const record: RateLimitRecord = rateLimitStore.get(key) || { count: 0, resetAt: now + windowMs };

        if (now > record.resetAt) {
            record.count = 0;
            record.resetAt = now + windowMs;
        }

        record.count += 1;
        rateLimitStore.set(key, record);

        res.set('X-RateLimit-Limit', maxRequests);
        res.set('X-RateLimit-Remaining', Math.max(0, maxRequests - record.count));
        res.set('X-RateLimit-Reset', new Date(record.resetAt).toISOString());

        if (record.count > maxRequests) {
            return res.status(429).json({
                ok: false,
                error: '请求过于频繁，请稍后重试',
                retryAfter: Math.ceil((record.resetAt - now) / 1000)
            });
        }

        next();
    };
}

setInterval(() => {
    const now: number = Date.now();
    for (const [key, record] of rateLimitStore.entries()) {
        if (now > record.resetAt) {
            rateLimitStore.delete(key);
        }
    }
}, 60000);

module.exports = {
    hashPassword,
    verifyPassword,
    checkPasswordStrength,
    recordLoginAttempts,
    clearLoginAttempts,
    generateToken,
    generateSessionToken,
    verifySessionToken,
    passwordHashMiddleware,
    rateLimitMiddleware,
    SECURITY_CONFIG,
    getClientIp,
};
