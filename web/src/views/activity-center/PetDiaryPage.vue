<script setup lang="ts">
import type { PetItem } from '@/stores/pet-diary'
import { storeToRefs } from 'pinia'
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import ActivityShell from '@/components/activity/ActivityShell.vue'
import { useAccountStore } from '@/stores/account'
import { useFriendStore } from '@/stores/friend'
import { usePetDiaryStore } from '@/stores/pet-diary'
import PetMascot from './PetMascot.vue'
import PetPaw from './PetPaw.vue'
import PetSolarScene from './PetSolarScene.vue'
import PetTreasurePanel from './PetTreasurePanel.vue'

const emit = defineEmits<{ back: [] }>()
const accountStore = useAccountStore()
const friends = useFriendStore()
const diary = usePetDiaryStore()
const { activity: pet, pending, error, notice, stale, records, plunderRecords, friend } = storeToRefs(diary)
const tab = ref('home')
const friendId = ref('')
const logKind = ref<'interact' | 'plunder'>('interact')
const recordEntries = computed(() => logKind.value === 'plunder' ? plunderRecords.value : records.value)
const treasurePanel = ref<InstanceType<typeof PetTreasurePanel> | null>(null)
const quantities = ref<Record<string, number>>({})
const scrollViewport = ref<HTMLElement | null>(null)
const walletMenu = ref<HTMLDetailsElement | null>(null)
const recordDialog = ref<HTMLDialogElement | null>(null)
const giftPanel = ref<HTMLElement | null>(null)
const exchangeDialog = ref<HTMLDialogElement | null>(null)
const selectedGoodsId = ref('')
const selectedTermId = ref('')
const clientNow = ref(Date.now())
const offset = ref(0)
const timer = window.setInterval(() => clientNow.value = Date.now(), 1000)
onUnmounted(() => {
  window.clearInterval(timer)
  diary.clearNotice()
})
const now = computed(() => clientNow.value + offset.value)
const busy = computed(() => !!pending.value || stale.value || !pet.value?.active)
const tabs = [
  { id: 'home', label: '比熊之家', icon: '' },
  { id: 'stories', label: '爪印手记', icon: 'i-carbon-book' },
  { id: 'shop', label: '拾物小铺', icon: 'i-carbon-store' },
  { id: 'solar', label: '节令小礼', icon: 'i-carbon-sun' },
]
const growthPercent = computed(() => Math.min(100, (pet.value?.nurture.growth || 0) / (pet.value?.nurture.adultGrowth || 1) * 100))
const feedHint = computed(() => {
  const state = pet.value
  if (!state?.active || !state.nurture.initialized || (state.nurture.adult && !state.nurture.dogGranted))
    return ''
  const count = state.nurture.adult ? state.hunt.count : state.nurture.feedCount
  const limit = state.nurture.adult ? state.hunt.limit : state.nurture.feedLimit
  if (count >= limit)
    return state.nurture.adult ? '今日寻宝次数已用完' : '今日投喂次数已用完'
  const costs = state.nurture.adult ? state.hunt.costs : state.nurture.feedCosts
  if (costs.some(item => !state.balances.find(balance => balance.id === item.id)?.known))
    return '请刷新确认元气糕余额'
  if (costs.some(item => BigInt(state.balances.find(balance => balance.id === item.id)?.count || '0') < BigInt(item.count)))
    return '元气糕不足，请先收获活动作物'
  return ''
})
const unlocked = computed(() => pet.value?.stories.filter(s => s.unlocked).length || 0)
const albumPercent = computed(() => pet.value?.stories.length ? unlocked.value / pet.value.stories.length * 100 : 0)
const feedLabel = computed(() => {
  const state = pet.value
  if (!state)
    return ''
  return state.nurture.adult ? `今日寻宝 ${state.hunt.count} / ${state.hunt.limit}` : `今日投喂 ${state.nurture.feedCount} / ${state.nurture.feedLimit}`
})
const seedRewards = computed(() => pet.value?.seeds.days.find(d => d.claimable && !d.claimed)?.rewards || pet.value?.seeds.days[0]?.rewards || [])
const claimableTreasures = computed(() => pet.value?.treasures.some(t => t.status === 3 || (t.status === 2 && t.endTime > 0 && t.endTime <= now.value)))
const escortingCount = computed(() => pet.value?.treasures.filter(t => t.status === 2 && t.endTime > now.value).length || 0)
const waitingCount = computed(() => pet.value?.treasures.filter(t => t.status === 1).length || 0)
const luckyStars = computed(() => pet.value?.balances.find(item => item.id === '1029'))
const activityRemaining = computed(() => {
  const hours = Math.max(0, Math.ceil(((pet.value?.endTime || 0) - now.value) / 3600000))
  return pet.value?.active ? `${Math.floor(hours / 24)}天${hours % 24}时` : '活动已结束'
})
const currentTerm = computed(() => {
  const terms = pet.value?.solarTerms?.terms || []
  return terms.find(term => term.id === selectedTermId.value)
    || terms.find(term => Number(term.startTime) * 1000 <= now.value && Number(term.endTime) * 1000 >= now.value)
    || terms[0]
})
const exchangeItem = computed(() => pet.value?.shop.find(goods => goods.id === selectedGoodsId.value))
const exchangeQuantity = computed({
  get: () => quantities.value[selectedGoodsId.value] ?? 1,
  set: (value: number) => quantities.value[selectedGoodsId.value] = value,
})
const exchangeLimit = computed(() => Math.min(9999, Number(exchangeItem.value?.remaining ?? 9999)))
const validQuantity = computed(() => Number.isSafeInteger(exchangeQuantity.value) && exchangeQuantity.value > 0 && exchangeQuantity.value <= exchangeLimit.value)
const exchangeCosts = computed(() => validQuantity.value ? exchangeItem.value?.costs.map(item => ({ ...item, count: String(BigInt(item.count) * BigInt(exchangeQuantity.value)) })) || [] : [])
const affordableQuantity = computed(() => {
  const costs = new Map<string, bigint>()
  for (const item of exchangeItem.value?.costs || [])
    costs.set(item.id, (costs.get(item.id) || 0n) + BigInt(item.count))
  let limit = BigInt(exchangeLimit.value)
  for (const [id, cost] of costs) {
    const balance = pet.value?.balances.find(item => item.id === id)
    if (!balance?.known)
      return 0
    if (cost > 0n && BigInt(balance.count) / cost < limit)
      limit = BigInt(balance.count) / cost
  }
  return Number(limit)
})
const canExchange = computed(() => !busy.value && exchangeItem.value?.exchangeable && validQuantity.value && exchangeQuantity.value <= affordableQuantity.value)
const exchangeHint = computed(() => {
  if (!exchangeItem.value?.safeCosts)
    return '此商品当前不可兑换'
  if (!exchangeLimit.value)
    return '此商品已兑完'
  if (!validQuantity.value)
    return `请输入 1–${exchangeLimit.value} 之间的整数`
  if (exchangeQuantity.value > affordableQuantity.value)
    return '道具余额不足'
  return ''
})
async function openExchange(id: string) {
  selectedGoodsId.value = id
  quantities.value[id] = 1
  await nextTick()
  exchangeDialog.value?.showModal()
}
async function submitExchange() {
  if (!canExchange.value)
    return
  const id = selectedGoodsId.value
  const owner = accountId()
  await diary.operate('exchange', { goodsId: id, count: exchangeQuantity.value })
  if (owner === accountId() && selectedGoodsId.value === id && !error.value)
    exchangeDialog.value?.close()
}
async function showRecords() {
  diary.clearNotice()
  await nextTick()
  recordDialog.value?.showModal()
  await readLogs('interact')
}
function feedBalance(item: PetItem) {
  const balance = pet.value?.balances.find(balance => balance.id === item.id)
  return balance?.known ? `${balance.count} / ${item.count}` : `待刷新 / ${item.count}`
}
function date(value: number) {
  return new Date(value).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
}
function time(value: number) {
  return new Date(value).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}
function itemText(items: PetItem[] = []) {
  return items.map(i => `${i.name} ×${i.count}`).join('、')
}
function remaining(end: number) {
  const minutes = Math.max(0, Math.ceil((end - now.value) / 60000))
  return minutes > 0 ? `${Math.floor(minutes / 60)}小时${minutes % 60}分` : '已到结算时间'
}
function accountId() {
  return String(accountStore.currentAccountId || '')
}
function load() {
  return diary.load(accountId())
}
function scrollToGift() {
  const viewport = scrollViewport.value
  const target = giftPanel.value
  if (!viewport || !target)
    return
  viewport.scrollBy({ top: target.getBoundingClientRect().top - viewport.getBoundingClientRect().top - 12, behavior: 'smooth' })
}
async function loadFriends() {
  await friends.fetchFriends(accountId())
}
async function readLogs(kind: 'interact' | 'plunder') {
  logKind.value = kind
  await diary.readExtra(kind)
}
watch(() => accountStore.currentAccountId, () => {
  exchangeDialog.value?.close()
  recordDialog.value?.close()
  selectedGoodsId.value = ''
  selectedTermId.value = ''
  friendId.value = ''
  quantities.value = {}
  tab.value = 'home'
  void load()
}, { immediate: true })
watch(tab, () => {
  diary.clearNotice()
  if (scrollViewport.value)
    scrollViewport.value.scrollTop = 0
  walletMenu.value?.removeAttribute('open')
}, { flush: 'post' })
watch(pet, (value) => {
  if (value)
    offset.value = value.serverTime - Date.now()
})
</script>

<template>
  <ActivityShell theme="day">
    <div class="pet-diary" aria-label="萌宠成长日记">
      <header class="pet-header">
        <div class="pet-header__brand">
          <button type="button" class="pet-back" aria-label="返回活动列表" @click="emit('back')">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 4-8 8 8 8" /></svg>
            <span class="pet-back__text">活动列表</span>
          </button>
          <div class="pet-title">
            <small>活动中心</small>
            <h1>萌宠成长日记</h1>
          </div>
        </div>
        <span v-if="pet" class="pet-countdown" :title="`${date(pet.startTime)} — ${date(pet.endTime)}`">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="13" r="8" /><path d="M12 9v4l3 2M9 3h6" /></svg>
          <span class="pet-countdown__label">剩余：</span>{{ activityRemaining }}
        </span>
        <details v-if="pet" ref="walletMenu" class="pet-wallet-menu">
          <summary :aria-label="`查看活动道具余额，累计获得 ${pet.hunt.luckyStarTotal} 幸运星`">
            <img :src="luckyStars?.image || '/game-config/seed_images_named/seed_images/1029.png'" alt="">
            <strong>{{ luckyStars?.known ? Number(luckyStars.count).toLocaleString() : '—' }}</strong>
            <svg class="pet-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5" /></svg>
          </summary>
          <div class="pet-wallet">
            <div v-for="item in pet.balances" :key="item.id" class="pet-wallet__row">
              <img :src="item.image" alt="">
              <span>{{ item.name }}<strong>{{ item.known ? Number(item.count).toLocaleString() : '待刷新' }}</strong></span>
            </div>
            <p>累计获得 {{ pet.hunt.luckyStarTotal }} 幸运星</p>
          </div>
        </details>
        <button v-if="pet" type="button" class="pet-refresh" :disabled="!!pending" :aria-label="pending === 'load' ? '刷新中' : '刷新活动'" @click="load">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.5 12a7.5 7.5 0 1 1-2.3-5.4" /><path d="M20 3.6v5h-5" /></svg>
        </button>
      </header>

      <div v-if="error || notice || pet?.warnings.length" class="pet-status">
        <p v-if="error" class="pet-message pet-message--error" role="alert">
          <span>{{ error }}</span>
          <button type="button" :disabled="!!pending" @click="load">
            重新刷新
          </button>
        </p>
        <p v-if="notice" class="pet-message pet-message--ok" role="status">
          {{ notice }}
        </p>
        <p v-for="warning in pet?.warnings || []" :key="warning" class="pet-message pet-message--warn">
          {{ warning }}
        </p>
      </div>

      <div ref="scrollViewport" class="pet-body" tabindex="0" :aria-label="`${tabs.find(entry => entry.id === tab)?.label}内容`">
        <div class="pet-content">
          <div v-if="!accountId()" class="pet-empty pet-empty--tall">
            请先选择账号
          </div>
          <div v-else-if="pending === 'load' && !pet" class="pet-empty pet-empty--tall" role="status">
            <span class="activity-spinner" />
            <strong>正在加载萌宠成长日记</strong>
          </div>

          <main v-if="pet && tab === 'home'" class="pet-home">
            <section class="pet-hero" aria-label="比熊之家">
              <div class="pet-hero__art">
                <PetMascot :stage="pet.nurture.adult ? 'adult' : 'puppy'" animated />
              </div>
              <div class="pet-hero__main">
                <div class="pet-hero__head">
                  <h2>比熊犬</h2>
                  <span class="pet-chip" :class="pet.nurture.adult ? 'pet-chip--gold' : 'pet-chip--blue'">{{ pet.nurture.adult ? '天工' : '稀有' }}</span>
                  <span class="pet-chip">{{ pet.nurture.adult ? '成年期' : '幼年期' }}</span>
                </div>
                <p class="pet-quote">
                  {{ pet.nurture.adult ? '我长大啦~以后这个家我来看着！' : '把我喂到成年，我就能去农场看家护院啦~' }}
                </p>
                <div class="pet-growth">
                  <div class="pet-growth__top">
                    <span>成长进度</span>
                    <b>{{ pet.nurture.adult ? '已达成' : `${pet.nurture.growth} / ${pet.nurture.adultGrowth}` }}</b>
                  </div>
                  <progress :value="pet.nurture.growth" :max="pet.nurture.adultGrowth" :aria-label="`成长进度 ${growthPercent.toFixed(0)}%`" />
                </div>
                <div class="pet-care">
                  <button v-if="!pet.nurture.initialized" type="button" class="pet-button pet-button--primary" :disabled="busy" @click="diary.operate('initialize')">
                    领养比熊
                  </button>
                  <button v-else-if="!pet.nurture.adult" type="button" class="pet-button pet-button--primary" :disabled="busy || !pet.nurture.canFeed" @click="diary.operate('feed')">
                    {{ pending === 'feed' ? '投喂中…' : '投喂元气糕' }}
                  </button>
                  <button v-else-if="!pet.nurture.dogGranted" type="button" class="pet-button pet-button--primary" :disabled="busy" @click="diary.operate('claimDog')">
                    {{ pending === 'claimDog' ? '领取中…' : '领取永久比熊' }}
                  </button>
                  <button v-else type="button" class="pet-button pet-button--primary" :disabled="busy || !pet.hunt.canDraw" @click="diary.operate('draw')">
                    {{ pending === 'draw' ? '投喂中…' : '投喂元气糕' }}
                  </button>
                  <span v-for="item in pet.nurture.adult ? pet.hunt.costs : pet.nurture.feedCosts" :key="item.id" class="pet-cost" :title="item.name">
                    <img :src="item.image" :alt="item.name">
                    <span>{{ feedBalance(item) }}</span>
                  </span>
                </div>
                <p class="pet-note">
                  {{ feedLabel }}
                </p>
                <p v-if="feedHint" class="pet-note pet-note--warning">
                  {{ feedHint }}
                </p>
                <div class="pet-quick">
                  <button type="button" class="pet-quick__item" :disabled="!!pending" @click="showRecords">
                    <PetPaw />互动记录
                  </button>
                  <button type="button" class="pet-quick__item" @click="scrollToGift">
                    <PetPaw />种子赠礼
                  </button>
                  <button v-if="pet.nurture.adult" type="button" class="pet-quick__item" @click="treasurePanel?.open()">
                    <PetPaw />宝藏护送
                    <em v-if="claimableTreasures">可领取</em>
                    <em v-else>护送中 {{ escortingCount }}</em>
                  </button>
                </div>
              </div>
            </section>

            <div class="pet-grid">
              <article id="pet-seed-gift" ref="giftPanel" class="pet-card">
                <h3 class="pet-card__head">
                  <PetPaw />
                  <span>每日种子赠礼</span>
                  <small>{{ pet.seeds.canClaim ? '今日可领' : '今日已领' }}</small>
                </h3>
                <p class="pet-card__text">
                  每日赠送 1 份免费的稀有种子礼包，每日 0 点刷新；未领取的礼包可累计保留。
                </p>
                <div class="pet-rewards">
                  <div v-for="item in seedRewards" :key="item.id" class="pet-reward" :title="item.name">
                    <img :src="item.image" :alt="item.name">
                    <strong>× {{ item.count }}</strong>
                    <small>{{ item.name }}</small>
                  </div>
                </div>
                <button type="button" class="pet-button pet-button--primary pet-button--block" :disabled="busy || !pet.seeds.canClaim" @click="diary.operate('seeds')">
                  {{ pending === 'seeds' ? '领取中…' : pet.seeds.canClaim ? '领取种子礼包' : '今日礼包已领取' }}
                </button>
                <p v-if="pet.nurture.adult" class="pet-note">
                  {{ pet.nurture.dogGranted ? '比熊已永久加入你的农场' : '成年奖励：领取永久比熊' }}
                </p>
                <button v-if="pet.nurture.adult && !pet.nurture.dogGranted" type="button" class="pet-button pet-button--block" :disabled="busy" @click="diary.operate('claimDog')">
                  领取永久比熊
                </button>
              </article>

              <article class="pet-card">
                <h3 class="pet-card__head">
                  <PetPaw />
                  <span>宝藏护送</span>
                  <small>护送中 {{ escortingCount }} · 待护送 {{ waitingCount }}</small>
                </h3>
                <p class="pet-card__text">
                  {{ pet.nurture.adult ? '查看宝藏价值、被挑战次数、护送日志和待领奖励。待护送宝藏会自动开始护送。' : '将比熊培育至成年后，可通过寻宝获取宝藏并自动护送。' }}
                </p>
                <p v-if="!pet.treasures.length" class="pet-empty pet-empty--inline">
                  暂无待护送宝藏
                </p>
                <button type="button" class="pet-button pet-button--block" :disabled="!pet.nurture.adult" @click="treasurePanel?.open()">
                  {{ claimableTreasures ? '查看并领取奖励' : '查看宝藏' }}
                </button>
              </article>

              <article class="pet-card">
                <h3 class="pet-card__head">
                  <PetPaw />
                  <span>今日锦囊</span>
                </h3>
                <div v-for="charm in pet.charms.equipped" :key="charm.id" class="pet-charm">
                  <img :src="charm.image" :alt="charm.name">
                  <div>
                    <strong>{{ charm.name }} <small>已生效</small></strong>
                    <p>{{ charm.description }}</p>
                    <span v-if="charm.remaining.length">剩余生效次数：{{ charm.remaining.join(' / ') }}</span>
                  </div>
                </div>
                <p v-if="!pet.charms.equipped.length" class="pet-empty pet-empty--inline">
                  {{ pet.nurture.adult ? '进入宝藏护送挑选锦囊。' : '成年后可搭配锦囊参与宝藏护送。' }}
                </p>
                <small class="pet-note">{{ pet.charms.refreshNote }}</small>
                <button type="button" class="pet-button pet-button--block" :disabled="!pet.nurture.adult" @click="treasurePanel?.open('charms')">
                  查看锦囊总览
                </button>
              </article>

              <details open class="pet-card pet-card--wide">
                <summary class="pet-card__head">
                  <PetPaw />
                  <span>好友夺宝</span>
                  <small>今日 {{ pet.battleCount }}/{{ pet.battleLimit }}</small>
                  <span class="pet-card__toggle i-carbon-chevron-down" aria-hidden="true" />
                </summary>
                <p class="pet-card__text">
                  消耗一张挑战书参与夺宝，收益与可用挑战书以好友当前宝藏为准。
                </p>
                <div class="pet-steal">
                  <button type="button" class="pet-button pet-button--small" :disabled="!!pending || friends.loading" @click="loadFriends">
                    读取好友
                  </button>
                  <select v-model="friendId" aria-label="选择夺宝好友">
                    <option value="">
                      选择好友
                    </option>
                    <option v-for="f in friends.friends" :key="String(f.gid)" :value="String(f.gid)">
                      {{ f.name || f.gid }}
                    </option>
                  </select>
                  <button type="button" class="pet-button pet-button--small pet-button--primary" :disabled="!!pending || !friendId || !pet.hunt.canPlunder" @click="diary.readExtra('friend', friendId)">
                    查看宝藏
                  </button>
                </div>
                <p v-if="!pet.hunt.canPlunder" class="pet-note">
                  成年并满足活动条件后开放夺宝；每日最多 {{ pet.battleLimit }} 次。
                </p>
                <div v-if="friend" class="pet-steal__list">
                  <p v-if="!friend.treasures.length" class="pet-empty pet-empty--inline">
                    这位好友当前没有可查看的宝藏。
                  </p>
                  <article v-for="treasure in friend.treasures" :key="treasure.id" class="pet-steal__treasure">
                    <header>
                      <strong>{{ treasure.item.name }} ×{{ treasure.item.count }}</strong>
                      <span>{{ treasure.status === 2 ? remaining(treasure.endTime) : '当前不可夺宝' }}</span>
                    </header>
                    <div v-for="preview in treasure.previews" :key="preview.challengeId" class="pet-steal__preview">
                      <span>{{ pet.balances.find(i => i.id === preview.challengeId)?.name || '挑战书' }} ×1</span>
                      <span>最高收益 {{ preview.maxProfit.count }} · 最大损失 {{ preview.maxLoss.count }}</span>
                      <button type="button" class="pet-button pet-button--small" :disabled="busy || !preview.canStart || treasure.status !== 2 || !Number(pet.balances.find(i => i.id === preview.challengeId)?.count)" @click="diary.operate('battle', { gid: friend.gid, treasureId: treasure.id, challengeId: preview.challengeId })">
                        发起夺宝
                      </button>
                    </div>
                  </article>
                </div>
              </details>

              <details class="pet-card pet-card--wide">
                <summary class="pet-card__head">
                  <PetPaw />
                  <span>活动说明</span>
                  <span class="pet-card__toggle i-carbon-chevron-down" aria-hidden="true" />
                </summary>
                <p v-for="(rule, index) in pet.rules" :key="index" class="pet-card__text">
                  {{ rule }}
                </p>
              </details>
            </div>
          </main>

          <main v-else-if="pet && tab === 'stories'" class="pet-album" aria-label="爪印手记">
            <section class="pet-album__head">
              <div>
                <h2>爪印手记</h2>
                <p>多跟比熊互动可以解锁更多照片哦~</p>
              </div>
              <span class="pet-chip pet-chip--gold">已解锁 {{ unlocked }} / {{ pet.stories.length }}</span>
            </section>
            <div class="pet-album__bar" role="presentation">
              <i :style="{ width: `${albumPercent}%` }" />
            </div>
            <div class="pet-album__grid">
              <article v-for="story in pet.stories" :key="story.order" class="pet-photo" :class="{ 'pet-photo--locked': !story.unlocked }">
                <div class="pet-photo__frame">
                  <img v-if="story.unlocked && story.photo" :src="story.photo" :alt="`第 ${story.order} 则手记照片`" loading="lazy" decoding="async">
                  <span v-else class="pet-photo__empty">
                    <PetPaw />
                    <small>未解锁</small>
                  </span>
                </div>
                <div class="pet-photo__body">
                  <strong>第 {{ story.order }} 则</strong>
                </div>
                <button v-if="story.unlocked" type="button" class="pet-button pet-button--small pet-button--block" :disabled="busy || story.claimed" @click="diary.operate('story', { order: story.order })">
                  {{ story.claimed ? '已领取' : '领取奖励' }}
                </button>
              </article>
            </div>
          </main>

          <main v-else-if="pet && tab === 'shop'" class="pet-shop" aria-label="拾物小铺">
            <p class="pet-notice">
              <PetPaw />收集幸运星，可兑换游记限定奖励
            </p>
            <p v-if="!pet.shop.length" class="pet-empty">
              小铺目录暂未加载，请刷新重试。
            </p>
            <div class="pet-goods">
              <button v-for="goods in pet.shop" :key="goods.id" type="button" class="pet-goods__item" :class="{ 'pet-goods__item--sold': goods.remaining === '0' }" :aria-label="`查看${goods.name}兑换信息`" @click="openExchange(goods.id)">
                <span class="pet-goods__thumb">
                  <img :src="goods.image" :alt="goods.name" loading="lazy" decoding="async">
                </span>
                <strong>{{ goods.name }}</strong>
                <span class="pet-goods__price">
                  <span v-for="cost in goods.costs" :key="cost.id"><img :src="cost.image" :alt="cost.name">{{ Number(cost.count).toLocaleString() }}</span>
                </span>
                <span v-if="goods.remaining === '0'" class="pet-goods__sold">已兑完</span>
              </button>
            </div>
          </main>

          <main v-else-if="pet" class="pet-solar" aria-label="节令小礼">
            <p v-if="!currentTerm" class="pet-empty">
              节令数据暂未加载，请刷新重试。
            </p>
            <template v-else>
              <div class="pet-terms" aria-label="选择节令">
                <button v-for="term in pet.solarTerms?.terms || []" :key="term.id" type="button" :class="{ 'is-active': currentTerm.id === term.id, 'is-locked': term.statusCode === '1' }" :aria-pressed="currentTerm.id === term.id" @click="selectedTermId = term.id">
                  {{ term.name }}<span v-if="term.statusCode === '1'" class="i-carbon-locked" aria-hidden="true" />
                </button>
              </div>
              <section class="pet-solar__card">
                <PetSolarScene :term="currentTerm.name" />
                <div class="pet-solar__info">
                  <h2>{{ currentTerm.name }} · 节令赠礼</h2>
                  <p class="pet-note">
                    {{ date(Number(currentTerm.startTime) * 1000) }} — {{ date(Number(currentTerm.endTime) * 1000) }}
                  </p>
                  <div class="pet-rewards">
                    <div v-for="item in currentTerm.rewards" :key="item.id" class="pet-reward" :title="item.name">
                      <img :src="item.image" :alt="item.name">
                      <strong>× {{ item.count }}</strong>
                      <small>{{ item.name }}</small>
                    </div>
                  </div>
                  <button type="button" class="pet-button pet-button--primary" :disabled="busy || !currentTerm.canClaim" @click="diary.operate('solar', { termId: currentTerm.id })">
                    {{ pending === 'solar' ? '领取中…' : currentTerm.canClaim ? '领取节令好礼' : currentTerm.statusCode === '3' ? '已领取' : '未到领取时间' }}
                  </button>
                </div>
              </section>
            </template>
          </main>
        </div>
      </div>

      <nav v-if="pet" class="pet-nav" aria-label="活动栏目">
        <div class="pet-nav__inner">
          <button v-for="entry in tabs" :key="entry.id" type="button" :class="{ 'is-active': tab === entry.id }" :aria-current="tab === entry.id ? 'page' : undefined" :aria-label="entry.label" @click="tab = entry.id">
            <PetPaw v-if="entry.id === 'home'" class="pet-nav__icon" />
            <span v-else class="pet-nav__icon" :class="entry.icon" aria-hidden="true" />
            <strong>{{ entry.label }}</strong>
            <i v-if="entry.id === 'stories' && pet.stories.some(story => story.unlocked && !story.claimed)" class="pet-nav__badge" aria-label="有可领取的手记奖励" />
          </button>
        </div>
      </nav>

      <dialog ref="exchangeDialog" class="pet-dialog" aria-labelledby="pet-exchange-title" @close="selectedGoodsId = ''" @click.self="exchangeDialog?.close()">
        <header class="pet-dialog__head">
          <h2 id="pet-exchange-title">
            兑换
          </h2>
          <button type="button" class="pet-dialog__close" aria-label="关闭兑换窗口" @click="exchangeDialog?.close()">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6" /></svg>
          </button>
        </header>
        <div v-if="exchangeItem" class="pet-dialog__body">
          <div class="pet-dialog__product">
            <img :src="exchangeItem.image" :alt="exchangeItem.name">
            <div>
              <h3>{{ exchangeItem.name }}</h3>
              <p>{{ itemText(exchangeItem.rewards) }}</p>
            </div>
          </div>
          <label class="pet-field" for="pet-exchange-quantity">兑换数量</label>
          <div class="pet-quantity">
            <button type="button" :disabled="!!pending || exchangeQuantity <= 1" aria-label="减少兑换数量" @click="exchangeQuantity = Math.max(1, (Number(exchangeQuantity) || 1) - 1)">
              −
            </button>
            <input id="pet-exchange-quantity" v-model.number="exchangeQuantity" type="number" inputmode="numeric" min="1" :max="exchangeLimit" :disabled="!!pending">
            <button type="button" :disabled="!!pending || exchangeQuantity >= exchangeLimit" aria-label="增加兑换数量" @click="exchangeQuantity = Math.min(exchangeLimit, (Number(exchangeQuantity) || 0) + 1)">
              +
            </button>
            <button type="button" :disabled="!!pending || !affordableQuantity" @click="exchangeQuantity = affordableQuantity">
              最大
            </button>
          </div>
          <p class="pet-note">
            {{ exchangeItem.remaining === null ? '不限量' : `剩余可兑：${exchangeItem.remaining} / ${exchangeItem.limit}` }}
          </p>
          <div class="pet-costs" aria-live="polite">
            <span v-for="cost in exchangeCosts" :key="cost.id"><img :src="cost.image" :alt="cost.name">{{ Number(cost.count).toLocaleString() }}</span>
          </div>
          <p v-if="exchangeHint" class="pet-note" role="status">
            {{ exchangeHint }}
          </p>
          <p v-if="error" class="pet-message pet-message--error" role="alert">
            {{ error }}
          </p>
          <button type="button" class="pet-button pet-button--primary pet-button--block" :disabled="!canExchange" @click="submitExchange">
            {{ pending === 'exchange' ? '兑换中…' : '兑换' }}
          </button>
        </div>
      </dialog>

      <dialog ref="recordDialog" class="pet-dialog" aria-labelledby="pet-record-title" @click.self="recordDialog?.close()">
        <header class="pet-dialog__head">
          <h2 id="pet-record-title">
            互动记录
          </h2>
          <button type="button" class="pet-dialog__close" aria-label="关闭互动记录" @click="recordDialog?.close()">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6" /></svg>
          </button>
        </header>
        <div class="pet-dialog__body">
          <div class="pet-log__tabs" aria-label="记录类型">
            <button type="button" class="pet-button pet-button--small" :class="{ 'pet-button--primary': logKind === 'interact' }" :disabled="!!pending" @click="readLogs('interact')">
              互动记录
            </button>
            <button type="button" class="pet-button pet-button--small" :class="{ 'pet-button--primary': logKind === 'plunder' }" :disabled="!!pending" @click="readLogs('plunder')">
              被夺宝记录
            </button>
          </div>
          <p v-if="error" class="pet-message pet-message--error" role="alert">
            <span>{{ error }}</span>
            <button type="button" :disabled="!!pending" @click="readLogs(logKind)">
              重试
            </button>
          </p>
          <p v-if="pending === 'interact' || pending === 'plunder'" class="pet-empty pet-empty--inline" role="status">
            正在读取记录…
          </p>
          <p v-else-if="!error && !recordEntries?.length" class="pet-empty pet-empty--inline">
            暂无{{ logKind === 'interact' ? '互动' : '被夺宝' }}记录。
          </p>
          <div v-for="(entry, index) in recordEntries" :key="index" class="pet-log">
            <time>{{ time(entry.time) }}</time>
            <template v-if="logKind === 'interact'">
              <span>消耗：{{ itemText(entry.costs) || '无' }}</span>
              <strong>获得：{{ itemText(entry.rewards) || '无道具奖励' }}</strong>
            </template>
            <template v-else>
              <span>{{ entry.name }} · {{ entry.won ? '夺宝成功' : '夺宝失败' }}{{ entry.fake ? ' · 锦囊记录' : '' }}</span>
              <strong>损失 {{ itemText(entry.lost) || '无' }} · 注入 {{ itemText(entry.injected) || '无' }}</strong>
            </template>
          </div>
        </div>
      </dialog>

      <PetTreasurePanel v-if="pet" ref="treasurePanel" :now="now" />
    </div>
  </ActivityShell>
</template>

<style scoped>
.pet-diary {
  --pet-accent: var(--ui-warning);
  --pet-accent-deep: #a9762c;
  --pet-accent-soft: var(--ui-warning-soft);
  --pet-paper: #fffdf8;
  --pet-paper-2: #fbf5ea;
  --pet-line: #e9dfcb;
  --pet-line-soft: #f2ead9;
  --pet-line-strong: #dfd3ba;
  --pet-ink: #453d33;
  --pet-ink-2: #6f6558;
  --pet-muted: #9a8f80;
  display: flex;
  height: 100%;
  min-height: 0;
  flex-direction: column;
  overflow: hidden;
  color: var(--pet-ink);
  background: linear-gradient(180deg, #fffdf8 0%, #fbf6ec 46%, #fbf6ec 100%);
  font-family: 'Microsoft YaHei', 'PingFang SC', sans-serif;
  font-size: 13px;
  line-height: 1.6;
}

.pet-diary *,
.pet-diary *::before,
.pet-diary *::after {
  box-sizing: border-box;
}

.pet-diary button,
.pet-diary input,
.pet-diary select {
  font-family: inherit;
}

/* ---------- 顶部栏 ---------- */
.pet-header {
  position: relative;
  z-index: 6;
  display: flex;
  flex: none;
  align-items: center;
  gap: 10px;
  height: 62px;
  padding: 0 14px;
  border-bottom: 1px solid var(--pet-line-soft);
  background: #fff;
}

.pet-header__brand {
  display: flex;
  flex: 1;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.pet-back {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 3px;
  height: 34px;
  padding: 0 12px 0 8px;
  border: 1px solid var(--pet-line);
  border-radius: 10px;
  background: #fff;
  color: var(--ui-primary);
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}

.pet-back svg {
  width: 17px;
  height: 17px;
  flex: none;
  fill: none;
  stroke: currentcolor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.pet-title {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.pet-title small {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--pet-muted);
}

.pet-title h1 {
  margin: 0;
  overflow: hidden;
  font-size: 18px;
  font-weight: 800;
  line-height: 1.3;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pet-countdown {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 5px;
  height: 32px;
  padding: 0 12px;
  border: 1px solid var(--pet-line);
  border-radius: 999px;
  background: #fff;
  color: var(--pet-ink-2);
  font-size: 12px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.pet-countdown svg {
  width: 15px;
  height: 15px;
  fill: none;
  stroke: var(--pet-muted);
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.pet-wallet-menu {
  position: relative;
  flex: none;
}

.pet-wallet-menu > summary {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 32px;
  padding: 0 8px 0 6px;
  border: 1px solid var(--pet-line);
  border-radius: 999px;
  background: #fff;
  color: var(--pet-accent-deep);
  font-size: 12.5px;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  cursor: pointer;
  list-style: none;
}

.pet-wallet-menu > summary::-webkit-details-marker {
  display: none;
}

.pet-wallet-menu > summary img {
  width: 22px;
  height: 22px;
  flex: none;
  border-radius: 50%;
  object-fit: contain;
  background: var(--pet-accent-soft);
}

.pet-chevron {
  width: 14px;
  height: 14px;
  flex: none;
  fill: none;
  stroke: var(--pet-muted);
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
  transition: transform 0.18s ease;
}

.pet-wallet-menu[open] .pet-chevron {
  transform: rotate(180deg);
}

.pet-wallet {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  z-index: 30;
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 216px;
  max-height: 60vh;
  overflow-y: auto;
  padding: 12px;
  border: 1px solid var(--pet-line);
  border-radius: 12px;
  background: #fff;
  box-shadow: 0 16px 36px rgba(96, 78, 46, 0.16);
}

.pet-wallet__row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.pet-wallet__row img {
  width: 26px;
  height: 26px;
  flex: none;
  border-radius: 50%;
  object-fit: contain;
  background: var(--pet-paper-2);
}

.pet-wallet__row span {
  display: flex;
  flex: 1;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
  font-size: 12px;
  color: var(--pet-ink-2);
}

.pet-wallet__row strong {
  font-size: 12.5px;
  font-variant-numeric: tabular-nums;
  color: var(--pet-ink);
}

.pet-wallet p {
  margin: 0;
  padding-top: 8px;
  border-top: 1px dashed var(--pet-line-soft);
  font-size: 11.5px;
  color: var(--pet-muted);
}

.pet-refresh {
  display: grid;
  flex: none;
  width: 34px;
  height: 34px;
  place-items: center;
  border: 1px solid var(--pet-line);
  border-radius: 10px;
  background: #fff;
  color: var(--ui-primary);
  cursor: pointer;
}

.pet-refresh:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.pet-refresh svg {
  width: 17px;
  height: 17px;
  fill: none;
  stroke: currentcolor;
  stroke-width: 1.9;
  stroke-linecap: round;
  stroke-linejoin: round;
}

/* ---------- 状态提示 ---------- */
.pet-status {
  display: flex;
  flex: none;
  flex-direction: column;
  gap: 6px;
  padding: 8px 14px 0;
}

.pet-message {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0;
  padding: 9px 12px;
  border: 1px solid var(--pet-line);
  border-radius: 10px;
  background: #fff;
  font-size: 12.5px;
  font-weight: 700;
  color: var(--pet-ink-2);
}

.pet-message span {
  flex: 1;
  min-width: 0;
}

.pet-message button {
  flex: none;
  height: 28px;
  padding: 0 10px;
  border: 1px solid currentcolor;
  border-radius: 8px;
  background: transparent;
  color: inherit;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}

.pet-message--error {
  border-color: #ecc9cb;
  background: var(--ui-danger-soft);
  color: #a8474e;
}

.pet-message--ok {
  border-color: #c4ddcd;
  background: var(--ui-primary-soft);
  color: #2f6f4b;
}

.pet-message--warn {
  border-color: #eedcbb;
  background: var(--pet-accent-soft);
  color: #8a6520;
}
/* ---------- 滚动区 ---------- */
.pet-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
}

.pet-body:focus {
  outline: none;
}

.pet-content {
  display: flex;
  flex-direction: column;
  gap: 16px;
  width: 100%;
  max-width: 1060px;
  margin: 0 auto;
  padding: 18px 20px 26px;
}

.pet-home,
.pet-album,
.pet-shop,
.pet-solar {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* ---------- 通用控件 ---------- */
.pet-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 42px;
  padding: 0 18px;
  border: 1px solid var(--pet-line);
  border-radius: 11px;
  background: #fff;
  color: var(--pet-ink);
  font-size: 13.5px;
  font-weight: 800;
  line-height: 1.2;
  text-align: center;
  cursor: pointer;
  transition:
    filter 0.16s ease,
    transform 0.12s ease;
}

.pet-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.pet-button:not(:disabled):active {
  transform: translateY(1px);
}

.pet-button--small {
  min-height: 34px;
  padding: 0 13px;
  border-radius: 9px;
  font-size: 12.5px;
}

.pet-button--primary {
  border-color: #c1873a;
  background: linear-gradient(180deg, #e2ac60, #cf9243);
  color: #fff;
  box-shadow: 0 6px 16px rgba(197, 139, 63, 0.26);
}

.pet-button--block {
  width: 100%;
}

.pet-button .i-carbon-arrow-right {
  width: 15px;
  height: 15px;
}

.pet-chip {
  display: inline-flex;
  align-items: center;
  height: 24px;
  padding: 0 10px;
  border: 1px solid var(--pet-line);
  border-radius: 999px;
  background: #fff;
  color: var(--pet-ink-2);
  font-size: 11.5px;
  font-weight: 800;
  white-space: nowrap;
}

.pet-chip--gold {
  border-color: #eedcae;
  background: #faf1dc;
  color: #8a6520;
}

.pet-chip--blue {
  border-color: #cfe2ee;
  background: var(--ui-blue-soft);
  color: #3f6d8a;
}

.pet-note {
  margin: 0;
  font-size: 12px;
  color: var(--pet-muted);
}

.pet-note--warning {
  color: #a9762c;
  font-weight: 700;
}

.pet-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin: 0;
  padding: 14px;
  border: 1px dashed var(--pet-line-strong);
  border-radius: 12px;
  color: var(--pet-muted);
  font-size: 12.5px;
  text-align: center;
}

.pet-empty--inline {
  border-style: none;
  padding: 10px;
}

.pet-empty--tall {
  flex: 1;
  flex-direction: column;
  min-height: 240px;
  border-color: transparent;
  font-size: 13px;
}

.pet-empty--tall strong {
  color: var(--pet-ink-2);
}

/* ---------- 卡片与网格 ---------- */
.pet-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 16px;
  align-items: start;
}

.pet-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px;
  border: 1px solid var(--pet-line);
  border-radius: 14px;
  background: #fff;
}

.pet-card--wide {
  grid-column: 1 / -1;
}

.pet-card__head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  font-size: 14.5px;
  font-weight: 800;
  line-height: 1.35;
}

.pet-card__head > svg,
.pet-card__head > .pet-paw {
  width: 18px;
  height: 18px;
  flex: none;
  color: var(--pet-accent-deep);
}

.pet-card__head > span:not(.pet-card__toggle) {
  min-width: 0;
}

.pet-card__head small {
  margin-left: auto;
  padding: 2px 9px;
  border-radius: 999px;
  background: var(--pet-paper-2);
  color: var(--pet-muted);
  font-size: 11px;
  font-weight: 800;
  white-space: nowrap;
}

.pet-card__toggle {
  width: 16px;
  height: 16px;
  flex: none;
  margin-left: auto;
  color: var(--pet-muted);
  transition: transform 0.18s ease;
}

.pet-card__head small + .pet-card__toggle {
  margin-left: 0;
}

.pet-card summary.pet-card__head {
  cursor: pointer;
  list-style: none;
}

.pet-card summary.pet-card__head::-webkit-details-marker {
  display: none;
}

.pet-card[open] > summary .pet-card__toggle {
  transform: rotate(180deg);
}

.pet-card__text {
  margin: 0;
  font-size: 12.5px;
  line-height: 1.75;
  color: var(--pet-ink-2);
}

.pet-card > .pet-button:last-child {
  margin-top: auto;
}

/* ---------- 奖励格 ---------- */
.pet-rewards {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin: 2px 0;
}

.pet-reward {
  position: relative;
  display: grid;
  width: 96px;
  min-height: 86px;
  grid-template-rows: 38px auto auto;
  place-items: center;
  gap: 2px;
  padding: 8px 6px;
  border: 1px solid var(--pet-line);
  border-radius: 12px;
  background: var(--pet-paper-2);
  text-align: center;
}

.pet-reward img {
  width: 38px;
  height: 38px;
  object-fit: contain;
}

.pet-reward strong {
  font-size: 12px;
  font-weight: 800;
  color: var(--pet-ink);
}

.pet-reward small {
  overflow: hidden;
  width: 100%;
  font-size: 11px;
  line-height: 1.35;
  color: var(--pet-muted);
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* ---------- 比熊之家 ---------- */
.pet-hero {
  position: relative;
  display: grid;
  grid-template-columns: 216px minmax(0, 1fr);
  gap: 18px;
  padding: 18px;
  overflow: hidden;
  border: 1px solid var(--pet-line);
  border-radius: 16px;
  background: linear-gradient(135deg, #fff9ee, #fdf2de 58%, #fbf7ef);
}

.pet-hero::after {
  position: absolute;
  top: -90px;
  right: -70px;
  width: 260px;
  height: 260px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(213, 154, 79, 0.17), rgba(213, 154, 79, 0) 70%);
  content: '';
  pointer-events: none;
}

.pet-hero__art {
  display: grid;
  min-height: 196px;
  place-items: center;
  border-radius: 14px;
  background: radial-gradient(circle at 50% 46%, #fff 56%, rgba(255, 255, 255, 0) 76%);
}

.pet-hero__art > svg {
  width: 186px;
  height: 186px;
  filter: drop-shadow(0 14px 16px rgba(150, 110, 50, 0.18));
}

.pet-hero__main {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}

.pet-hero__head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.pet-hero__head h2 {
  margin: 0;
  font-size: 21px;
  font-weight: 800;
  line-height: 1.25;
}

.pet-quote {
  margin: 0;
  padding: 9px 14px;
  border: 1px solid var(--pet-line-soft);
  border-radius: 12px 12px 12px 4px;
  background: #fff;
  font-size: 13px;
  color: var(--pet-ink-2);
}

.pet-growth__top {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 6px;
  font-size: 12px;
  font-weight: 800;
  color: var(--pet-muted);
}

.pet-growth__top b {
  color: var(--pet-accent-deep);
  font-variant-numeric: tabular-nums;
}

.pet-growth progress {
  display: block;
  width: 100%;
  height: 10px;
  border: 0;
  border-radius: 999px;
  background: #f0e6d4;
  overflow: hidden;
  appearance: none;
}

.pet-growth progress::-webkit-progress-bar {
  border-radius: 999px;
  background: #f0e6d4;
}

.pet-growth progress::-webkit-progress-value {
  border-radius: 999px;
  background: linear-gradient(90deg, #e9b767, #d59a4f);
}

.pet-growth progress::-moz-progress-bar {
  border-radius: 999px;
  background: linear-gradient(90deg, #e9b767, #d59a4f);
}

.pet-care {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  margin-top: 4px;
}

.pet-cost {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
  font-weight: 800;
  color: var(--pet-ink-2);
  font-variant-numeric: tabular-nums;
}

.pet-cost img {
  width: 26px;
  height: 26px;
  padding: 2px;
  border: 1px solid #eedcbb;
  border-radius: 50%;
  background: var(--pet-accent-soft);
  object-fit: contain;
}

.pet-quick {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 2px;
}

.pet-quick__item {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-height: 32px;
  padding: 0 12px;
  border: 1px solid transparent;
  border-radius: 999px;
  background: var(--ui-primary-soft);
  color: var(--ui-primary);
  font-size: 12px;
  font-weight: 800;
  cursor: pointer;
}

.pet-quick__item:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.pet-quick__item > svg,
.pet-quick__item > .pet-paw {
  width: 14px;
  height: 14px;
  flex: none;
}

.pet-quick__item em {
  padding: 1px 7px;
  border-radius: 999px;
  background: #fff;
  color: var(--pet-accent-deep);
  font-size: 10.5px;
  font-style: normal;
  font-weight: 800;
}

/* ---------- 今日锦囊 ---------- */
.pet-charm {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid var(--pet-line-soft);
  border-radius: 12px;
  background: var(--pet-paper);
}

.pet-charm > img {
  width: 44px;
  height: 44px;
  flex: none;
  border: 1px solid var(--pet-line);
  border-radius: 12px;
  background: var(--pet-paper-2);
  object-fit: contain;
}

.pet-charm > div {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
}

.pet-charm strong {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 800;
  line-height: 1.4;
}

.pet-charm strong small {
  padding: 1px 8px;
  border-radius: 999px;
  background: var(--ui-primary-soft, #e4f1e7);
  color: var(--ui-primary, #438d63);
  font-size: 10.5px;
  font-weight: 800;
  line-height: 1.7;
}

.pet-charm p {
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--pet-ink-2);
}

.pet-charm > div > span {
  font-size: 11.5px;
  color: var(--pet-muted);
}

/* ---------- 好友夺宝 ---------- */
.pet-steal {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}

.pet-steal select {
  flex: 1 1 180px;
  min-width: 0;
  height: 38px;
  padding: 0 10px;
  border: 1px solid var(--pet-line);
  border-radius: 10px;
  background: #fff;
  color: var(--pet-ink);
  font-size: 12.5px;
}

.pet-steal__list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 4px;
}

.pet-steal__treasure {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border: 1px solid var(--pet-line-soft);
  border-radius: 12px;
  background: var(--pet-paper);
}

.pet-steal__treasure > header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 12.5px;
  color: var(--pet-muted);
}

.pet-steal__treasure > header strong {
  color: var(--pet-ink);
  font-size: 13px;
}

.pet-steal__preview {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
  padding: 8px 10px;
  border-radius: 10px;
  background: var(--pet-paper-2);
  font-size: 12px;
  color: var(--pet-ink-2);
}

.pet-steal__preview .pet-button {
  margin-left: auto;
}
/* ---------- 爪印手记 ---------- */
.pet-album__head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.pet-album__head h2 {
  margin: 0;
  font-size: 19px;
  font-weight: 800;
}

.pet-album__head p {
  margin: 2px 0 0;
  font-size: 12.5px;
  color: var(--pet-muted);
}

.pet-album__bar {
  height: 8px;
  overflow: hidden;
  border-radius: 999px;
  background: #f0e6d4;
}

.pet-album__bar i {
  display: block;
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(90deg, #e9b767, #d59a4f);
  transition: width 0.3s ease;
}

.pet-album__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 16px;
}

.pet-photo {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 10px 12px;
  border: 1px solid var(--pet-line);
  border-radius: 12px;
  background: #fff;
  box-shadow: 0 8px 16px rgba(120, 100, 60, 0.07);
  transition:
    transform 0.18s ease,
    box-shadow 0.18s ease;
}

.pet-photo:hover {
  transform: translateY(-3px);
  box-shadow: 0 14px 24px rgba(120, 100, 60, 0.12);
}

.pet-photo__frame {
  position: relative;
  display: grid;
  aspect-ratio: 539 / 774;
  place-items: center;
  overflow: hidden;
  border-radius: 8px;
  background: var(--pet-paper-2);
}

.pet-photo__frame img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.pet-photo__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  color: #c3b8a4;
}

.pet-photo__empty > svg,
.pet-photo__empty > .pet-paw {
  width: 28px;
  height: 28px;
}

.pet-photo__empty small {
  font-size: 11.5px;
  font-weight: 700;
}

.pet-photo__body {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 4px;
  text-align: center;
}

.pet-photo__body strong {
  font-size: 13px;
  font-weight: 800;
}

.pet-photo--locked {
  border-style: dashed;
  border-color: var(--pet-line-strong);
  background: #faf8f3;
  box-shadow: none;
}

.pet-photo--locked:hover {
  transform: none;
  box-shadow: none;
}

.pet-photo--locked .pet-photo__frame {
  background: #f3efe7;
}

/* ---------- 拾物小铺 ---------- */
.pet-notice {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  padding: 11px 14px;
  border: 1px solid #eedcbb;
  border-radius: 12px;
  background: var(--pet-accent-soft);
  color: #8a6520;
  font-size: 12.5px;
  font-weight: 700;
}

.pet-notice > svg,
.pet-notice > .pet-paw {
  width: 17px;
  height: 17px;
  flex: none;
}

.pet-goods {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 14px;
}

.pet-goods__item {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 14px 10px;
  border: 1px solid var(--pet-line);
  border-radius: 12px;
  background: #fff;
  color: var(--pet-ink);
  cursor: pointer;
  transition:
    transform 0.16s ease,
    box-shadow 0.16s ease;
}

.pet-goods__item:hover {
  transform: translateY(-2px);
  box-shadow: 0 10px 20px rgba(120, 100, 60, 0.1);
}

.pet-goods__thumb {
  display: grid;
  width: 72px;
  height: 72px;
  place-items: center;
  border: 1px solid #eedcae;
  border-radius: 12px;
  background: linear-gradient(160deg, #fdf6e6, #f7ebd5);
}

.pet-goods__thumb img {
  width: 46px;
  height: 46px;
  object-fit: contain;
}

.pet-goods__item strong {
  font-size: 12.5px;
  font-weight: 800;
  line-height: 1.4;
  text-align: center;
}

.pet-goods__price {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 4px 10px;
  font-size: 11.5px;
  font-weight: 800;
  color: var(--pet-accent-deep);
  font-variant-numeric: tabular-nums;
}

.pet-goods__price span {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.pet-goods__price img {
  width: 16px;
  height: 16px;
  object-fit: contain;
}

.pet-goods__sold {
  position: absolute;
  top: 8px;
  right: 8px;
  padding: 2px 8px;
  border-radius: 999px;
  background: #f1eee8;
  color: var(--pet-muted);
  font-size: 10.5px;
  font-weight: 800;
}

.pet-goods__item--sold {
  filter: grayscale(0.85);
  opacity: 0.7;
}

/* ---------- 节令小礼 ---------- */
.pet-terms {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.pet-terms button {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 34px;
  padding: 0 15px;
  border: 1px solid var(--pet-line);
  border-radius: 999px;
  background: #fff;
  color: var(--pet-ink-2);
  font-size: 12.5px;
  font-weight: 800;
  cursor: pointer;
}

.pet-terms button.is-active {
  border-color: #c1873a;
  background: var(--pet-accent-soft);
  color: var(--pet-accent-deep);
}

.pet-terms button.is-locked {
  opacity: 0.6;
}

.pet-terms button .i-carbon-locked {
  width: 13px;
  height: 13px;
}

.pet-solar__card {
  display: grid;
  grid-template-columns: 340px minmax(0, 1fr);
  gap: 20px;
  padding: 18px;
  border: 1px solid var(--pet-line);
  border-radius: 16px;
  background: #fff;
}

.pet-scene {
  border: 1px solid var(--pet-line-soft);
}

.pet-solar__info {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}

.pet-solar__info h2 {
  margin: 0;
  font-size: 18px;
  font-weight: 800;
}

.pet-solar__info .pet-button {
  align-self: flex-start;
  margin-top: auto;
}
/* ---------- 底部栏目 ---------- */
.pet-nav {
  flex: none;
  padding: 6px 10px;
  border-top: 1px solid var(--pet-line-soft);
  background: #fff;
}

.pet-nav__inner {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 6px;
  max-width: 560px;
  margin: 0 auto;
}

.pet-nav__inner > button {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  height: 52px;
  min-height: 52px;
  padding: 0 4px;
  border: 0;
  border-radius: 11px;
  background: transparent;
  color: var(--pet-muted);
  font-size: 11.5px;
  font-weight: 800;
  line-height: 1.2;
  white-space: nowrap;
  cursor: pointer;
  transition:
    background-color 0.16s ease,
    color 0.16s ease;
}

.pet-nav__inner > button.is-active {
  background: var(--pet-accent-soft);
  color: var(--pet-accent-deep);
}

.pet-nav__icon {
  display: block;
  width: 21px;
  height: 21px;
  flex: none;
}

.pet-nav__badge {
  position: absolute;
  top: 9px;
  left: 50%;
  width: 7px;
  height: 7px;
  margin-left: 8px;
  border-radius: 50%;
  background: var(--ui-danger);
}

/* ---------- 弹窗 ---------- */
.pet-dialog {
  width: min(480px, calc(100vw - 28px));
  max-height: min(86vh, 720px);
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

.pet-dialog[open] {
  display: flex;
  flex-direction: column;
}

.pet-dialog::backdrop {
  background: rgba(38, 32, 24, 0.45);
  backdrop-filter: blur(2px);
}

.pet-dialog__head {
  display: flex;
  flex: none;
  align-items: center;
  gap: 10px;
  height: 54px;
  padding: 0 12px 0 18px;
  border-bottom: 1px solid var(--pet-line-soft);
  background: var(--pet-paper);
}

.pet-dialog__head h2 {
  flex: 1;
  min-width: 0;
  margin: 0;
  overflow: hidden;
  font-size: 15.5px;
  font-weight: 800;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pet-dialog__close {
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

.pet-dialog__close svg {
  width: 15px;
  height: 15px;
  fill: none;
  stroke: currentcolor;
  stroke-width: 2;
  stroke-linecap: round;
}

.pet-dialog__body {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 12px;
  min-height: 0;
  overflow-y: auto;
  padding: 16px 18px 20px;
}

.pet-dialog__product {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  border: 1px solid var(--pet-line-soft);
  border-radius: 12px;
  background: var(--pet-paper-2);
}

.pet-dialog__product img {
  width: 56px;
  height: 56px;
  flex: none;
  border-radius: 10px;
  object-fit: contain;
  background: #fff;
}

.pet-dialog__product div {
  min-width: 0;
}

.pet-dialog__product h3 {
  margin: 0;
  font-size: 14.5px;
  font-weight: 800;
}

.pet-dialog__product p {
  margin: 2px 0 0;
  font-size: 12px;
  color: var(--pet-ink-2);
}

.pet-field {
  font-size: 12.5px;
  font-weight: 800;
  color: var(--pet-ink-2);
}

.pet-quantity {
  display: flex;
  align-items: center;
  gap: 8px;
}

.pet-quantity button {
  flex: none;
  min-width: 38px;
  height: 38px;
  padding: 0 12px;
  border: 1px solid var(--pet-line);
  border-radius: 10px;
  background: #fff;
  color: var(--pet-ink);
  font-size: 14px;
  font-weight: 800;
  cursor: pointer;
}

.pet-quantity button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.pet-quantity input {
  flex: 1 1 auto;
  width: 100%;
  min-width: 0;
  height: 38px;
  padding: 0 10px;
  border: 1px solid var(--pet-line);
  border-radius: 10px;
  background: #fff;
  color: var(--pet-ink);
  font-size: 14px;
  font-weight: 800;
  text-align: center;
  font-variant-numeric: tabular-nums;
}

.pet-costs {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.pet-costs span {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 30px;
  padding: 0 10px;
  border: 1px solid #eedcbb;
  border-radius: 999px;
  background: var(--pet-accent-soft);
  color: #8a6520;
  font-size: 12.5px;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}

.pet-costs img {
  width: 18px;
  height: 18px;
  object-fit: contain;
}

.pet-log__tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.pet-log {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px 12px;
  border: 1px solid var(--pet-line-soft);
  border-radius: 10px;
  background: var(--pet-paper);
  font-size: 12.5px;
}

.pet-log time {
  font-size: 11.5px;
  color: var(--pet-muted);
  font-variant-numeric: tabular-nums;
}

.pet-log span {
  color: var(--pet-ink-2);
}

.pet-log strong {
  color: var(--pet-accent-deep);
}
/* ---------- 响应式 ---------- */
@media (max-width: 1023px) {
  .pet-hero {
    grid-template-columns: minmax(0, 1fr);
    gap: 12px;
  }

  .pet-hero__art {
    min-height: 170px;
  }

  .pet-hero__art > svg {
    width: 160px;
    height: 160px;
  }

  .pet-solar__card {
    grid-template-columns: minmax(0, 1fr);
    gap: 14px;
  }
}

@media (max-width: 720px) {
  .pet-content {
    padding: 14px 14px 20px;
  }

  .pet-album__grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
  }

  .pet-goods {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
  }

  .pet-hero {
    padding: 15px;
  }

  .pet-hero__art {
    min-height: 152px;
  }

  .pet-hero__art > svg {
    width: 144px;
    height: 144px;
  }

  .pet-hero__head h2 {
    font-size: 19px;
  }

  .pet-care .pet-button {
    flex: 1 1 100%;
  }

  .pet-steal select {
    flex: 1 1 100%;
  }

  .pet-steal__preview .pet-button {
    margin-left: 0;
  }

  .pet-nav {
    padding: 4px 6px;
  }

  .pet-nav__inner {
    gap: 4px;
  }

  .pet-nav__inner > button {
    height: 44px;
    min-height: 44px;
    gap: 2px;
    border-radius: 10px;
    font-size: 11px;
  }

  .pet-nav__icon {
    width: 18px;
    height: 18px;
  }

  .pet-nav__badge {
    top: 7px;
    margin-left: 6px;
  }
}

@media (max-width: 520px) {
  .pet-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .pet-dialog__body {
    padding: 14px 14px 18px;
  }

  .pet-quantity {
    flex-wrap: wrap;
  }

  .pet-quantity input {
    flex: 1 1 72px;
  }

  .pet-quantity button:last-child {
    flex: 1 1 100%;
  }
}

@media (max-width: 420px) {
  .pet-header {
    gap: 6px;
    padding: 0 10px;
  }

  .pet-header__brand {
    gap: 8px;
  }

  .pet-title small {
    display: none;
  }

  .pet-title h1 {
    font-size: 16px;
  }

  .pet-back {
    justify-content: center;
    width: 34px;
    padding: 0;
  }

  .pet-back__text {
    display: none;
  }

  .pet-countdown {
    height: 30px;
    padding: 0 9px;
    font-size: 11.5px;
  }

  .pet-countdown__label {
    display: none;
  }

  .pet-wallet-menu > summary {
    height: 30px;
  }

  .pet-nav__inner {
    gap: 4px;
  }

  .pet-reward {
    width: 88px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .pet-diary * {
    transition-duration: 0.01ms !important;
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
  }
}

.pet-empty--tall .activity-spinner {
  flex: none;
}
</style>
