/**
 * 背包种子的游戏内展示排序：
 * plantingPriority 降序 → 稀有度(>=2)优先 → 经验降序 → seedId 升序。
 * 与旧版 bag-seed-order.js 保持一致，用于新增种子进入优先级列表时的默认次序。
 */
function compareBagSeedGameOrder(left: any, right: any): number {
    const plantingPriorityDiff = Number(right && right.plantingPriority || 0)
        - Number(left && left.plantingPriority || 0);
    if (plantingPriorityDiff !== 0) return plantingPriorityDiff;

    const rareDiff = Number(Number(right && right.rarity) >= 2)
        - Number(Number(left && left.rarity) >= 2);
    if (rareDiff !== 0) return rareDiff;

    const expDiff = Number(right && right.plantExp || 0) - Number(left && left.plantExp || 0);
    if (expDiff !== 0) return expDiff;

    return Number(left && (left.seedId || left.id) || 0)
        - Number(right && (right.seedId || right.id) || 0);
}

module.exports = { compareBagSeedGameOrder };
