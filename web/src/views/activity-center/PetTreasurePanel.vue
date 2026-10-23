<script setup lang="ts">
import type { PetItem, PetTreasure } from '@/stores/pet-diary'
import { storeToRefs } from 'pinia'
import { computed, ref, watch } from 'vue'
import { usePetDiaryStore } from '@/stores/pet-diary'
import PetEscortLandscape from './PetEscortLandscape.vue'

const props = defineProps<{ now: number }>()
const diary = usePetDiaryStore()
const { activity: pet, pending, error, notice, stale, plunderRecords } = storeToRefs(diary)
const dialog = ref<HTMLDialogElement | null>(null)
const opened = ref(false)
const view = ref<'home' | 'queue' | 'logs' | 'charms' | 'choose' | 'rules'>('home')
const busy = computed(() => !!pending.value || stale.value || !pet.value?.active)
const titles = { home: '宝藏护送', queue: '宝藏详情', logs: '护送日志', charms: '锦囊总览', choose: '选择锦囊', rules: '宝藏护送玩法说明' }
const ready = (t: PetTreasure) => t.status === 3 || (t.status === 2 && t.endTime > 0 && t.endTime <= props.now)
const treasures = computed(() => [...(pet.value?.treasures || [])].sort((a, b) => a.createdTime - b.createdTime))
const waiting = computed(() => treasures.value.filter(t => t.status === 1))
const underway = computed(() => treasures.value.filter(t => t.status === 2 && !ready(t)))
const completed = computed(() => treasures.value.filter(ready))
const current = computed(() => underway.value[0])
const charmChoices = computed(() => pet.value?.charms.pool.filter(c => !pet.value?.charms.equipped.some(e => e.id === c.id)) || [])
const refreshLabel = computed(() => {
  const charms = pet.value?.charms
  if (pending.value === 'refreshCharm')
    return '刷新中…'
  if (charms?.canChoose && charms.equipped.length)
    return '替换锦囊'
  if (charms?.freeRefreshRemaining)
    return `免费刷新 ${charms.freeRefreshRemaining}/${charms.freeRefreshLimit}`
  return charms?.paidRefreshRemaining ? `${charms.refreshCost.count} 点券刷新` : '今日刷新已用完'
})
const refreshDisabled = computed(() => busy.value || !(pet.value?.charms.canRefresh || pet.value?.charms.canChoose))
const refreshHint = computed(() => {
  const charms = pet.value?.charms
  if (!charms || charms.canChoose || charms.freeRefreshRemaining || !charms.paidRefreshRemaining)
    return ''
  if (charms.refreshBalance === null)
    return '点券余额暂未读取，请刷新状态'
  return `点券余额 ${charms.refreshBalance} · 今日还可刷新 ${charms.paidRefreshRemaining} 次${!charms.canRefresh ? ' · 点券不足' : ''}`
})
const allCharms = computed(() => {
  const equipped = new Set(pet.value?.charms.equipped.map(charm => charm.id))
  return [...(pet.value?.charms.all || [])].sort((a, b) => Number(equipped.has(b.id)) - Number(equipped.has(a.id)))
})
const rewardItems = computed(() => {
  const grouped = new Map<string, PetItem>()
  for (const { item } of completed.value) {
    const old = grouped.get(item.id)
    grouped.set(item.id, { ...item, count: (BigInt(old?.count || '0') + BigInt(item.count)).toString() })
  }
  return [...grouped.values()]
})
const progress = computed(() => {
  const t = current.value
  return t && t.endTime > t.startTime ? Math.max(0, Math.min(100, (props.now - t.startTime) / (t.endTime - t.startTime) * 100)) : 0
})
function countdown(end: number) {
  const seconds = Math.max(0, Math.ceil((end - props.now) / 1000))
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map(n => String(n).padStart(2, '0')).join(':')
}
function status(t: PetTreasure) {
  const names: Record<number, string> = { 1: '待护送', 2: '护送中', 4: '已领取' }
  return ready(t) ? '待领取' : (names[t.status] || '待刷新')
}
function challengeCount(t: PetTreasure) {
  return `${t.plunderCount} / ${t.maxPlunderCount === 0 ? '不限' : t.maxPlunderCount}`
}
function difference(t: PetTreasure) {
  const change = BigInt(t.item.count) - BigInt(t.originalCount)
  return change > 0n ? `+${change}` : String(change)
}
function contested(t: PetTreasure) {
  const count = BigInt(t.item.count) - BigInt(t.protectedCount)
  return String(count > 0n ? count : 0n)
}
function charmNames(ids: number[] = []) {
  return ids.map(id => pet.value?.charms.all.find(c => c.id === id)?.name || `锦囊 ${id}`).join('、') || '无'
}
function items(values: PetItem[] = []) {
  return values.map(i => `${i.name} ×${i.count}`).join('、') || '无'
}
function date(time: number) {
  return time ? new Date(time).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '尚未开始'
}
function open(section: 'home' | 'charms' = 'home') {
  diary.clearNotice()
  view.value = section
  dialog.value?.showModal()
  opened.value = true
}
function closed() {
  opened.value = false
  diary.clearNotice()
}
function showLogs() {
  view.value = 'logs'
  void diary.readExtra('plunder')
}
async function refreshCharms() {
  if (refreshDisabled.value || !pet.value)
    return
  if (pet.value.charms.canChoose) {
    view.value = 'choose'
    return
  }
  const owner = diary.accountId
  const charms = pet.value.charms
  await diary.operate('refreshCharm', { payment: charms.freeRefreshRemaining > 0 ? 'free' : 'tickets', expectedPaidRefreshCount: charms.paidRefreshCount })
  if (owner === diary.accountId && !error.value)
    view.value = 'choose'
}
async function chooseCharm(charmId: number) {
  const owner = diary.accountId
  await diary.operate('equipCharm', { charmId })
  if (owner === diary.accountId && !error.value)
    view.value = 'home'
}
watch(() => diary.accountId, () => dialog.value?.close())
watch(view, () => dialog.value?.querySelector('.escort-body')?.scrollTo(0, 0), { flush: 'post' })
defineExpose({ open })
</script>

<template>
  <dialog ref="dialog" class="escort-dialog" aria-label="宝藏护送" @close="closed">
    <template v-if="pet">
      <header class="escort-header">
        <button
          v-if="view !== 'home'"
          type="button"
          class="escort-icon-button"
          aria-label="返回护送首页"
          @click="view = 'home'"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m10 5-7 7 7 7M3 12h18" /></svg>
        </button>
        <h2>{{ titles[view] }}</h2>
        <button type="button" class="escort-icon-button" aria-label="关闭宝藏护送" @click="dialog?.close()">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6" /></svg>
        </button>
      </header>

      <div class="escort-body">
        <p v-if="error" class="escort-feedback escort-error" role="alert">
          {{ error }}
        </p>
        <p v-if="notice" class="escort-feedback" role="status">
          {{ notice }}
        </p>

        <nav v-if="view !== 'home' && view !== 'choose'" class="escort-tools" aria-label="护送功能">
          <button type="button" :aria-current="view === 'queue' ? 'page' : undefined" @click="view = 'queue'">
            <span class="i-carbon-time" aria-hidden="true" />待护送 {{ waiting.length }}
          </button>
          <button type="button" :aria-current="view === 'logs' ? 'page' : undefined" @click="showLogs">
            <span class="i-carbon-document" aria-hidden="true" />日志
          </button>
          <button type="button" :aria-current="view === 'charms' ? 'page' : undefined" @click="view = 'charms'">
            <span class="i-carbon-star" aria-hidden="true" />锦囊总览
          </button>
        </nav>

        <template v-if="view === 'home'">
          <nav class="escort-tools" aria-label="护送功能">
            <button type="button" @click="view = 'queue'">
              <span class="i-carbon-time" aria-hidden="true" />待护送 {{ waiting.length }}
            </button>
            <button type="button" @click="showLogs">
              <span class="i-carbon-document" aria-hidden="true" />日志
            </button>
            <button type="button" @click="view = 'charms'">
              <span class="i-carbon-star" aria-hidden="true" />锦囊总览
            </button>
          </nav>

          <div class="escort-journey">
            <div class="escort-stage">
              <section class="escort-scene" aria-label="当前护送">
                <PetEscortLandscape :running="opened && !!current" />
                <div class="escort-time">
                  <h3>{{ current ? '护送中…' : completed.length ? '护送完成' : '空闲中' }}</h3>
                  <div v-if="current" class="escort-progress">
                    <progress :value="progress" max="100" aria-label="护送进度" />
                    <span>剩余时间 {{ countdown(current.endTime) }}</span>
                  </div>
                  <p v-else>
                    {{ completed.length ? '宝藏已安全抵达，记得领取奖励' : '与成年比熊互动，获得待护送宝藏' }}
                  </p>
                </div>
              </section>
              <div v-if="current" class="escort-value">
                <span>宝藏价值</span>
                <strong><img :src="current.item.image" :alt="current.item.name">{{ current.item.count }}</strong>
                <span>已被挑战：{{ challengeCount(current) }}</span>
              </div>
            </div>

            <section class="escort-charm-current">
              <h3>当前锦囊</h3>
              <article v-for="charm in pet.charms.equipped" :key="charm.id" class="escort-charm-row">
                <img :src="charm.image" alt="">
                <div>
                  <strong>{{ charm.name }}</strong>
                  <p>{{ charm.shortDescription }}</p>
                  <small v-if="charm.useLimit >= 0">剩余生效 {{ charm.remaining[0] ?? 0 }} / {{ charm.useLimit }} 次</small>
                </div>
              </article>
              <p v-if="!pet.charms.equipped.length" class="escort-empty">
                今日尚未选择锦囊
              </p>
              <div class="escort-charm-actions">
                <button type="button" class="escort-button" :disabled="refreshDisabled" @click="refreshCharms">
                  {{ refreshLabel }}
                </button>
              </div>
              <p v-if="refreshHint" class="escort-refresh-hint">
                {{ refreshHint }}
              </p>
            </section>
          </div>

          <section class="escort-rewards">
            <h3>待领奖励 <span v-if="completed.length">{{ completed.length }} 份</span></h3>
            <div v-if="rewardItems.length" class="escort-reward-items">
              <span v-for="item in rewardItems" :key="item.id"><img :src="item.image" alt="">{{ item.name }} ×{{ item.count }}</span>
            </div>
            <p v-else class="escort-empty">
              暂无宝箱可领
            </p>
            <button type="button" class="escort-button escort-primary" :disabled="busy || !completed.length" @click="diary.operate('openTreasure')">
              {{ pending === 'openTreasure' ? '领取中…' : '领取护送奖励' }}
            </button>
          </section>

          <button
            v-if="Number(pet.compensationCount) > 0"
            type="button"
            class="escort-button escort-compensation"
            :disabled="busy"
            @click="diary.operate('compensation')"
          >
            领取夺宝安慰礼（{{ pet.compensationCount }}）
          </button>
        </template>

        <section v-else-if="view === 'queue'" class="escort-list">
          <div class="escort-counts">
            <span>待护送 <b>{{ waiting.length }}</b></span><span>护送中 <b>{{ underway.length }}</b></span><span>待领取 <b>{{ completed.length }}</b></span>
          </div>
          <p>待护送宝藏将自动开始护送，无需手动激活。</p>
          <p v-if="!treasures.length" class="escort-empty">
            暂无宝藏，与成年比熊互动后再来看看吧
          </p>
          <article v-for="treasure in treasures" :key="treasure.id" class="escort-treasure-card">
            <header>
              <strong><span class="escort-head-icon i-carbon-gift" aria-hidden="true" />宝藏价值 {{ treasure.item.count }} {{ treasure.item.name }}</strong>
              <span>{{ status(treasure) }}</span>
            </header>
            <dl>
              <div><dt>初始价值</dt><dd>{{ treasure.originalCount }}</dd></div>
              <div><dt>价值变动</dt><dd>{{ difference(treasure) }}</dd></div>
              <div><dt>保底资金</dt><dd>{{ treasure.protectedCount }}</dd></div>
              <div><dt>博弈资金</dt><dd>{{ contested(treasure) }}</dd></div>
              <div><dt>博弈上限</dt><dd>{{ treasure.maxCount }}</dd></div>
              <div><dt>已被挑战</dt><dd>{{ challengeCount(treasure) }}</dd></div>
            </dl>
            <p v-if="treasure.status === 2 && !ready(treasure)">
              剩余时间 {{ countdown(treasure.endTime) }}
            </p>
            <p v-else-if="treasure.status === 1">
              排队等待护送
            </p>
            <small>获得 {{ date(treasure.createdTime) }} · 开始 {{ date(treasure.startTime) }}</small>
            <p v-if="treasure.sourceCharmIds.length">
              关联锦囊：{{ charmNames(treasure.sourceCharmIds) }}
            </p>
          </article>
        </section>

        <section v-else-if="view === 'logs'" class="escort-list">
          <div class="escort-list-heading">
            <p>查看好友挑战、宝藏损益及双方锦囊。</p>
            <button type="button" class="escort-button" :disabled="!!pending" @click="diary.readExtra('plunder')">
              刷新日志
            </button>
          </div>
          <p v-if="plunderRecords === null" class="escort-empty">
            {{ pending === 'plunder' ? '正在读取护送日志…' : '日志暂未载入，请刷新重试' }}
          </p>
          <p v-else-if="!plunderRecords.length" class="escort-empty">
            暂无被挑战记录
          </p>
          <article v-for="(entry, index) in plunderRecords || []" :key="`${entry.time}-${index}`" class="escort-log-card">
            <header>
              <strong>{{ entry.name || '好友' }} <small v-if="entry.level">Lv.{{ entry.level }}</small></strong>
              <time>{{ date(entry.time) }}</time>
            </header>
            <p>{{ entry.fake ? '触发假宝藏' : entry.won ? '对方夺宝成功' : '对方夺宝失败' }}<span v-if="entry.challenge?.id !== '0'"> · {{ entry.challenge?.name }}</span></p>
            <div class="escort-log-change">
              <span>宝藏减少：{{ items(entry.lost) }}</span><span>宝藏增加：{{ items(entry.injected) }}</span>
            </div>
            <details>
              <summary>挑战详情</summary><p>对方锦囊：{{ charmNames(entry.attackerCharms) }}</p><p>我的锦囊：{{ charmNames(entry.defenderCharms) }}</p>
              <small>对应宝藏：{{ entry.treasureId || '未提供' }}</small>
            </details>
          </article>
        </section>

        <section v-else-if="view === 'choose'" class="escort-list escort-choices">
          <template v-if="pet.charms.canChoose">
            <article v-for="charm in pet.charms.equipped" :key="charm.id" class="escort-charm-row escort-charm-choice">
              <span class="escort-current-ribbon">当前</span>
              <img :src="charm.image" alt="">
              <div>
                <strong>{{ charm.name }}</strong>
                <p>{{ charm.description }}</p>
                <small v-if="charm.useLimit >= 0">剩余生效 {{ charm.remaining[0] ?? 0 }} / {{ charm.useLimit }} 次</small>
              </div>
              <button type="button" class="escort-button" :disabled="busy" @click="chooseCharm(charm.id)">
                保留
              </button>
            </article>
            <article v-for="charm in charmChoices" :key="charm.id" class="escort-charm-row escort-charm-choice">
              <img :src="charm.image" alt="">
              <div>
                <strong>{{ charm.name }}</strong>
                <p>{{ charm.description }}</p>
              </div>
              <button type="button" class="escort-button" :disabled="busy" @click="chooseCharm(charm.id)">
                {{ pet.charms.equipped.length ? '替换' : '选择' }}
              </button>
            </article>
            <p class="escort-note">
              可选择一个新锦囊，或保留当前锦囊及其剩余效果。关闭后可继续选择，无需再次刷新。
            </p>
          </template>
          <p v-else class="escort-empty">
            本轮选择已完成，返回护送查看当前锦囊。
          </p>
        </section>

        <section v-else-if="view === 'charms'" class="escort-list">
          <div class="escort-list-heading">
            <h3>全部锦囊 · {{ pet.charms.all.length }} 种</h3>
            <button type="button" class="escort-button" :disabled="refreshDisabled" @click="refreshCharms">
              {{ refreshLabel }}
            </button>
          </div>
          <p v-if="refreshHint" class="escort-note">
            {{ refreshHint }}
          </p>
          <article v-for="charm in allCharms" :key="charm.id" class="escort-charm-row">
            <img :src="charm.image" alt="">
            <div>
              <strong>
                {{ charm.name }}
                <span v-if="pet.charms.equipped.some(c => c.id === charm.id)" class="escort-equipped">当前生效</span>
              </strong>
              <p>{{ charm.description }}</p>
              <small>{{ charm.useLimit < 0 ? '不限生效次数' : `最多生效 ${charm.useLimit} 次` }}</small>
            </div>
          </article>
          <p class="escort-note">
            {{ pet.charms.refreshNote }}
          </p>
        </section>

        <section v-else class="escort-rules">
          <p v-for="(line, index) in pet.treasureRules" :key="index" :class="{ 'escort-rule-heading': /^[一二三四五六七八九十]+、/.test(line) }">
            {{ line }}
          </p>
        </section>

        <footer class="escort-footer">
          <button type="button" class="escort-text" @click="view = view === 'rules' ? 'home' : 'rules'">
            {{ view === 'rules' ? '返回护送' : '玩法说明' }}
          </button>
          <button type="button" class="escort-text" :disabled="!!pending" @click="diary.load(diary.accountId)">
            {{ pending === 'load' ? '刷新中…' : '刷新护送状态' }}
          </button>
        </footer>
      </div>
    </template>
  </dialog>
</template>

<style scoped>
.escort-dialog {
  --pet-accent-deep: #a9762c;
  --pet-accent-soft: #fbf2e3;
  --pet-paper: #fffdf8;
  --pet-paper-2: #fbf5ea;
  --pet-line: #e9dfcb;
  --pet-line-soft: #f2ead9;
  --pet-line-strong: #dfd3ba;
  --pet-ink: #453d33;
  --pet-ink-2: #6f6558;
  --pet-muted: #9a8f80;
  width: min(760px, calc(100vw - 24px));
  max-height: min(88vh, 780px);
  padding: 0;
  overflow: hidden;
  border: 1px solid var(--pet-line);
  border-radius: 16px;
  background: #fff;
  color: var(--pet-ink);
  font-family: 'Microsoft YaHei', 'PingFang SC', sans-serif;
  font-size: 13px;
  line-height: 1.6;
}

.escort-dialog[open] {
  display: flex;
  flex-direction: column;
}

.escort-dialog::backdrop {
  background: rgba(38, 32, 24, 0.45);
  backdrop-filter: blur(2px);
}

.escort-dialog *,
.escort-dialog *::before,
.escort-dialog *::after {
  box-sizing: border-box;
}

.escort-header {
  display: flex;
  flex: none;
  align-items: center;
  gap: 10px;
  height: 56px;
  padding: 0 12px 0 14px;
  border-bottom: 1px solid var(--pet-line-soft);
  background: var(--pet-paper);
}

.escort-header h2 {
  flex: 1;
  min-width: 0;
  margin: 0;
  overflow: hidden;
  font-size: 16px;
  font-weight: 800;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.escort-icon-button {
  display: grid;
  flex: none;
  width: 32px;
  height: 32px;
  place-items: center;
  border: 1px solid var(--pet-line);
  border-radius: 9px;
  background: #fff;
  color: var(--pet-ink-2);
  cursor: pointer;
}

.escort-icon-button svg {
  width: 15px;
  height: 15px;
  fill: none;
  stroke: currentcolor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.escort-body {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 14px;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 16px 18px 20px;
}

.escort-feedback {
  margin: 0;
  padding: 9px 12px;
  border: 1px solid #c4ddcd;
  border-radius: 10px;
  background: var(--ui-primary-soft, #e4f1e7);
  color: #2f6f4b;
  font-size: 12.5px;
  font-weight: 700;
}

.escort-error {
  border-color: #ecc9cb;
  background: var(--ui-danger-soft, #fae9ea);
  color: #a8474e;
}

/* ---------- 功能入口 ---------- */
.escort-tools {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.escort-tools button {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-height: 34px;
  padding: 0 14px;
  border: 1px solid var(--pet-line);
  border-radius: 999px;
  background: #fff;
  color: var(--pet-ink-2);
  font-size: 12.5px;
  font-weight: 800;
  cursor: pointer;
}

.escort-tools button[aria-current='page'] {
  border-color: #c1873a;
  background: var(--pet-accent-soft);
  color: var(--pet-accent-deep);
}

.escort-tools button span {
  width: 15px;
  height: 15px;
  flex: none;
}

/* ---------- 护送主视图 ---------- */
.escort-journey {
  display: grid;
  grid-template-columns: minmax(0, 1.55fr) minmax(0, 1fr);
  gap: 14px;
  align-items: start;
}

.escort-stage {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}

.escort-scene {
  position: relative;
  height: 296px;
  min-height: 200px;
  overflow: hidden;
  border: 1px solid var(--pet-line-soft);
  border-radius: 14px;
  background: linear-gradient(180deg, #fdfaf1 0%, #f3ebda 100%);
}

.escort-time {
  position: relative;
  z-index: 2;
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 12px;
  padding: 10px 12px;
  border: 1px solid rgba(233, 223, 203, 0.9);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.86);
  backdrop-filter: blur(3px);
}

.escort-time h3 {
  margin: 0;
  font-size: 13.5px;
  font-weight: 800;
}

.escort-time p {
  margin: 0;
  font-size: 12px;
  color: var(--pet-ink-2);
}

.escort-progress {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.escort-progress span {
  font-size: 11.5px;
  font-weight: 700;
  color: var(--pet-muted);
  font-variant-numeric: tabular-nums;
}

.escort-progress progress {
  display: block;
  width: 100%;
  height: 8px;
  border: 0;
  border-radius: 999px;
  background: #f0e6d4;
  overflow: hidden;
  appearance: none;
}

.escort-progress progress::-webkit-progress-bar {
  border-radius: 999px;
  background: #f0e6d4;
}

.escort-progress progress::-webkit-progress-value {
  border-radius: 999px;
  background: linear-gradient(90deg, #e9b767, #d59a4f);
}

.escort-progress progress::-moz-progress-bar {
  border-radius: 999px;
  background: linear-gradient(90deg, #e9b767, #d59a4f);
}

.escort-value {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 14px;
  padding: 10px 14px;
  border: 1px solid var(--pet-line);
  border-radius: 12px;
  background: var(--pet-paper);
  font-size: 12.5px;
  color: var(--pet-muted);
}

.escort-value strong {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  color: var(--pet-ink);
  font-variant-numeric: tabular-nums;
}

.escort-value strong img {
  width: 26px;
  height: 26px;
  flex: none;
  border-radius: 50%;
  background: var(--pet-paper-2);
  object-fit: contain;
}

/* ---------- 锦囊 ---------- */
.escort-charm-current {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}

.escort-charm-current h3,
.escort-rewards h3,
.escort-list-heading h3 {
  margin: 0;
  font-size: 14px;
  font-weight: 800;
}

.escort-rewards h3 span {
  margin-left: 4px;
  color: var(--pet-accent-deep);
  font-size: 12px;
}

.escort-charm-row {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid var(--pet-line-soft);
  border-radius: 12px;
  background: var(--pet-paper);
}

.escort-charm-row > img {
  width: 42px;
  height: 42px;
  flex: none;
  border-radius: 10px;
  background: #fff;
  object-fit: contain;
}

.escort-charm-row > div {
  flex: 1 1 auto;
  min-width: 0;
}

.escort-charm-row strong {
  display: block;
  font-size: 13px;
  font-weight: 800;
}

.escort-charm-row p {
  margin: 2px 0 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--pet-ink-2);
}

.escort-charm-row small {
  display: block;
  margin-top: 2px;
  font-size: 11.5px;
  color: var(--pet-muted);
}

.escort-charm-row > .escort-button {
  flex: none;
  align-self: center;
}

.escort-charm-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.escort-refresh-hint,
.escort-note {
  margin: 0;
  font-size: 12px;
  color: var(--pet-muted);
}

.escort-empty {
  margin: 0;
  padding: 14px;
  border: 1px dashed var(--pet-line-strong);
  border-radius: 12px;
  color: var(--pet-muted);
  font-size: 12.5px;
  text-align: center;
}

.escort-equipped,
.escort-current-ribbon {
  display: inline-flex;
  align-items: center;
  height: 20px;
  margin-left: 6px;
  padding: 0 8px;
  border-radius: 999px;
  background: var(--ui-primary-soft, #e4f1e7);
  color: var(--ui-primary, #438d63);
  font-size: 10.5px;
  font-weight: 800;
}

.escort-current-ribbon {
  position: absolute;
  top: 0;
  left: 10px;
  height: 18px;
  margin: 0;
  border-radius: 0 0 8px 8px;
  transform: translateY(0);
}

.escort-charm-choice {
  padding-top: 14px;
}

/* ---------- 奖励 ---------- */
.escort-rewards {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px;
  border: 1px solid var(--pet-line);
  border-radius: 14px;
  background: var(--pet-paper-2);
}

.escort-reward-items {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.escort-reward-items span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 32px;
  padding: 0 12px;
  border: 1px solid var(--pet-line);
  border-radius: 999px;
  background: #fff;
  font-size: 12.5px;
  font-weight: 700;
  color: var(--pet-ink-2);
}

.escort-reward-items img {
  width: 20px;
  height: 20px;
  flex: none;
  object-fit: contain;
}

.escort-rewards .escort-button {
  align-self: flex-start;
}

/* ---------- 按钮 ---------- */
.escort-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 36px;
  padding: 0 16px;
  border: 1px solid var(--pet-line);
  border-radius: 10px;
  background: #fff;
  color: var(--pet-ink);
  font-size: 12.5px;
  font-weight: 800;
  line-height: 1.2;
  cursor: pointer;
  transition:
    filter 0.16s ease,
    transform 0.12s ease;
}

.escort-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.escort-button:not(:disabled):active {
  transform: translateY(1px);
}

.escort-primary {
  border-color: #c1873a;
  background: linear-gradient(180deg, #e2ac60, #cf9243);
  color: #fff;
  box-shadow: 0 6px 16px rgba(197, 139, 63, 0.26);
}

.escort-compensation {
  align-self: flex-start;
  border-color: #eedcbb;
  background: var(--pet-accent-soft);
  color: #8a6520;
}

.escort-text {
  display: inline-flex;
  align-items: center;
  min-height: 32px;
  padding: 0 2px;
  border: 0;
  background: none;
  color: var(--ui-primary, #438d63);
  font-size: 12.5px;
  font-weight: 800;
  cursor: pointer;
}

.escort-text:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* ---------- 列表视图 ---------- */
.escort-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.escort-list > p {
  margin: 0;
  font-size: 12.5px;
  color: var(--pet-ink-2);
}

.escort-list-heading {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.escort-list-heading p {
  flex: 1 1 200px;
  margin: 0;
  font-size: 12.5px;
  color: var(--pet-ink-2);
}

.escort-counts {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.escort-counts span {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 10px 6px;
  border: 1px solid var(--pet-line);
  border-radius: 12px;
  background: var(--pet-paper);
  font-size: 11.5px;
  font-weight: 700;
  color: var(--pet-muted);
}

.escort-counts b {
  font-size: 17px;
  font-weight: 800;
  color: var(--pet-accent-deep);
  font-variant-numeric: tabular-nums;
}

.escort-treasure-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px;
  border: 1px solid var(--pet-line);
  border-radius: 14px;
  background: #fff;
}

.escort-treasure-card > header,
.escort-log-card > header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 12.5px;
  color: var(--pet-muted);
}

.escort-treasure-card > header strong,
.escort-log-card > header strong {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--pet-ink);
  font-size: 13.5px;
  font-weight: 800;
}

.escort-head-icon {
  width: 17px;
  height: 17px;
  flex: none;
  color: var(--pet-accent-deep);
}

.escort-treasure-card dl {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(112px, 1fr));
  gap: 8px;
  margin: 0;
}

.escort-treasure-card dl > div {
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 8px 10px;
  border-radius: 10px;
  background: var(--pet-paper-2);
}

.escort-treasure-card dt {
  font-size: 11px;
  color: var(--pet-muted);
}

.escort-treasure-card dd {
  margin: 0;
  font-size: 13.5px;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}

.escort-treasure-card > p {
  margin: 0;
  font-size: 12.5px;
  color: var(--pet-ink-2);
}

.escort-treasure-card > small {
  font-size: 11.5px;
  color: var(--pet-muted);
}

/* ---------- 日志 ---------- */
.escort-log-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 14px;
  border: 1px solid var(--pet-line);
  border-radius: 12px;
  background: #fff;
}

.escort-log-card > p {
  margin: 0;
  font-size: 12.5px;
  color: var(--pet-ink-2);
}

.escort-log-card time {
  font-size: 11.5px;
  color: var(--pet-muted);
  font-variant-numeric: tabular-nums;
}

.escort-log-change {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 10px;
  border-radius: 10px;
  background: var(--pet-paper-2);
  font-size: 12px;
  color: var(--pet-ink-2);
}

.escort-log-card details {
  font-size: 12px;
  color: var(--pet-ink-2);
}

.escort-log-card summary {
  color: var(--ui-primary, #438d63);
  font-weight: 800;
  cursor: pointer;
}

.escort-log-card details p {
  margin: 6px 0;
}

.escort-log-card details small {
  color: var(--pet-muted);
}

/* ---------- 说明 ---------- */
.escort-rules {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.escort-rules p {
  margin: 0;
  font-size: 12.5px;
  line-height: 1.8;
  color: var(--pet-ink-2);
}

.escort-rule-heading {
  margin-top: 4px !important;
  color: var(--pet-ink) !important;
  font-size: 13.5px !important;
  font-weight: 800;
}

/* ---------- 页脚 ---------- */
.escort-footer {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 10px;
  margin-top: auto;
  padding-top: 12px;
  border-top: 1px dashed var(--pet-line-soft);
}

.escort-dialog button {
  font-family: inherit;
}

@media (max-width: 720px) {
  .escort-dialog {
    width: calc(100vw - 16px);
    max-height: calc(100vh - 24px);
  }

  .escort-body {
    padding: 14px 14px 18px;
  }

  .escort-journey {
    grid-template-columns: minmax(0, 1fr);
  }

  .escort-scene {
    height: 230px;
    min-height: 190px;
  }

  .escort-tools button {
    flex: 1 1 auto;
    justify-content: center;
  }

  .escort-treasure-card dl {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (prefers-reduced-motion: reduce) {
  .escort-dialog * {
    transition-duration: 0.01ms !important;
    animation-duration: 0.01ms !important;
  }
}
</style>
