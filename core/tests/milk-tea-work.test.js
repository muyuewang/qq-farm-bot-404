const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeMilkTeaWork } = require('../dist/services/milk-tea-work');

function work(duration = 86400) {
    return { talent_id: 9001, my_shift: { shift_id: '7', talent_id: 9001, begin_at: '100000', end_at: String(100000 + duration),
        wage_total: '324', interact_count: 1, interact_limit: 1, interact_previews: [{ interaction_type: 1, promote_cups: '40' }],
        interact: { type: 1, interaction_id: '90011', success: true, friend: { bonus_amount: '54' } } } };
}

test('current shift separates official base wage from the actual bonus and resolves server promotion preview', () => {
    const result = normalizeMilkTeaWork(work());
    assert.equal(result.work.my_shift.baseWage, 270);
    assert.equal(result.work.my_shift.wage_total, '324');
    assert.equal(result.work.my_shift.interactionResult.reward.count, 54);
    assert.equal(result.work.talentDescription, '金币收入+10%');
    assert.equal(result.interactions[0].description, '帮助老板立即卖出40杯奶茶，你将获得本班工资20%的奖金');
    assert.equal(result.interactions[3].description, '有40%概率获得宣传喇叭x6，有60%概率工资减半');
    assert.equal(result.interactions[4].description, '有60%概率工资翻倍，有40%概率工资减半');
    assert.ok(result.interactions.every(value => !/[{}<>]/.test(value.description)));
});

test('tasting rewards follow the configured 4/12/24 hour shifts, without guessing unknown durations or previews', () => {
    for (const [hours, cups, wage] of [[4, 4, 40], [12, 12, 130], [24, 24, 270]]) {
        const result = normalizeMilkTeaWork(work(hours * 3600));
        assert.ok(result.interactions[2].description.includes(`${cups}杯`));
        assert.equal(result.work.my_shift.baseWage, wage);
    }
    const unknown = work(12345);
    delete unknown.my_shift.interact_previews;
    const result = normalizeMilkTeaWork(unknown);
    assert.equal(result.work.my_shift.baseWage, null);
    assert.equal(result.interactions[0].ready, false);
    assert.equal(result.interactions[2].ready, false);
    assert.equal(result.interactions[1].ready, true);
    assert.equal(normalizeMilkTeaWork({}).work.my_shift, null);
});

test('actual interaction outcomes retain deductions and distinguish horn/drink rewards from wages', () => {
    const value = work();
    for (const [type, success, friend, expected] of [
        [5, false, { bonus_amount: '-135' }, ['奶茶券', -135]],
        [5, true, { bonus_amount: '270' }, ['奶茶券', 270]],
        [4, true, {}, ['宣传喇叭', 6]],
        [3, true, { taste_recipe_id: '2', taste_cups: '24' }, ['甜莓奶茶', 24]],
    ]) {
        value.my_shift.interact = { type, success, friend, interaction_id: '90014' };
        value.slips = [{ shift_id: '6', interact: value.my_shift.interact }];
        const result = normalizeMilkTeaWork(value);
        for (const entry of [result.work.my_shift, result.work.slips[0]]) {
            assert.deepEqual([entry.interactionResult.reward.name, entry.interactionResult.reward.count], expected);
        }
    }
});
