import config from '../activity-data/milk-tea-20261015.json';

const clean = (text: unknown) => String(text || '').replace(/<[^>]+>/g, '');
const image = (file: string) => `/activity-assets/milk-tea/${file}.png`;

function interactionResult(interact: any) {
    const type = Number(interact?.type);
    const definition = config.MilkTeaInteractionType.find(value => value.interaction_id === type);
    if (!definition || !Number(interact?.interaction_id)) return null;
    let reward = { name: '奶茶券', image: '/game-config/seed_images_named/seed_images/1041.png', count: Number(interact.friend?.bonus_amount || 0) };
    if (type === 4 && interact.success) {
        const gained = interact.items_gained || [];
        const actual = gained.filter((item: any) => Number(item.id) === 1042);
        const detail = config.MilkTeaInteractionConfig.find(value => value.interaction_id === Number(interact.interaction_id));
        const count = gained.length ? actual.reduce((sum: number, item: any) => sum + Number(item.count), 0) : hornCount(detail?.item_reward);
        if (count == null || !Number.isSafeInteger(count) || count <= 0) return null;
        reward = { name: '宣传喇叭', image: '/game-config/seed_images_named/seed_images/1042.png', count };
    } else if (type === 3 && interact.success) {
        const recipe = config.MilkTeaRecipeConfig.find(value => value.recipe_id === Number(interact.friend?.taste_recipe_id));
        reward = { name: recipe?.recipe_name || '高级奶茶', image: recipe ? image(`recipe-${recipe.recipe_id}`) : '', count: Number(interact.friend?.taste_cups || 0) };
    }
    return { name: definition.name, reward };
}

function hornCount(value: unknown): number | null {
    const match = /^1042:([1-9]\d*)$/.exec(String(value || ''));
    if (!match) return null;
    const count = Number(match[1]);
    return Number.isSafeInteger(count) ? count : null;
}

export function normalizeMilkTeaWork(work: any) {
    const shift = work.my_shift;
    // 官方按完整班次时长匹配工资和试饮数量；未知时长不套用四小时档。
    const duration = shift && config.MilkTeaHireDurationConfig.find(value => value.duration_sec === Number(shift.end_at) - Number(shift.begin_at));
    const talent = config.MilkTeaTalentConfig.find(value => value.talent_id === Number(shift?.talent_id || work.talent_id));
    const promote = shift?.interact_previews?.find((value: any) => Number(value.interaction_type) === 1);
    const interactions = config.MilkTeaInteractionType.map(value => {
        const detail = config.MilkTeaInteractionConfig.find(entry => entry.duration_id === duration?.duration_id && entry.interaction_type === value.interaction_id);
        const count = value.interaction_id === 1 ? promote?.promote_cups
            : value.interaction_id === 4 ? hornCount(detail?.item_reward) : detail?.random_drink_count;
        const ready = !value.des.includes('{0}') || (count != null && Number.isFinite(Number(count)));
        return { interaction_id: value.interaction_id, name: value.name, image: image(`interact-${value.interaction_id}`),
            description: clean(value.des).replace('{0}', count == null ? '—' : String(count)), ready };
    });
    return {
        work: { ...work, talentDescription: clean(talent?.des),
            my_shift: shift ? { ...shift, baseWage: duration ? Number(duration.duration_cost.split(':')[1]) : null, interactionResult: interactionResult(shift.interact) } : null,
            slips: (work.slips || []).map((slip: any) => ({ ...slip, interactionResult: interactionResult(slip.interact) })) },
        interactions,
    };
}
