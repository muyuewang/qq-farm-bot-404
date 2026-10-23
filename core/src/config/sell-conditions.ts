export interface ActivityWindow {
    id: string;
    name?: string;
    beginTime: number;
    endTime: number;
}

export interface SellConditionContext {
    nowSec: number;
    expireTime?: number;
    activityWindows?: ReadonlyMap<string, ActivityWindow>;
    activityWindowsLoaded?: boolean;
}

interface ParsedCondition {
    type: string;
    value: string;
}

function parseSellConditions(condition: string | null | undefined): ParsedCondition[] {
    return String(condition || '')
        .split(';')
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) => {
            const separator = part.indexOf(':');
            if (separator < 0) return { type: part, value: '' };
            return {
                type: part.slice(0, separator).trim(),
                value: part.slice(separator + 1).trim(),
            };
        });
}

function isActivityEnded(window: ActivityWindow | undefined, nowSec: number): boolean {
    return !window || window.endTime <= nowSec;
}

function isActivityActive(window: ActivityWindow | undefined, nowSec: number): boolean {
    return !!window && window.beginTime <= nowSec && nowSec <= window.endTime;
}

function isSingleSellConditionSatisfied(condition: ParsedCondition, context: SellConditionContext): boolean {
    const nowSec = Number(context.nowSec) || 0;
    if (condition.type === '道具过期后') {
        const expireTime = Number(context.expireTime) || 0;
        return expireTime > 0 && nowSec >= expireTime;
    }

    if (!context.activityWindowsLoaded || !condition.value) return false;
    const window = context.activityWindows?.get(condition.value);
    if (condition.type === '活动结束后') return isActivityEnded(window, nowSec);
    if (condition.type === '活动结束前') return !isActivityEnded(window, nowSec);
    if (condition.type === '活动区间外') return !isActivityActive(window, nowSec);
    return false;
}

function isSellConditionSatisfied(
    condition: string | null | undefined,
    context: SellConditionContext
): boolean {
    const conditions = parseSellConditions(condition);
    return conditions.length > 0
        && conditions.every((entry) => isSingleSellConditionSatisfied(entry, context));
}

module.exports = {
    parseSellConditions,
    isSellConditionSatisfied,
};
