import animals from '../gameConfig/ranch/MCAnimalConfig.json';
import mutations from '../gameConfig/ranch/MCAnimalMutation.json';

/**
 * 牧场动物与幼崽的统一配置表。
 *
 * 原来 model.ts 与 ranch-automation.ts 各自构建一遍，容易在两侧漂移；
 * 这里集中一份，供牧场服务、自动化校验与配置校验共同引用。
 * cubMap 同时收录普通幼崽与巨大幼崽，巨大幼崽通过 giantCubItemId 标记。
 */
export const animalMap = new Map<number, any>(animals.map(row => [row.id, row]));
export const cubMap = new Map<number, any>([
    ...animals.map(row => [row.cub_item_id, { ...row, giantCubItemId: 0 }] as [number, any]),
    ...mutations.map(row => [row.giant_cub_item_id, { ...animalMap.get(row.animal_id), giantCubItemId: row.giant_cub_item_id }] as [number, any]),
]);