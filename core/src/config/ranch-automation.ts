import { animalMap, cubMap } from './ranch-animals';

/**
 * 罐头使用时机。四种取值分别表示：
 * - any：只要动物能喂就喂
 * - longest：只喂当前阶段时长最长的动物，桶内时长能换到最多进度
 * - to_production：只喂成长期（stage 2），把动物推进到生产期
 * - near_harvest：只喂成熟期且距收获不足 10 分钟的动物，避免罐头时长被收获重置浪费
 */
export const RANCH_FEED_STAGES = ['any', 'longest', 'to_production', 'near_harvest'] as const;
export type RanchFeedStage = typeof RANCH_FEED_STAGES[number];
export const RANCH_NEAR_HARVEST_MS = 10 * 60_000;

/**
 * 默认只开「不改账号状态」的领取类动作（任务/分享/每日福利）；
 * 自动购买、出售、好友互动等会真实改动账号或好友状态的动作一律默认关闭。
 * 上游把这里全部改成 true，但本项目坚持保守默认：详见
 * core/tests/ranch-automation.test.js 的「默认只开任务与分享」用例。
 */
export const RANCH_AUTOMATION_DEFAULTS = {
    ranch_harvest: false,
    ranch_produce: false,
    ranch_buy: false,
    // 21 级一级棚的激活是免费操作，但仍会改动账号状态，按保守默认关闭。
    ranch_activate_shed: false,
    ranch_upgrade: false,
    ranch_sell: false,
    // 仓鼠集市兑换有机化肥：便便优先 4 小时、其次 1 小时；松果优先 8 小时、4 小时、1 小时。
    // 两种货币拆成独立开关（上游 #162），会消耗背包物品，默认全部关闭。
    // ranch_market_organic 是旧总开关，只用于兼容旧配置，运行时不再直接读它。
    ranch_market_organic: false,
    ranch_market_organic_poop: false,
    ranch_market_organic_pinecone: false,
    ranch_grass: false,
    ranch_grass_buy: false,
    ranch_grass_threshold_percent: 20,
    ranch_fill_cans: false,
    ranch_feed_normal: false,
    // 普通罐头默认只在最长生长阶段使用，桶内时长等价换取更多进度。
    ranch_feed_normal_stage: 'longest' as RanchFeedStage,
    ranch_feed_organic: false,
    // 有机罐头默认留到快收获时再用：成熟期离收获不足 10 分钟才投，长度不会被收获重置。
    ranch_feed_organic_stage: 'near_harvest' as RanchFeedStage,
    ranch_clean: false,
    ranch_stroke: false,
    ranch_friend_steal: false,
    // 帮忙生产会改动好友动物的生产状态，按保守默认关闭，与其余好友互动一致。
    ranch_friend_produce: false,
    ranch_friend_clean: false,
    ranch_friend_mosquito: false,
    ranch_task: true,
    // 成熟动物腾栏后顺带核对图鉴奖励；只领已达标奖励，不改账号其他状态，默认开启。
    ranch_illustrated: true,
    ranch_share: true,
    ranch_daily_benefit: true,
    ranch_check_minutes: 5,
    ranch_strategy: 'level' as 'level' | 'preferred' | 'bag_priority',
    ranch_bag_fallback: 'level' as 'level' | 'preferred',
    ranch_coop_animal: 0,
    ranch_shed_animal: 0,
    // 背包幼崽的放养优先顺序：空数组表示不干预，按等级从高到低放养。
    ranch_coop_cub_priority: [] as number[],
    ranch_shed_cub_priority: [] as number[],
};

export type RanchAutomationConfig = typeof RANCH_AUTOMATION_DEFAULTS;
export const RANCH_SWITCH_KEYS = Object.keys(RANCH_AUTOMATION_DEFAULTS).filter(key => typeof RANCH_AUTOMATION_DEFAULTS[key as keyof RanchAutomationConfig] === 'boolean');
export const RANCH_ANIMAL_OPTIONS = [...animalMap.values()].filter(animal => animal.enable_flag).map(animal => ({ value: animal.id, label: animal.name, kind: animal.husbandry_type }));

export function normalizeRanchSetting(key: string, value: unknown): boolean | number | string | number[] {
    if (key === 'ranch_feed_normal_stage' || key === 'ranch_feed_organic_stage') {
        if (typeof value !== 'string' || !RANCH_FEED_STAGES.includes(value as RanchFeedStage)) {
            throw Object.assign(new Error('请选择有效的罐头使用时机'), { code: 'INVALID_CONFIG' });
        }
        return value;
    }
    if (key === 'ranch_strategy' || key === 'ranch_bag_fallback') {
        const allowed = key === 'ranch_strategy' ? ['level', 'preferred', 'bag_priority'] : ['level', 'preferred'];
        if (!allowed.includes(String(value))) throw Object.assign(new Error('请选择有效的养殖策略'), { code: 'INVALID_CONFIG' });
        return String(value);
    }
    if (key === 'ranch_coop_animal' || key === 'ranch_shed_animal') {
        const id = Number(value);
        if (id !== 0 && !RANCH_ANIMAL_OPTIONS.some(animal => animal.value === id && animal.kind === (key === 'ranch_coop_animal' ? '窝' : '棚'))) {
            throw Object.assign(new Error('所选动物不适用于当前窝或棚'), { code: 'INVALID_CONFIG' });
        }
        return id;
    }
    if (key === 'ranch_coop_cub_priority' || key === 'ranch_shed_cub_priority') {
        const housing = key === 'ranch_coop_cub_priority' ? '窝' : '棚';
        if (!Array.isArray(value) || value.some(id => cubMap.get(id)?.husbandry_type !== housing)) {
            throw Object.assign(new Error(`${housing}的背包顺序只能包含适用于${housing}的幼崽`), { code: 'INVALID_CONFIG' });
        }
        return [...new Set<number>(value)];
    }
    if (key === 'ranch_check_minutes') {
        const number = Number(value);
        if (!Number.isInteger(number) || number < 1 || number > 60) {
            throw Object.assign(new Error('牧场巡查间隔必须是 1–60 的整数分钟'), { code: 'INVALID_CONFIG' });
        }
        return number;
    }
    if (key === 'ranch_grass_threshold_percent') {
        const number = Number(value);
        if (!Number.isInteger(number) || number < 1 || number > 100) {
            throw Object.assign(new Error('牧草补充阈值必须是 1–100 的整数百分比'), { code: 'INVALID_CONFIG' });
        }
        return number;
    }
    if (typeof value !== 'boolean') throw Object.assign(new Error('牧场开关必须为布尔值'), { code: 'INVALID_CONFIG' });
    return value;
}

export const RANCH_MARKET_SWITCH_BY_CURRENCY = {
    7002: 'ranch_market_organic_poop',
    1008: 'ranch_market_organic_pinecone',
} as const;
export const RANCH_MARKET_SWITCH_KEYS = Object.values(RANCH_MARKET_SWITCH_BY_CURRENCY);

/**
 * 旧配置只有总开关 ranch_market_organic，新配置拆成便便/松果两个独立开关。
 * 迁移规则：总开关只填充缺失的新字段，已明确设置的独立开关优先，不覆盖用户选择。
 */
export function migrateRanchMarketAutomation(input: Record<string, any>): Record<string, any> {
    const result = { ...input };
    if (typeof result.ranch_market_organic === 'boolean') {
        for (const key of RANCH_MARKET_SWITCH_KEYS) {
            if (result[key] === undefined) result[key] = result.ranch_market_organic;
        }
    }
    return result;
}

/** 任一货币兑换开关开启即视为集市兑换启用；两项都关时不触发到访排队与货币到账唤醒。 */
export function isRanchMarketEnabled(input: Partial<RanchAutomationConfig>): boolean {
    return RANCH_MARKET_SWITCH_KEYS.some(key => (input[key] ?? input.ranch_market_organic) === true);
}
