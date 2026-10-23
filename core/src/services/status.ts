export {};
/**
 * 状态栏 - 在终端固定位置显示用户状态
 */

const { getLevelExpTable, getLevelExpProgress } = require('../config/gameConfig');

// 统计钩子（可选，admin 未加载时为空）
let recordGoldExpHook: ((gold: number, exp: number) => void) | null = null;
function setRecordGoldExpHook(hook: (gold: number, exp: number) => void): void { recordGoldExpHook = hook; }

// ============ 状态数据 ============
interface StatusData {
    platform: string;
    name: string;
    level: number;
    gold: number;
    exp: number;
    [key: string]: any;
}

const statusData: StatusData = {
    platform: 'qq',
    name: '',
    level: 0,
    gold: 0,
    exp: 0,
    avatarUrl: '',
};

// ============ 状态栏高度 ============
const STATUS_LINES: number = 2;  // 状态栏占用行数

// ============ ANSI 转义码 ============
const ESC: string = '\x1B';
const SAVE_CURSOR: string = `${ESC}7`;
const RESTORE_CURSOR: string = `${ESC}8`;
const MOVE_TO = (row: number, col: number): string => `${ESC}[${row};${col}H`;
const CLEAR_LINE: string = `${ESC}[2K`;
const SCROLL_REGION = (top: number, bottom: number): string => `${ESC}[${top};${bottom}r`;
const RESET_SCROLL: string = `${ESC}[r`;
const BOLD: string = `${ESC}[1m`;
const RESET: string = `${ESC}[0m`;
const DIM: string = `${ESC}[2m`;
const CYAN: string = `${ESC}[36m`;
const YELLOW: string = `${ESC}[33m`;
const GREEN: string = `${ESC}[32m`;
const MAGENTA: string = `${ESC}[35m`;

// ============ 状态栏是否启用 ============
let statusEnabled: boolean = false;
let termRows: number = 24;

/**
 * 初始化状态栏
 */
function initStatusBar(): boolean {
    // 检测终端是否支持
    if (!process.stdout.isTTY) {
        return false;
    }

    termRows = process.stdout.rows || 24;
    statusEnabled = true;

    // 设置滚动区域，留出顶部状态栏空间
    process.stdout.write(SCROLL_REGION(STATUS_LINES + 1, termRows));
    // 移动光标到滚动区域
    process.stdout.write(MOVE_TO(STATUS_LINES + 1, 1));

    // 监听终端大小变化
    process.stdout.on('resize', () => {
        termRows = process.stdout.rows || 24;
        process.stdout.write(SCROLL_REGION(STATUS_LINES + 1, termRows));
        renderStatusBar();
    });

    // 初始渲染
    renderStatusBar();
    return true;
}

/**
 * 清理状态栏（退出时调用）
 */
function cleanupStatusBar(): void {
    if (!statusEnabled) return;
    statusEnabled = false;
    // 重置滚动区域
    process.stdout.write(RESET_SCROLL);
    // 清除状态栏
    process.stdout.write(MOVE_TO(1, 1) + CLEAR_LINE);
    process.stdout.write(MOVE_TO(2, 1) + CLEAR_LINE);
}

/**
 * 渲染状态栏
 */
function renderStatusBar(): void {
    if (!statusEnabled) return;

    const { platform, name, level, gold, exp } = statusData;

    // 构建状态行
    const platformStr: string = platform === 'wx' ? `${MAGENTA}微信${RESET}` : `${CYAN}QQ${RESET}`;
    const nameStr: string = name ? `${BOLD}${name}${RESET}` : '未登录';
    const levelStr: string = `${GREEN}Lv${level}${RESET}`;
    const goldStr: string = `${YELLOW}金币:${gold}${RESET}`;

    // 显示经验值
    let expStr: string = '';
    if (level > 0 && exp >= 0) {
        const levelExpTable: any = getLevelExpTable();
        if (levelExpTable) {
            // 有配置表时显示当前等级进度
            const progress: any = getLevelExpProgress(level, exp);
            expStr = `${DIM}经验:${progress.current}/${progress.needed}${RESET}`;
        } else {
            // 没有配置表时只显示累计经验
            expStr = `${DIM}经验:${exp}${RESET}`;
        }
    }

    // 第一行：平台 | 昵称 | 等级 | 金币 | 经验
    const line1: string = `${platformStr} | ${nameStr} | ${levelStr} | ${goldStr}${expStr ? ` | ${  expStr}` : ''}`;

    // 第二行：分隔线
    const width: number = process.stdout.columns || 80;
    const line2: string = `${DIM}${'─'.repeat(Math.min(width, 80))}${RESET}`;

    // 保存光标位置
    process.stdout.write(SAVE_CURSOR);
    // 移动到第一行并清除
    process.stdout.write(MOVE_TO(1, 1) + CLEAR_LINE + line1);
    // 移动到第二行并清除
    process.stdout.write(MOVE_TO(2, 1) + CLEAR_LINE + line2);
    // 恢复光标位置
    process.stdout.write(RESTORE_CURSOR);
}

/**
 * 更新状态数据并刷新显示
 */
function updateStatus(data: Partial<StatusData>): void {
    let changed: boolean = false;
    for (const key of Object.keys(data)) {
        if (statusData[key] !== (data as any)[key]) {
            (statusData as any)[key] = (data as any)[key];
            changed = true;
        }
    }
    if (changed) {
        if (statusEnabled) renderStatusBar();
        if (recordGoldExpHook && (data.gold !== undefined || data.exp !== undefined)) {
            try { recordGoldExpHook(statusData.gold, statusData.exp); } catch {}
        }
    }
}

/**
 * 设置平台
 */
function setStatusPlatform(platform: string): void {
    updateStatus({ platform });
}

/**
 * 从登录数据更新状态
 */
function updateStatusFromLogin(basic: any): void {
    updateStatus({
        name: basic.name || statusData.name,
        level: (basic.level ?? statusData.level),
        gold: (basic.gold ?? statusData.gold),
        exp: (basic.exp ?? statusData.exp),
        avatarUrl: String(basic.avatarUrl || basic.avatar_url || statusData.avatarUrl || '').trim(),
    });
}

/**
 * 更新金币
 */
function updateStatusGold(gold: number): void {
    updateStatus({ gold });
}

/**
 * 更新等级和经验
 */
function updateStatusLevel(level: number, exp?: number): void {
    const data: any = { level };
    if (exp !== undefined) data.exp = exp;
    updateStatus(data);
}

module.exports = {
    initStatusBar,
    setRecordGoldExpHook,
    cleanupStatusBar,
    updateStatus,
    setStatusPlatform,
    updateStatusFromLogin,
    updateStatusGold,
    updateStatusLevel,
    statusData,
};
