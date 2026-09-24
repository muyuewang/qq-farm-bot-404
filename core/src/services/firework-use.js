const FIREWORK_ITEM_ID = 6001;

// Each account runs in its own worker. Keep the whole placement/ignition sequence locked.
function createFireworkUse({ getFarm, place, ignite, now }) {
  let running = false;
  return async function useFirework(count, uid) {
    if (Number(count) !== 1) throw new Error('烟花：每次只能燃放一枚');
    if (running) throw new Error('烟花：正在处理，请勿重复点击');
    running = true;
    try {
      const farm = await getFarm();
      const current = (farm.farm_social_events || []).find(event => Number(event.item_id) === FIREWORK_ITEM_ID);
      const phase = Number(current?.phase || 0);
      if (current && phase !== 0 && (!Number(current.state_until) || Number(current.state_until) > now())) {
        throw new Error('烟花：燃放中，请稍后再试');
      }
      // A previous placement may have succeeded before an ignition/network failure.
      // Read server state so retrying (including after a worker restart) consumes no extra item.
      const pending = current && phase === 0;
      const reply = pending ? { used_items: [], items: [] } : await place(uid);
      try {
        await ignite();
      } catch {
        throw new Error('烟花：已放置，但点燃未确认，请重试以继续放烟花');
      }
      return { ...reply, firework: true, resumed: Boolean(pending) };
    } catch (error) {
      if (String(error.message).includes('1001096') || String(error.message).includes('烟花燃放中')) {
        throw new Error('烟花：燃放中，请稍后再试');
      }
      throw error;
    } finally {
      running = false;
    }
  };
}

module.exports = { FIREWORK_ITEM_ID, createFireworkUse };
