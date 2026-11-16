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
const art = (name: string) => `/activity/pet-diary/${name}.png${name === 'escort-dog-walk' ? '?v=20260910-full-frame' : ''}`
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
  <dialog ref="dialog" class="pet-escort" aria-label="宝藏护送" @close="closed">
    <template v-if="pet">
      <header class="escort-header">
        <button v-if="view !== 'home'" class="escort-round escort-back" aria-label="返回护送" @click="view = 'home'">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m10 5-7 7 7 7M3 12h18" /></svg>
        </button>
        <img v-if="view === 'home'" :src="art('img_s3Treasure_bg')" alt="宝藏护送" class="escort-title">
        <h2 v-else>
          {{ titles[view] }}
        </h2>
        <button class="escort-round escort-close" aria-label="关闭宝藏护送" @click="dialog?.close()">
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
          <button :aria-current="view === 'queue' ? 'page' : undefined" @click="view = 'queue'">
            <img :src="art('img_s3Treasure_wait')" alt="">待护送 {{ waiting.length }}
          </button>
          <button :aria-current="view === 'logs' ? 'page' : undefined" @click="showLogs">
            <img :src="art('img_s3Treasure_btn1')" alt="">日志
          </button>
          <button :aria-current="view === 'charms' ? 'page' : undefined" @click="view = 'charms'">
            <img :src="art('img_s3Treasure_detail')" alt="">锦囊总览
          </button>
        </nav>
        <template v-if="view === 'home'">
          <div class="escort-journey">
            <section class="escort-scene" :class="{ 'escort-scene--moving': !!current }" aria-label="当前护送">
              <nav class="escort-tools escort-tools--home" aria-label="护送功能">
                <button @click="view = 'queue'">
                  <img :src="art('img_s3Treasure_wait')" alt="">待护送 {{ waiting.length }}
                </button>
                <button @click="showLogs">
                  <img :src="art('img_s3Treasure_btn1')" alt="">日志
                </button>
                <button @click="view = 'charms'">
                  <img :src="art('img_s3Treasure_detail')" alt="">锦囊总览
                </button>
              </nav>
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
              <PetEscortLandscape :running="opened && !!current" />
              <div v-if="current" class="escort-value">
                <span>宝藏价值</span><strong><img :src="current.item.image" :alt="current.item.name">{{ current.item.count }}</strong>
                <span>已被挑战：{{ challengeCount(current) }}</span>
              </div>
              <div v-if="current" class="escort-cart" aria-hidden="true">
                <img class="escort-box" :src="art('img_s3Treasure_box')" alt="">
                <img class="escort-wagon" :src="art('img_s3Treasure_a7')" alt="">
                <picture v-for="side in ['left', 'right']" :key="side" class="escort-wheel" :class="`escort-wheel--${side}`">
                  <source :srcset="art('img_s3Treasure_a8')" media="(prefers-reduced-motion: reduce)">
                  <source srcset="/activity/pet-diary/escort-wheel.webp?v=20260910-motion" type="image/webp">
                  <img :src="art('img_s3Treasure_a8')" alt="">
                </picture>
              </div>
              <picture class="escort-dog" :class="{ 'escort-dog--idle': !current }">
                <source v-if="current" :srcset="art('escort-dog-walk')" media="(prefers-reduced-motion: reduce)">
                <source v-if="current" srcset="/activity/pet-diary/escort-dog-walk.webp?v=20260910-full-frame" type="image/webp">
                <img :src="art(current ? 'escort-dog-walk' : 'escort-dog-idle')" :alt="current ? '比熊护送宝藏' : '比熊等待护送'">
              </picture>
            </section>
            <section class="escort-charm-current">
              <h3>当前锦囊</h3>
              <article v-for="charm in pet.charms.equipped" :key="charm.id" class="escort-charm-row">
                <img :src="charm.image" alt=""><div><strong>{{ charm.name }}</strong><p>{{ charm.shortDescription }}</p><small v-if="charm.useLimit >= 0">剩余生效 {{ charm.remaining[0] ?? 0 }} / {{ charm.useLimit }} 次</small></div>
              </article>
              <p v-if="!pet.charms.equipped.length" class="escort-empty">
                今日尚未选择锦囊
              </p>
              <div class="escort-charm-actions">
                <button class="escort-button" :disabled="refreshDisabled" @click="refreshCharms">
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
            <button class="escort-button escort-primary" :disabled="busy || !completed.length" @click="diary.operate('openTreasure')">
              {{ pending === 'openTreasure' ? '领取中…' : '领取护送奖励' }}
            </button>
          </section>
          <button v-if="Number(pet.compensationCount) > 0" class="escort-button escort-compensation" :disabled="busy" @click="diary.operate('compensation')">
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
            <header><strong><img :src="art('img_s3Treasure_box')" alt="">宝藏价值 {{ treasure.item.count }} {{ treasure.item.name }}</strong><span>{{ status(treasure) }}</span></header>
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
            <p>查看好友挑战、宝藏损益及双方锦囊。</p><button class="escort-button" :disabled="!!pending" @click="diary.readExtra('plunder')">
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
            <header><strong>{{ entry.name || '好友' }} <small v-if="entry.level">Lv.{{ entry.level }}</small></strong><time>{{ date(entry.time) }}</time></header>
            <p>{{ entry.fake ? '触发假宝藏' : entry.won ? '对方夺宝成功' : '对方夺宝失败' }}<span v-if="entry.challenge?.id !== '0'"> · {{ entry.challenge?.name }}</span></p>
            <div class="escort-log-change">
              <span>宝藏减少：{{ items(entry.lost) }}</span><span>宝藏增加：{{ items(entry.injected) }}</span>
            </div>
            <details><summary>挑战详情</summary><p>对方锦囊：{{ charmNames(entry.attackerCharms) }}</p><p>我的锦囊：{{ charmNames(entry.defenderCharms) }}</p><small>对应宝藏：{{ entry.treasureId || '未提供' }}</small></details>
          </article>
        </section>
        <section v-else-if="view === 'choose'" class="escort-list escort-choices">
          <template v-if="pet.charms.canChoose">
            <article v-for="charm in pet.charms.equipped" :key="charm.id" class="escort-charm-row escort-charm-option escort-charm-choice">
              <span class="escort-current-ribbon">当前</span>
              <img :src="charm.image" alt=""><div><strong>{{ charm.name }}</strong><p>{{ charm.description }}</p><small v-if="charm.useLimit >= 0">剩余生效 {{ charm.remaining[0] ?? 0 }} / {{ charm.useLimit }} 次</small></div>
              <button class="escort-button" :disabled="busy" @click="chooseCharm(charm.id)">
                保留
              </button>
            </article>
            <article v-for="charm in charmChoices" :key="charm.id" class="escort-charm-row escort-charm-option escort-charm-choice">
              <img :src="charm.image" alt=""><div><strong>{{ charm.name }}</strong><p>{{ charm.description }}</p></div>
              <button class="escort-button" :disabled="busy" @click="chooseCharm(charm.id)">
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
            <h3>全部锦囊 · {{ pet.charms.all.length }} 种</h3><button class="escort-button" :disabled="refreshDisabled" @click="refreshCharms">
              {{ refreshLabel }}
            </button>
          </div>
          <p v-if="refreshHint" class="escort-note">
            {{ refreshHint }}
          </p>
          <article v-for="charm in allCharms" :key="charm.id" class="escort-charm-row escort-charm-option">
            <img :src="charm.image" alt=""><div><strong>{{ charm.name }} <span v-if="pet.charms.equipped.some(c => c.id === charm.id)" class="escort-equipped">当前生效</span></strong><p>{{ charm.description }}</p><small>{{ charm.useLimit < 0 ? '不限生效次数' : `最多生效 ${charm.useLimit} 次` }}</small></div>
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
          <button class="escort-text" @click="view = view === 'rules' ? 'home' : 'rules'">
            {{ view === 'rules' ? '返回护送' : '玩法说明' }}
          </button>
          <button class="escort-text" :disabled="!!pending" @click="diary.load(diary.accountId)">
            {{ pending === 'load' ? '刷新中…' : '刷新护送状态' }}
          </button>
        </footer>
      </div>
    </template>
  </dialog>
</template>

<style scoped>
.pet-escort {
  width: min(620px, calc(100vw - 24px));
  max-width: none;
  max-height: calc(100dvh - 24px);
  padding: 0;
  border: 7px solid #997654;
  border-radius: 30px;
  color: #755333;
  background: #f8edd2;
  box-shadow: 0 12px 44px #33291359;
  font:
    14px/1.5 'Microsoft YaHei',
    sans-serif;
  box-sizing: border-box;
}
.pet-escort::backdrop {
  background: #332d24a8;
}
.pet-escort *,
.pet-escort *::before,
.pet-escort *::after {
  box-sizing: border-box;
}
.pet-escort button {
  font: inherit;
  cursor: pointer;
}
.pet-escort button:disabled {
  cursor: default;
  opacity: 0.5;
}
.pet-escort button:focus-visible,
.pet-escort summary:focus-visible {
  outline: 3px solid #c1762e;
  outline-offset: 3px;
}
.pet-escort h2,
.pet-escort h3,
.pet-escort p {
  margin: 0;
}
.escort-header {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  min-height: 78px;
  padding: 10px 58px;
  background: #f3dfa6;
}
.escort-header h2 {
  flex: 1;
  font-size: 21px;
  text-align: center;
}
.escort-title {
  width: min(100%, 330px);
  height: 68px;
  object-fit: contain;
}
.escort-round {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  flex: none;
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  padding: 0;
  border: 2px solid #d59f65;
  border-radius: 50%;
  color: #fff9e6;
  background: #e7b271;
  line-height: 1;
}
.escort-round svg {
  display: block;
  width: 22px;
  height: 22px;
  fill: none;
  stroke: currentColor;
  stroke-width: 3;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.escort-back {
  left: 13px;
}
.escort-close {
  right: 13px;
}
.escort-body {
  position: relative;
  max-height: calc(100dvh - 126px);
  padding: 0 16px 14px;
  overflow-y: auto;
  overflow-x: hidden;
  overscroll-behavior: contain;
  scrollbar-width: thin;
}
.escort-feedback {
  margin: 10px 0 !important;
  padding: 10px 12px;
  border-radius: 10px;
  background: #e8ecc9;
  overflow-wrap: anywhere;
}
.escort-error {
  color: #9c3f2b;
  background: #f9dcc7;
}
.escort-tools {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  padding: 13px 0;
}
.escort-tools button {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 6px;
  padding: 7px 4px;
  border: 1px dashed #cbae75;
  border-radius: 14px;
  background: #fffae6;
  color: #7c593a;
  font-weight: 700;
  white-space: nowrap;
}
.escort-tools button[aria-current] {
  background: #e7ebc6;
  border-color: #9fad69;
}
.escort-tools img {
  width: 34px;
  height: 36px;
  object-fit: contain;
}
.escort-tools--home {
  position: absolute;
  top: 62px;
  right: 4px;
  z-index: 4;
  grid-template-columns: 1fr;
  gap: 9px;
  width: 60px;
  padding: 0;
}
.escort-tools--home button {
  flex-direction: column;
  gap: 0;
  padding: 0;
  border: 0;
  border-radius: 0;
  background: none;
  color: #fff9e8;
  font-size: 12px;
  text-shadow:
    0 1px 2px #644932,
    1px 0 2px #644932,
    -1px 0 2px #644932;
}
.escort-tools--home img {
  width: 39px;
  height: 41px;
}
.escort-journey {
  padding-bottom: 7px;
  overflow: hidden;
  border-radius: 22px 22px 26px 26px;
  background: #91ab54;
}
.escort-scene {
  position: relative;
  width: 100%;
  max-width: 100%;
  aspect-ratio: 610 / 420;
  min-height: 300px;
  overflow: hidden;
  background: url('/activity/pet-diary/img_s3Treasure_bg4.png') center / cover;
}
.escort-time {
  position: relative;
  z-index: 2;
  width: 72%;
  margin: auto;
  padding-top: 12px;
  text-align: center;
}
.escort-time h3 {
  color: white;
  text-shadow:
    0 2px #6c513d,
    1px 0 #6c513d,
    -1px 0 #6c513d;
  font-size: 23px;
}
.escort-time p {
  max-width: 330px;
  margin: 8px auto;
  color: #45665b;
}
.escort-progress {
  position: relative;
  max-width: 360px;
  height: 23px;
  margin: 6px auto;
  overflow: hidden;
  border: 2px solid #795a48;
  border-radius: 20px;
  background: #876a55;
}
.escort-progress progress {
  display: block;
  width: 100%;
  height: 100%;
  appearance: none;
  border: none;
  background: none;
}
.escort-progress progress::-webkit-progress-bar {
  background: transparent;
}
.escort-progress progress::-webkit-progress-value {
  background: #ffcf40;
  border-radius: 20px;
}
.escort-progress progress::-moz-progress-bar {
  background: #ffcf40;
  border-radius: 20px;
}
.escort-progress span {
  position: absolute;
  inset: 0;
  color: white;
  font-weight: 700;
  line-height: 19px;
  font-size: 12px;
  text-shadow: 0 1px 2px #543b26;
}
.escort-value {
  position: absolute;
  z-index: 2;
  left: 21%;
  top: 36%;
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 35%;
  padding: 7px 8px 11px;
  background: url('/activity/pet-diary/img_s3Treasure_bg1.png') center / 100% 100%;
  font-size: 12px;
  font-weight: 700;
  line-height: 1.35;
}
.escort-value strong {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 22px;
  line-height: 1.2;
}
.escort-value img {
  width: 22px;
  height: 22px;
  object-fit: contain;
}
.escort-cart {
  position: absolute;
  left: 29%;
  bottom: 9%;
  width: 18%;
  aspect-ratio: 88 / 82;
}
.escort-box {
  position: absolute;
  width: 69%;
  left: 16%;
  top: 0;
  transform-origin: center bottom;
}
.escort-wagon {
  position: absolute;
  width: 100%;
  bottom: 8.5%;
}
.escort-wheel {
  position: absolute;
  width: 24%;
  bottom: 0;
  display: block;
  transform-origin: center bottom;
}
.escort-wheel img,
.escort-dog img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.escort-wheel--left {
  left: 6%;
}
.escort-wheel--right {
  right: 6%;
}
.escort-dog {
  position: absolute;
  display: block;
  width: 21%;
  aspect-ratio: 128 / 132;
  left: 51%;
  bottom: 9%;
}
.escort-dog--idle {
  left: 50%;
  transform: translateX(-50%);
}
/* Official Cocos clip: 49 / 60 seconds; keep its held poses and short transitions. */
.escort-scene--moving .escort-wheel {
  animation: pet-escort-wheel 0.816667s linear infinite paused;
}
.escort-scene--moving .escort-wagon {
  animation: pet-escort-wagon 0.816667s linear infinite paused;
}
.escort-scene--moving .escort-box {
  animation: pet-escort-box 0.816667s linear infinite paused;
}
.pet-escort[open] .escort-scene--moving .escort-wheel,
.pet-escort[open] .escort-scene--moving .escort-wagon,
.pet-escort[open] .escort-scene--moving .escort-box {
  animation-play-state: running;
}
@keyframes pet-escort-wheel {
  0%,
  22.449%,
  97.959%,
  100% {
    transform: scale(1.1, 0.9);
  }
  24.49%,
  46.939%,
  73.469%,
  95.918% {
    transform: scale(1.05, 1);
  }
  48.98%,
  71.429% {
    transform: scale(1, 1.1);
  }
}
@keyframes pet-escort-wagon {
  0%,
  22.449%,
  97.959%,
  100% {
    transform: translateY(0);
  }
  24.49%,
  46.939%,
  73.469%,
  95.918% {
    transform: translateY(-1.4px);
  }
  48.98%,
  71.429% {
    transform: translateY(-2.8px);
  }
}
@keyframes pet-escort-box {
  0%,
  22.449%,
  97.959%,
  100% {
    transform: translateY(0) scale(1);
  }
  24.49%,
  46.939% {
    transform: translateY(-0.2px) scale(1.025, 0.975);
  }
  48.98%,
  71.429% {
    transform: translateY(-2px) scale(1.05, 0.95);
  }
  73.469%,
  95.918% {
    transform: translateY(-1.9px) scale(0.958, 1.042);
  }
}
@media (prefers-reduced-motion: reduce) {
  .escort-scene--moving .escort-wheel,
  .escort-scene--moving .escort-wagon,
  .escort-scene--moving .escort-box {
    animation: none;
  }
}
.escort-charm-current {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px 12px;
  margin: 0 6px;
  padding: 13px 18px 17px;
  border: 0;
  border-radius: 26px;
  background: #c8d5aa;
}
.escort-charm-current::before {
  position: absolute;
  inset: 5px;
  content: '';
  border: 1px dashed #b4c08d;
  border-radius: 18px;
  pointer-events: none;
}
.escort-charm-current > h3 {
  grid-column: 1 / -1;
  margin-top: -30px !important;
  justify-self: center;
  padding: 0 10px;
  background: transparent;
  color: #7c8c51;
  font-weight: 800;
  -webkit-text-stroke: 5px #d7e3b6;
  paint-order: stroke fill;
}
.escort-charm-current .escort-charm-row strong {
  font-size: 16px;
  color: #fffef0;
  text-shadow:
    0 1px 2px #627d39,
    1px 0 #627d39,
    -1px 0 #627d39;
}
.escort-charm-current .escort-charm-row p {
  color: #a76840;
  font-weight: 700;
}
.escort-charm-current .escort-charm-actions {
  align-self: center;
  margin-top: 0;
}
.escort-refresh-hint {
  grid-column: 1 / -1;
  text-align: right;
  font-size: 11px;
  color: #7d704b;
}
.escort-charm-current > h3,
.escort-rewards > h3 {
  margin-bottom: 10px;
  color: #78854b;
  text-align: center;
  font-size: 18px;
  letter-spacing: 2px;
}
.escort-charm-row {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}
.escort-charm-row > img {
  flex: none;
  width: 64px;
  height: 70px;
  object-fit: contain;
}
.escort-charm-row > div {
  flex: 1;
  min-width: 0;
}
.escort-charm-row strong {
  font-size: 17px;
}
.escort-charm-row p {
  margin-top: 4px;
}
.escort-charm-row small {
  color: #8c7b55;
}
.escort-charm-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 10px;
}
.escort-button {
  border: 2px solid #a87749;
  border-radius: 24px;
  padding: 6px 15px;
  color: #fffbea;
  background: #b88555;
  font-weight: 700 !important;
  white-space: nowrap;
}
.escort-choices {
  padding-top: 8px;
}
.escort-charm-choice {
  position: relative;
  margin: 14px 0 24px;
  border: 5px solid #b7956e;
  border-radius: 22px;
  background: #fff3d5 url('/activity/pet-diary/img_s3Treasure_bg1.png') center / 100% 100%;
  box-shadow: 0 4px #97704b55;
}
.escort-charm-choice .escort-button {
  min-width: 72px;
  padding: 8px 14px;
  border: 2px dashed #fff7d0;
  outline: 2px solid #f1cf68;
  border-radius: 18px;
  color: #a9702e;
  background: #ffdc60;
  box-shadow: 0 3px #b7956e55;
}
.escort-current-ribbon {
  position: absolute;
  top: -12px;
  left: -5px;
  padding: 1px 10px;
  transform: rotate(-5deg);
  border: 2px solid #86c69a;
  color: #fff;
  background: #4caa77;
  font-weight: 700;
}
.escort-primary {
  display: block;
  min-width: 190px;
  max-width: 100%;
  min-height: 48px;
  margin: 14px auto 0;
  color: #855332;
  border-color: #d6a750;
  background: #ffda68;
  font-size: 18px !important;
}
.escort-primary:disabled {
  background: #b7b29c;
  border-color: #999681;
  color: #faf5df;
  opacity: 0.85;
}
.escort-rewards {
  margin: 22px 0 0;
  padding: 16px 12px;
  border: 2px dashed #d7c598;
  border-radius: 18px;
}
.escort-rewards h3 {
  color: #aa8961;
}
.escort-rewards h3 span {
  font-size: 12px;
  letter-spacing: 0;
}
.escort-reward-items {
  display: flex;
  justify-content: center;
  gap: 12px;
  flex-wrap: wrap;
}
.escort-reward-items span {
  display: flex;
  align-items: center;
  gap: 7px;
}
.escort-reward-items img {
  width: 33px;
  height: 33px;
  object-fit: contain;
}
.escort-empty {
  padding: 23px 8px;
  color: #aa9e7b;
  text-align: center;
}
.escort-compensation {
  display: block;
  margin: 14px auto 0;
}
.escort-list {
  padding: 7px 0;
}
.escort-list > p {
  margin-bottom: 15px;
}
.escort-counts {
  display: flex;
  justify-content: space-around;
  gap: 8px;
  margin-bottom: 14px;
  padding: 13px 6px;
  border-radius: 14px;
  background: #e5e6c1;
}
.escort-list-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 10px;
  margin: 9px 0 16px;
}
.escort-treasure-card,
.escort-log-card,
.escort-charm-option {
  margin-bottom: 14px;
  padding: 16px;
  border: 1px solid #ddcba2;
  border-radius: 16px;
  background: #fff9e8;
}
.escort-treasure-card header,
.escort-log-card header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 10px;
}
.escort-treasure-card header strong {
  display: flex;
  align-items: center;
  gap: 7px;
}
.escort-treasure-card header img {
  width: 27px;
  height: 31px;
  object-fit: contain;
}
.escort-treasure-card header > span {
  padding: 2px 9px;
  background: #e0e8bd;
  color: #637b3b;
  border-radius: 15px;
  font-size: 12px;
}
.escort-treasure-card dl {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 13px 8px;
  margin: 15px 0;
}
.escort-treasure-card dt,
.escort-treasure-card small {
  color: #a08d6c;
  font-size: 12px;
}
.escort-treasure-card dd {
  margin: 3px 0 0;
  font-size: 17px;
  font-weight: 700;
}
.escort-treasure-card p {
  margin-top: 8px;
}
.escort-log-card time {
  font-size: 12px;
  color: #a08d6c;
}
.escort-log-change {
  display: grid;
  gap: 4px;
  margin: 10px 0;
}
.escort-log-card details {
  padding-top: 8px;
  border-top: 1px dashed #decba6;
}
.escort-log-card summary {
  cursor: pointer;
}
.escort-log-card details p {
  margin-top: 8px;
}
.escort-log-card small {
  overflow-wrap: anywhere;
}
.escort-equipped {
  display: inline-block;
  padding: 2px 7px;
  border-radius: 10px;
  background: #e2ebc6;
  color: #6d843e;
  font-size: 11px;
  white-space: nowrap;
}
.escort-note {
  color: #9f8d70;
  font-size: 12px;
}
.escort-rules {
  padding: 5px 10px 16px;
}
.escort-rules p {
  margin: 8px 0;
  white-space: pre-line;
}
.escort-rule-heading {
  margin-top: 20px !important;
  font-weight: 800;
  font-size: 18px;
}
.escort-footer {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding-top: 17px;
}
.escort-text {
  padding: 5px 0;
  border: 0;
  color: #a4845b;
  background: transparent;
  font-size: 12px !important;
  text-decoration: underline;
  text-underline-offset: 3px;
}
@media (max-width: 430px) {
  .pet-escort {
    width: calc(100vw - 16px);
    border-width: 5px;
    border-radius: 23px;
  }
  .escort-body {
    padding: 0 10px 12px;
  }
  .escort-header {
    min-height: 65px;
  }
  .escort-header h2 {
    font-size: 17px;
  }
  .escort-title {
    height: 56px;
  }
  .escort-tools {
    gap: 5px;
  }
  .escort-tools button {
    flex-direction: column;
    gap: 2px;
    font-size: 12px;
  }
  .escort-tools img {
    width: 30px;
    height: 32px;
  }
  .escort-tools--home {
    right: 3px;
    top: 74px;
    width: 47px;
    gap: 8px;
  }
  .escort-tools--home img {
    width: 33px;
    height: 35px;
  }
  .escort-scene {
    min-height: 300px;
  }
  .escort-time h3 {
    font-size: 21px;
  }
  .escort-value {
    left: 17%;
    width: 42%;
    top: 33%;
  }
  .escort-cart {
    left: 25%;
    width: 23%;
  }
  .escort-dog {
    width: 27%;
    left: 52%;
  }
  .escort-dog--idle {
    left: 50%;
  }
  .escort-charm-current {
    padding: 14px 10px;
    gap: 8px;
  }
  .escort-charm-row {
    gap: 9px;
  }
  .escort-charm-row > img {
    width: 52px;
    height: 58px;
  }
  .escort-charm-row strong {
    font-size: 15px;
  }
  .escort-charm-row p {
    font-size: 12px;
  }
  .escort-charm-option {
    flex-wrap: wrap;
    padding: 13px;
  }
  .escort-charm-option > button {
    margin-left: auto;
  }
  .escort-treasure-card {
    padding: 13px;
  }
}
@media (max-width: 350px) {
  .escort-charm-current {
    grid-template-columns: 1fr;
  }
  .escort-charm-current .escort-charm-actions {
    justify-content: flex-end;
  }
}
</style>
