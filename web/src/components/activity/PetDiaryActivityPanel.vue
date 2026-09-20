<script setup lang="ts">
import type { PetItem } from '@/stores/pet-diary'
import { storeToRefs } from 'pinia'
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useAccountStore } from '@/stores/account'
import { useFriendStore } from '@/stores/friend'
import { usePetDiaryStore } from '@/stores/pet-diary'
import PetTreasurePanel from './PetTreasurePanel.vue'

const emit = defineEmits<{ back: [] }>()
const router = useRouter()
const accountStore = useAccountStore()
const friends = useFriendStore()
const diary = usePetDiaryStore()
const { activity: pet, pending, error, readError, notice, stale, records, plunderRecords, friend } = storeToRefs(diary)
const tab = ref('home')
const friendId = ref('')
const friendPicker = ref<HTMLDetailsElement | null>(null)
const friendCacheError = ref('')
const avatarErrors = ref<Record<string, boolean>>({})
const selectedFriend = computed(() => friends.friends.find(f => String(f.gid) === friendId.value))
function friendAvatar(f: any) {
  if (!f || avatarErrors.value[String(f.gid)])
    return ''
  return String(f.avatarUrl || f.avatar_url || (f.uin ? `https://q1.qlogo.cn/g?b=qq&nk=${f.uin}&s=100` : ''))
}
function closeFriendPicker(event: FocusEvent) {
  if (!(event.relatedTarget instanceof Node) || !friendPicker.value?.contains(event.relatedTarget))
    friendPicker.value?.removeAttribute('open')
}
function selectFriend(gid: string) {
  friendId.value = gid
  friendPicker.value?.removeAttribute('open')
}

const logKind = ref<'interact' | 'plunder'>('interact')
const recordEntries = computed(() => logKind.value === 'plunder' ? plunderRecords.value : records.value)
const treasurePanel = ref<InstanceType<typeof PetTreasurePanel> | null>(null)
const quantities = ref<Record<string, number>>({})
const scrollViewport = ref<HTMLElement | null>(null)
const walletMenu = ref<HTMLDetailsElement | null>(null)
const recordDialog = ref<HTMLDialogElement | null>(null)
const rulesDialog = ref<HTMLDialogElement | null>(null)
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
  { id: 'home', label: '比熊之家', icon: 0 },
  { id: 'stories', label: '爪印手记', icon: 1 },
  { id: 'shop', label: '拾物小铺', icon: 2 },
  { id: 'solar', label: '节令小礼', icon: 3 },
]
const art = (file: string) => `/activity/pet-diary/${file}.png`
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
const seedRewards = computed(() => pet.value?.seeds.days.find(d => d.claimable && !d.claimed)?.rewards || pet.value?.seeds.days[0]?.rewards || [])
const claimableTreasures = computed(() => pet.value?.treasures.some(t => t.status === 3 || (t.status === 2 && t.endTime > 0 && t.endTime <= now.value)))
const escortingCount = computed(() => pet.value?.treasures.filter(t => t.status === 2 && t.endTime > now.value).length || 0)
const homeTreasures = computed(() => [...(pet.value?.treasures || [])].sort((a, b) => a.createdTime - b.createdTime))
const treasureImage = '/game-config/seed_images_named/1030_%E5%BE%85%E6%8A%A4%E9%80%81%E5%AE%9D%E8%97%8F.png'
const luckyStars = computed(() => pet.value?.balances.find(item => item.id === '1029'))
const activityRemaining = computed(() => {
  const hours = Math.max(0, Math.ceil(((pet.value?.endTime || 0) - now.value) / 3600000))
  return pet.value?.active ? `剩余：${Math.floor(hours / 24)}天${hours % 24}时` : '活动已结束'
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
function treasureStatus(status: number, endTime: number) {
  if (status === 3 || (status === 2 && endTime > 0 && endTime <= now.value))
    return '待领取'
  if (status === 2)
    return `护送中 · 剩余 ${remaining(endTime)}`
  if (status === 1)
    return '待护送 · 正在排队'
  if (status === 4)
    return '已领取'
  return '状态待刷新'
}
function accountId() {
  return String(accountStore.currentAccountId || '')
}
function load() {
  return diary.load(accountId())
}
async function loadFriendCache() {
  if (!accountId() || friends.friends.length || friends.loading)
    return
  const owner = accountId()
  friendCacheError.value = ''
  try {
    await friends.fetchFriends(owner, false)
  }
  catch {
    if (owner === accountId())
      friendCacheError.value = '好友列表暂不可用'
  }
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
  friendPicker.value?.removeAttribute('open')
  friendCacheError.value = ''
  avatarErrors.value = {}
  quantities.value = {}
  tab.value = 'home'
  void load()
  void nextTick(loadFriendCache)
}, { immediate: true })
watch(tab, () => {
  diary.clearNotice()
  if (scrollViewport.value)
    scrollViewport.value.scrollTop = 0
  walletMenu.value?.removeAttribute('open')
}, { flush: 'post' })
watch(pet, (value) => {
  if (value) {
    offset.value = value.serverTime - Date.now()
    void loadFriendCache()
  }
})
</script>

<template>
  <section class="pet-diary" :class="`pet-diary--${tab}`" aria-label="萌宠成长日记">
    <div v-if="error || notice || pet?.warnings.length" class="pet-status">
      <div v-if="error" class="pet-message pet-message--error" role="alert">
        {{ error }} <button :disabled="!!pending" @click="load">
          重新刷新
        </button>
      </div>
      <div v-if="notice" class="pet-message" role="status">
        {{ notice }}
      </div>
      <div v-for="warning in pet?.warnings || []" :key="warning" class="pet-message pet-message--warning">
        {{ warning }}
      </div>
    </div>
    <div ref="scrollViewport" class="pet-scroll" tabindex="0" :aria-label="`${tabs.find(entry => entry.id === tab)?.label}内容`">
      <div class="pet-content">
        <header class="pet-header">
          <div class="pet-brand">
            <button class="pet-icon-button" aria-label="返回活动列表" @click="emit('back')">
              <img :src="art('img_s3main_back')" alt="">
            </button>
            <div class="pet-heading">
              <h1><img :src="art('img_s3main_title')" alt="萌宠成长日记"></h1>
              <span v-if="pet" class="pet-countdown" :title="`${date(pet.startTime)} — ${date(pet.endTime)}`"><span class="i-carbon-time" />{{ activityRemaining }}</span>
            </div>
          </div>
          <div class="pet-header-tools">
            <details v-if="pet" ref="walletMenu" class="pet-wallet-menu">
              <summary aria-label="查看活动道具余额" :title="`累计获得 ${pet.hunt.luckyStarTotal} 幸运星`">
                <img :src="luckyStars?.image || '/game-config/seed_images_named/1029_%E5%B9%B8%E8%BF%90%E6%98%9F.png'" alt="幸运星">
                <strong>{{ luckyStars?.known ? Number(luckyStars.count).toLocaleString() : '—' }}</strong><span class="i-carbon-chevron-down" />
              </summary>
              <div class="pet-wallet" aria-label="活动道具余额">
                <div v-for="item in pet.balances" :key="item.id" class="pet-balance">
                  <img :src="item.image" alt=""><span>{{ item.name }}<strong>{{ item.known ? Number(item.count).toLocaleString() : '待刷新' }}</strong></span>
                </div>
                <p>累计获得 {{ pet.hunt.luckyStarTotal }} 幸运星</p>
              </div>
            </details>
            <button v-if="pet" class="pet-button pet-button--small" aria-haspopup="dialog" @click="rulesDialog?.showModal()">
              活动说明
            </button>
            <button class="pet-refresh" :disabled="!!pending" :aria-label="pending === 'load' ? '刷新中' : '刷新活动'" title="刷新活动" @click="load">
              <span class="i-carbon-renew" />
            </button>
          </div>
        </header>
        <div v-if="!accountId()" class="pet-empty pet-empty--initial">
          请先选择账号
        </div>
        <div v-else-if="pending === 'load' && !pet" class="pet-empty pet-empty--initial" role="status">
          <div class="activity-spinner" />加载中…
        </div>
        <template v-if="pet">
          <main v-if="tab === 'home'" class="pet-home">
            <div class="pet-home-top">
              <article class="pet-garden" aria-label="比熊之家">
                <div class="pet-room">
                  <img class="pet-room-scene" :src="`/activity/pet-diary/scene-home-${pet.nurture.adult ? 'adult' : 'puppy'}.webp?v=20260912`" :alt="pet.nurture.adult ? '成年比熊坐在家中的爪印地毯上' : '幼年比熊坐在家中的爪印地毯上'" decoding="async">
                  <div class="pet-dog-plaque">
                    <span class="pet-rarity">
                      <img :src="art(pet.nurture.adult ? 'img_pet_rarity4' : 'img_pet_rarity2')" alt="">
                      <span>{{ pet.nurture.adult ? '天工' : '稀有' }}</span>
                    </span>
                    <h2>比熊犬</h2>
                    <div class="pet-growth">
                      <span>{{ pet.nurture.adult ? '成年期' : '幼年期' }}</span><div><progress :value="pet.nurture.growth" :max="pet.nurture.adultGrowth" :aria-label="`成长进度 ${growthPercent.toFixed(0)}%`" /><b>{{ pet.nurture.adult ? '已达成' : `${pet.nurture.growth} / ${pet.nurture.adultGrowth}` }}</b></div>
                    </div>
                  </div>
                  <div class="pet-speech">
                    <img :src="art(pet.nurture.adult ? 'img_s3BattlePass_chat6' : 'img_s3BattlePass_chat7')" :alt="pet.nurture.adult ? '我长大啦~以后这个家我来看着！' : '把我喂到成年，我就能去农场看家护院啦~'">
                  </div>
                  <div class="pet-room-shortcuts">
                    <button :disabled="!!pending" aria-label="互动记录" @click="showRecords">
                      <img :src="art('img_s3BattlePass_recordBtn')" alt="互动记录">
                    </button>
                  </div>
                  <button v-if="pet.nurture.adult" class="pet-escort-shortcut" aria-label="打开宝藏护送" @click="treasurePanel?.open()">
                    <img :src="art('img_s3Treasure_wait')" alt=""><strong>宝藏护送</strong><span>{{ claimableTreasures ? '奖励可领取' : `护送中：${escortingCount}` }}</span>
                  </button>
                </div>
                <div class="pet-care">
                  <div class="pet-feed-cost">
                    <span v-for="item in pet.nurture.adult ? pet.hunt.costs : pet.nurture.feedCosts" :key="item.id" :title="item.name"><img :src="item.image" :alt="item.name">{{ feedBalance(item) }}</span>
                  </div>
                  <button v-if="!pet.nurture.initialized" class="pet-feed-button" :disabled="busy" @click="diary.operate('initialize')">
                    领养比熊
                  </button>
                  <button v-else-if="!pet.nurture.adult" class="pet-feed-button" :disabled="busy || !pet.nurture.canFeed" @click="diary.operate('feed')">
                    {{ pending === 'feed' ? '投喂中…' : '投喂元气糕' }}
                  </button>
                  <button v-else-if="!pet.nurture.dogGranted" class="pet-feed-button" :disabled="busy" @click="diary.operate('claimDog')">
                    {{ pending === 'claimDog' ? '领取中…' : '领取永久比熊' }}
                  </button>
                  <button v-else class="pet-feed-button" :disabled="busy || !pet.hunt.canDraw" @click="diary.operate('draw')">
                    {{ pending === 'draw' ? '投喂中…' : '投喂元气糕' }}
                  </button>
                  <p class="pet-care-note">
                    {{ pet.nurture.adult ? `今日寻宝 ${pet.hunt.count} / ${pet.hunt.limit}` : `今日投喂 ${pet.nurture.feedCount} / ${pet.nurture.feedLimit}` }}
                  </p>
                  <p v-if="feedHint" class="pet-care-note pet-care-note--warning">
                    {{ feedHint }}
                  </p>
                </div>
              </article>
              <div class="pet-home-dashboard">
                <aside id="pet-seed-gift" class="pet-card pet-gift">
                  <div class="pet-section-title">
                    <img class="pet-gift-art" :src="art('img_s3BattlePass_rewardBox')" alt=""><h2>每日种子赠礼</h2>
                  </div>
                  <p>每日赠送1份免费的稀有种子礼包，每日0点刷新；未领取的礼包可累计保留。</p>
                  <div class="pet-seed-rewards">
                    <div v-for="item in seedRewards" :key="item.id">
                      <img :src="item.image" alt=""><strong>{{ item.name }}</strong><span>× {{ item.count }}</span>
                    </div>
                  </div>
                  <button class="pet-button pet-button--primary" :disabled="busy || !pet.seeds.canClaim" @click="diary.operate('seeds')">
                    {{ pending === 'seeds' ? '领取中…' : pet.seeds.canClaim ? '领取种子礼包' : '今日礼包已领取' }}
                  </button>
                  <div v-if="pet.nurture.adult" class="pet-permanent">
                    <span v-if="pet.nurture.dogGranted">比熊已永久加入你的农场</span>
                    <button v-else class="pet-button" :disabled="busy" @click="diary.operate('claimDog')">
                      领取永久比熊
                    </button>
                  </div>
                </aside>
                <article class="pet-card">
                  <div class="pet-section-title">
                    <h2>宝藏护送</h2><span>护送中 {{ escortingCount }} · 待护送 {{ pet.treasures.filter(t => t.status === 1).length }}</span><button class="pet-button pet-button--small" @click="treasurePanel?.open()">
                      {{ claimableTreasures ? '查看并领取奖励' : '查看宝藏' }}
                    </button>
                  </div><p>{{ pet.nurture.adult ? '查看宝藏价值、被挑战次数、护送日志和待领奖励。待护送宝藏会自动开始护送。' : '将比熊培育至成年后，可通过寻宝获取宝藏并自动护送。' }}</p>
                  <div v-if="!pet.treasures.length" class="pet-empty pet-empty--small">
                    <img :src="treasureImage" alt="">暂无待护送宝藏
                  </div>
                  <article v-for="treasure in homeTreasures" :key="treasure.id" class="pet-treasure">
                    <img :src="treasure.item.image || treasureImage" :alt="treasure.item.name">
                    <div>
                      <strong>{{ treasure.item.name }} ×{{ treasure.item.count }}</strong>
                      <span>{{ treasureStatus(treasure.status, treasure.endTime) }}</span>
                      <b>初始价值 {{ treasure.originalCount }} · 已被挑战 {{ treasure.plunderCount }}/{{ treasure.maxPlunderCount || '不限' }}</b>
                    </div>
                  </article>
                </article>
                <article class="pet-card">
                  <div class="pet-section-title">
                    <h2>今日锦囊</h2><button class="pet-button pet-button--small" @click="treasurePanel?.open('charms')">
                      查看锦囊总览
                    </button>
                  </div><div v-for="charm in pet.charms.equipped" :key="charm.id" class="pet-charm equipped">
                    <img :src="charm.image" alt=""><div><strong>{{ charm.name }} <small>已生效</small></strong><p>{{ charm.description }}</p><span v-if="charm.remaining.length">剩余生效次数：{{ charm.remaining.join(' / ') }}</span></div>
                  </div><p v-if="!pet.charms.equipped.length">
                    {{ pet.nurture.adult ? '进入宝藏护送挑选锦囊。' : '成年后可搭配锦囊参与宝藏护送。' }}
                  </p><small class="pet-muted">{{ pet.charms.refreshNote }}</small>
                </article>
                <article class="pet-card pet-plunder">
                  <div class="pet-section-title">
                    <h2>好友夺宝</h2><span>今日 {{ pet.battleCount }}/{{ pet.battleLimit }}</span>
                  </div><p>消耗一张挑战书参与夺宝，收益与可用挑战书以好友当前宝藏为准。</p><div class="pet-friend-form">
                    <details ref="friendPicker" class="pet-friend-picker" @keydown.esc="friendPicker?.removeAttribute('open')" @focusout="closeFriendPicker">
                      <summary aria-label="选择夺宝好友">
                        <img v-if="friendAvatar(selectedFriend)" :src="friendAvatar(selectedFriend)" alt="" @error="avatarErrors[friendId] = true">
                        <span v-else class="pet-avatar-fallback i-carbon-user-avatar" />
                        <span>{{ selectedFriend?.name || (friendId ? friendId : '选择好友') }}</span><span class="i-carbon-chevron-down" />
                      </summary>
                      <div class="pet-friend-options">
                        <button v-for="f in friends.friends" :key="String(f.gid)" type="button" :aria-pressed="friendId === String(f.gid)" @click="selectFriend(String(f.gid))">
                          <img v-if="friendAvatar(f)" :src="friendAvatar(f)" alt="" loading="lazy" @error="avatarErrors[String(f.gid)] = true">
                          <span v-else class="pet-avatar-fallback i-carbon-user-avatar" /><span>{{ f.name || f.gid }}</span>
                        </button>
                        <p v-if="!friends.friends.length">
                          {{ friends.loading ? '正在加载好友缓存…' : friendCacheError || '暂无好友缓存' }}
                        </p>
                      </div>
                    </details><button class="pet-button pet-button--primary" :disabled="!!pending || !friendId || !pet.hunt.canPlunder" @click="diary.readExtra('friend', friendId)">
                      查看宝藏
                    </button>
                  </div><p v-if="!pet.hunt.canPlunder" class="pet-muted">
                    成年并满足活动条件后开放夺宝；每日最多 {{ pet.battleLimit }} 次。
                  </p><div v-if="friend">
                    <p v-if="!friend.treasures.length">
                      这位好友当前没有可查看的宝藏。
                    </p><article v-for="treasure in friend.treasures" :key="treasure.id" class="pet-friend-treasure">
                      <strong>{{ treasure.item.name }} ×{{ treasure.item.count }}</strong><span>{{ treasure.status === 2 ? remaining(treasure.endTime) : '当前不可夺宝' }}</span><div v-for="preview in treasure.previews" :key="preview.challengeId" class="pet-preview">
                        <span>{{ pet.balances.find(i => i.id === preview.challengeId)?.name || '挑战书' }} ×1</span><span>最高收益 {{ preview.maxProfit.count }} · 最大损失 {{ preview.maxLoss.count }}</span><button class="pet-button pet-button--small" :disabled="busy || !preview.canStart || treasure.status !== 2 || !Number(pet.balances.find(i => i.id === preview.challengeId)?.count)" @click="diary.operate('battle', { gid: friend.gid, treasureId: treasure.id, challengeId: preview.challengeId })">
                          发起夺宝
                        </button>
                      </div>
                    </article>
                  </div>
                </article>
              </div>
            </div>
          </main>
          <main v-else-if="tab === 'stories'" class="pet-story-section" aria-label="爪印手记">
            <div class="pet-page-background" aria-hidden="true">
              <picture>
                <source srcset="/activity/pet-diary/scene-stories-static.webp?v=20260912" media="(prefers-reduced-motion: reduce)" type="image/webp">
                <source srcset="/activity/pet-diary/scene-stories.webp?v=20260910-hd" type="image/webp">
                <img src="/activity/pet-diary/scene-stories-static.webp?v=20260912" alt="" width="1020" height="460" decoding="async">
              </picture>
            </div>
            <div class="pet-paper pet-story-paper">
              <img class="pet-story-title" :src="art('img_s3PhotoWall_titleBg')" alt="多跟比熊互动可以解锁更多照片哦~">
              <div class="pet-section-title">
                <h2>爪印手记</h2><span>已解锁 {{ unlocked }} / {{ pet.stories.length }}</span>
              </div><div class="pet-stories">
                <article v-for="story in pet.stories" :key="story.order" class="pet-story" :class="{ locked: !story.unlocked }">
                  <div class="pet-photo">
                    <img v-if="story.unlocked && story.photo" :src="story.photo" :alt="`第 ${story.order} 则手记照片`" loading="lazy" decoding="async"><img v-else class="pet-photo-placeholder" :src="art('img_s3PhotoWall_emptyBg')" :alt="`第 ${story.order} 则手记尚未解锁`" loading="lazy" decoding="async">
                  </div><img v-if="story.unlocked" class="pet-photo-pin" :src="art('img_s3PhotoWall_ding')" alt=""><img v-if="story.unlocked && story.captionImage" class="pet-caption" :src="story.captionImage" alt="比熊成长手记"><p v-else-if="story.unlocked && story.caption">
                    {{ story.caption }}
                  </p><button v-if="story.unlocked" class="pet-button pet-story-claim" :disabled="busy || story.claimed" @click="diary.operate('story', { order: story.order })">
                    <img v-if="!story.claimed" :src="art('img_s3PhotoWall_getBtn')" alt="">{{ story.claimed ? '已领取' : '领取奖励' }}
                  </button>
                </article>
              </div>
            </div>
          </main>

          <main v-else-if="tab === 'shop'" class="pet-shop" aria-label="拾物小铺">
            <div class="pet-page-background" aria-hidden="true">
              <picture>
                <source srcset="/activity/pet-diary/scene-shop-static.webp?v=20260912" media="(prefers-reduced-motion: reduce)" type="image/webp">
                <source srcset="/activity/pet-diary/scene-shop.webp?v=20260910-hd" type="image/webp">
                <img src="/activity/pet-diary/scene-shop-static.webp?v=20260912" alt="" width="1020" height="450" decoding="async">
              </picture>
            </div>
            <div class="pet-paper pet-shop-paper">
              <h2 class="pet-shop-caption">
                收集幸运星，可兑换游记限定奖励
              </h2>
              <div v-if="!pet.shop.length" class="pet-empty">
                小铺目录暂未加载，请刷新重试。
              </div>
              <div class="pet-goods">
                <button v-for="goods in pet.shop" :key="goods.id" class="pet-product" :class="{ 'pet-product--gold': goods.id === '50', 'pet-product--sold': goods.remaining === '0' }" :aria-label="`查看${goods.name}兑换信息`" @click="openExchange(goods.id)">
                  <span class="pet-product-image"><img :src="goods.image" :alt="goods.name" loading="lazy"></span>
                  <strong class="pet-product-name">{{ goods.name }}</strong>
                  <span class="pet-price"><span v-for="cost in goods.costs" :key="cost.id"><img :src="cost.image" :alt="cost.name">{{ Number(cost.count).toLocaleString() }}</span></span>
                  <span v-if="goods.remaining === '0'" class="pet-product-sold">已兑完</span>
                </button>
              </div>
            </div>
          </main>
          <main v-else class="pet-solar" aria-label="节令小礼">
            <div v-if="!currentTerm" class="pet-empty pet-empty--initial">
              节令数据暂未加载，请刷新重试。
            </div>
            <template v-else>
              <div class="pet-solar-scene" :class="{ 'pet-solar-scene--bailu': currentTerm.name.includes('白露') }">
                <template v-if="currentTerm.name.includes('白露')">
                  <picture>
                    <source srcset="/activity/pet-diary/scene-bailu-static.webp?v=20260912" type="image/webp">
                    <img class="pet-solar-landscape" src="/activity/pet-diary/scene-bailu-static.webp?v=20260912" alt="白露节气，小童在芦苇水塘中用荷叶接露水" decoding="async">
                  </picture>
                  <div class="pet-solar-lettering">
                    <img :src="art('img_S3Jieqi_title_bailu_trim')" alt="白露"><img :src="art('img_S3Jieqi_txt_bailu_trim')" alt="白露节令题诗">
                  </div>
                </template>
                <div v-else class="pet-solar-upcoming">
                  <h2>{{ currentTerm.name }}</h2><p>{{ date(Number(currentTerm.startTime) * 1000) }} 开启</p>
                </div>
                <div class="pet-term-tabs" aria-label="选择节令">
                  <button v-for="term in pet.solarTerms?.terms || []" :key="term.id" :class="{ selected: currentTerm.id === term.id }" :aria-pressed="currentTerm.id === term.id" @click="selectedTermId = term.id">
                    {{ term.name }}<span v-if="term.statusCode === '1'" class="i-carbon-locked" />
                  </button>
                </div>
              </div>
              <div class="pet-solar-gift">
                <div><h2>{{ currentTerm.name }} · 节令赠礼</h2><p>{{ date(Number(currentTerm.startTime) * 1000) }} — {{ date(Number(currentTerm.endTime) * 1000) }}</p></div>
                <div class="pet-inline-rewards">
                  <span v-for="item in currentTerm.rewards" :key="item.id"><img :src="item.image" alt="">{{ item.name }} ×{{ item.count }}</span>
                </div>
                <button class="pet-button pet-button--primary" :disabled="busy || !currentTerm.canClaim" @click="diary.operate('solar', { termId: currentTerm.id })">
                  {{ pending === 'solar' ? '领取中…' : currentTerm.canClaim ? '领取节令好礼' : currentTerm.statusCode === '3' ? '已领取' : '未到领取时间' }}
                </button>
              </div>
            </template>
          </main>
        </template>
      </div>
    </div>
    <nav v-if="pet" class="pet-tabs" aria-label="活动栏目">
      <button v-for="entry in tabs" :key="entry.id" :class="{ selected: tab === entry.id }" :aria-label="entry.label" :aria-current="tab === entry.id ? 'page' : undefined" @click="tab = entry.id">
        <img :src="art(`img_s3main_icon${tab === entry.id ? 'Select' : ''}${entry.icon}`)" alt=""><i v-if="entry.id === 'stories' && pet.stories.some(story => story.unlocked && !story.claimed)" />
      </button>
    </nav>
    <dialog ref="rulesDialog" class="pet-exchange-dialog pet-record-dialog" aria-labelledby="pet-rules-title" @click.self="rulesDialog?.close()">
      <header>
        <h2 id="pet-rules-title">
          活动说明
        </h2>
        <button class="pet-dialog-close" aria-label="关闭活动说明" @click="rulesDialog?.close()">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6" /></svg>
        </button>
      </header>
      <div class="pet-dialog-body">
        <p v-for="(rule, index) in pet?.rules || []" :key="index">
          {{ rule }}
        </p>
        <div class="pet-grow-tip">
          <strong>萌宠元气糕</strong><p>幼年期投喂元气糕提升成长值；成年后继续消耗元气糕互动寻宝，获得宝藏后会自动开始护送。</p><p>收获活动稀有作物可获得元气糕，经验种子和金币种子无法产出。</p><button class="pet-text-button" @click="router.push('/personal')">
            前往农场种植 <span class="i-carbon-arrow-right" />
          </button>
        </div>
      </div>
    </dialog>
    <dialog ref="exchangeDialog" class="pet-exchange-dialog" aria-labelledby="pet-exchange-title" @close="selectedGoodsId = ''" @click.self="exchangeDialog?.close()">
      <header>
        <h2 id="pet-exchange-title">
          兑换
        </h2><button class="pet-dialog-close" aria-label="关闭兑换窗口" @click="exchangeDialog?.close()">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6" /></svg>
        </button>
      </header>
      <div v-if="exchangeItem" class="pet-dialog-body">
        <div class="pet-exchange-product">
          <img :src="exchangeItem.image" :alt="exchangeItem.name"><div><h3>{{ exchangeItem.name }}</h3><p>{{ itemText(exchangeItem.rewards) }}</p></div>
        </div>
        <label class="pet-quantity-label" for="pet-exchange-quantity">兑换数量</label>
        <div class="pet-quantity">
          <button :disabled="!!pending || exchangeQuantity <= 1" aria-label="减少兑换数量" @click="exchangeQuantity = Math.max(1, (Number(exchangeQuantity) || 1) - 1)">
            −
          </button><input id="pet-exchange-quantity" v-model.number="exchangeQuantity" type="number" inputmode="numeric" min="1" :max="exchangeLimit" :disabled="!!pending"><button :disabled="!!pending || exchangeQuantity >= exchangeLimit" aria-label="增加兑换数量" @click="exchangeQuantity = Math.min(exchangeLimit, (Number(exchangeQuantity) || 0) + 1)">
            +
          </button><button :disabled="!!pending || !affordableQuantity" @click="exchangeQuantity = affordableQuantity">
            最大
          </button>
        </div>
        <p class="pet-exchange-limit">
          {{ exchangeItem.remaining === null ? '不限量' : `剩余可兑：${exchangeItem.remaining} / ${exchangeItem.limit}` }}
        </p>
        <div class="pet-exchange-cost" aria-live="polite">
          <span v-for="cost in exchangeCosts" :key="cost.id"><img :src="cost.image" :alt="cost.name">{{ Number(cost.count).toLocaleString() }}</span>
        </div>
        <p v-if="exchangeHint" class="pet-exchange-hint" role="status">
          {{ exchangeHint }}
        </p>
        <p v-if="error" class="pet-message pet-message--error" role="alert">
          {{ error }}
        </p>
        <button class="pet-button pet-button--primary pet-exchange-submit" :disabled="!canExchange" @click="submitExchange">
          {{ pending === 'exchange' ? '兑换中…' : '兑换' }}
        </button>
      </div>
    </dialog>
    <dialog ref="recordDialog" class="pet-exchange-dialog pet-record-dialog" aria-labelledby="pet-record-title" @click.self="recordDialog?.close()">
      <header>
        <h2 id="pet-record-title">
          互动记录
        </h2>
        <button class="pet-dialog-close" aria-label="关闭互动记录" @click="recordDialog?.close()">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6" /></svg>
        </button>
      </header>
      <div class="pet-dialog-body">
        <div class="pet-log-tabs" aria-label="记录类型">
          <button class="pet-button" :class="{ 'pet-button--primary': logKind === 'interact' }" :disabled="!!pending" @click="readLogs('interact')">
            互动记录
          </button>
          <button class="pet-button" :class="{ 'pet-button--primary': logKind === 'plunder' }" :disabled="!!pending" @click="readLogs('plunder')">
            被夺宝记录
          </button>
        </div>
        <p v-if="readError" class="pet-message pet-message--error" role="alert">
          {{ readError }} <button :disabled="!!pending" @click="readLogs(logKind)">
            重试
          </button>
        </p>
        <p v-if="pending === 'interact' || pending === 'plunder'" class="pet-empty pet-empty--small" role="status">
          正在读取记录…
        </p>
        <p v-else-if="!readError && !recordEntries?.length" class="pet-empty pet-empty--small">
          暂无{{ logKind === 'interact' ? '互动' : '被夺宝' }}记录。
        </p>
        <div v-for="(entry, index) in recordEntries" :key="index" class="pet-log">
          <time>{{ time(entry.time) }}</time>
          <template v-if="logKind === 'interact'">
            <span>消耗：{{ itemText(entry.costs) || '无' }}</span><strong>获得：{{ itemText(entry.rewards) || '无道具奖励' }}</strong>
          </template>
          <template v-else>
            <span>{{ entry.name }} · {{ entry.won ? '夺宝成功' : '夺宝失败' }}{{ entry.fake ? ' · 锦囊记录' : '' }}</span><strong>损失 {{ itemText(entry.lost) || '无' }} · 注入 {{ itemText(entry.injected) || '无' }}</strong>
          </template>
        </div>
      </div>
    </dialog>
    <PetTreasurePanel v-if="pet" ref="treasurePanel" :now="now" />
  </section>
</template>

<style scoped>
/*
 * 上游这里是 `:global(.page-scroll:has(> .pet-diary))`，靠 DefaultLayout 的
 * .page-scroll + route.meta.fullBleed 把整页视口交给面板，面板自身只写 flex: 1 1 0。
 * 本地没有 .page-scroll 也没有 fullBleed，且面板是 Activity.vue 里的嵌套子元素，
 * 中间隔着块级容器，flex 链断开 → 高度塌成 0 → 容器查询单位全部失效，
 * 只剩 <nav> 这种有固有高度的普通 flex 项可见（即「只显示四个功能栏」）。
 * 因此改为面板自己声明确定高度，不再依赖父级 flex 上下文。
 * 128px = header 64 + mt-4 16 + 滚动容器 p-6 上下 48。
 */
.pet-diary.pet-diary {
  --pet-ink: #805439;
  --pet-muted: #9c795a;
  --pet-green: #789323;
  --pet-border: #e8cd9b;
  position: relative;
  display: flex;
  height: max(520px, calc(100dvh - 128px));
  flex-direction: column;
  width: 100%;
  max-width: none;
  min-height: 0;
  margin: 0 auto;
  overflow: hidden;
  border: 1px solid #dab57e;
  border-radius: 20px;
  color: var(--pet-ink);
  background: #f8e7be;
  box-shadow: 0 8px 28px #78572b13;
  font-family: 'Microsoft YaHei', 'PingFang SC', sans-serif;
  font-size: 14px;
  line-height: 1.6;
  container-type: inline-size;
}
.pet-diary button,
.pet-diary input,
.pet-diary select {
  font: inherit;
}
.pet-diary button {
  -webkit-tap-highlight-color: transparent;
}
.pet-scroll {
  flex: 1;
  min-height: 0;
  overflow: hidden auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;
  scrollbar-color: #c29b67 transparent;
  container: pet-viewport / size;
}
.pet-content {
  position: relative;
  min-height: 100%;
  padding-bottom: 28px;
  isolation: isolate;
}
.pet-header {
  position: absolute;
  z-index: 4;
  inset: 26px 26px auto;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}
.pet-brand,
.pet-header-tools {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.pet-brand {
  align-items: flex-start;
}
.pet-heading {
  min-width: 0;
}
.pet-heading h1 {
  margin: 0 0 9px;
}
.pet-heading h1 img {
  display: block;
  width: 255px;
  max-width: 100%;
  height: auto;
}
.pet-countdown {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 10px;
  border-radius: 20px;
  background: #665c3bbc;
  color: #fff9dc;
  font-size: 12px;
  font-weight: 700;
}
.pet-icon-button {
  flex: none;
  width: 38px;
  height: 38px;
  display: grid;
  place-items: center;
  padding: 0;
  border: 0;
  background: none;
  cursor: pointer;
}
.pet-icon-button img {
  width: 100%;
  height: auto;
}
.pet-refresh {
  display: grid;
  flex: none;
  place-items: center;
  width: 34px;
  height: 34px;
  padding: 0;
  border: 1px solid #ead1a1;
  border-radius: 50%;
  background: #fff4d9ed;
  color: #996634;
  cursor: pointer;
}
.pet-wallet-menu {
  position: relative;
}
.pet-wallet-menu > summary {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 105px;
  height: 32px;
  padding: 0 9px 0 3px;
  border: 1px solid #edcf99;
  border-radius: 24px;
  background: #fff9e9ed;
  list-style: none;
  cursor: pointer;
  box-shadow: 0 2px 3px #805c3720;
}
.pet-wallet-menu > summary::-webkit-details-marker {
  display: none;
}
.pet-wallet-menu > summary > img {
  width: 37px;
  height: 37px;
  object-fit: contain;
  margin-left: -9px;
}
.pet-wallet-menu > summary > strong {
  flex: 1;
  text-align: right;
  color: #975131;
  font-size: 14px;
  font-variant-numeric: tabular-nums;
}
.pet-wallet-menu > summary > span {
  font-size: 12px;
}
.pet-wallet {
  position: absolute;
  right: 0;
  top: 45px;
  width: 300px;
  max-width: 80cqw;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px 12px;
  padding: 20px;
  border: 2px solid #e6c394;
  border-radius: 18px;
  background: #fff5dfee;
  box-shadow: 0 8px 24px #75492e2b;
  backdrop-filter: blur(12px);
}
.pet-balance {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
}
.pet-balance img {
  width: 34px;
  height: 34px;
  object-fit: contain;
}
.pet-balance strong {
  display: block;
  color: #845130;
  font-size: 17px;
  line-height: 1.3;
}
.pet-wallet p {
  grid-column: 1 / -1;
  margin: 0;
  padding-top: 10px;
  border-top: 1px dashed #e6c394;
  font-size: 11px;
  color: var(--pet-muted);
}
.pet-tabs {
  position: relative;
  z-index: 5;
  flex: none;
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  grid-template-rows: minmax(0, 1fr);
  gap: 4px;
  height: 112px;
  overflow: hidden;
  padding: 0 clamp(10px, 5cqw, 70px);
  background: url('/activity/pet-diary/img_s3main_bg.png') center / 100% 100%;
}
.pet-tabs button {
  position: relative;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  min-width: 0;
  min-height: 0;
  height: 100%;
  padding: 0 0 6px;
  border: 0;
  background: transparent;
  cursor: pointer;
}
.pet-tabs img {
  width: 92px;
  height: 92px;
  object-fit: contain;
  transition: transform 160ms ease;
}
.pet-tabs button.selected img {
  width: 104px;
  height: 104px;
}
.pet-tabs button:hover img {
  transform: translateY(-3px);
}
.pet-tabs i {
  position: absolute;
  top: 15px;
  left: calc(50% + 31px);
  width: 8px;
  height: 8px;
  border: 2px solid #fff3dc;
  border-radius: 50%;
  background: #ef725a;
}
.pet-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  padding: 10px 20px;
  border: 1px solid #dcbb84;
  border-radius: 22px;
  color: #8c6736;
  background: #fff7de;
  box-shadow: 0 2px 0 #c7995d33;
  font-weight: 700;
  line-height: 1.4;
  cursor: pointer;
}
.pet-button--primary {
  color: #fffce6;
  border: 2px solid #b4c43f;
  background: #92b71c;
  box-shadow:
    inset 0 1px 0 #d9e783,
    0 3px 0 #7c942b;
  text-shadow: 0 1px #698513;
}
.pet-button--small {
  padding: 7px 13px;
  font-size: 12px;
}
.pet-diary button:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.pet-text-button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 0;
  border: 0;
  background: none;
  color: #8b9235;
  font-weight: 700;
  cursor: pointer;
}
.pet-home-top {
  display: grid;
  grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr);
  gap: 28px;
  background: #f9e5b7;
}
.pet-garden {
  position: relative;
  aspect-ratio: 9 / 14;
  min-width: 0;
  background: #f9e5b7;
}
.pet-room {
  display: contents;
}
.pet-room-scene {
  border-radius: 18px;
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
  pointer-events: none;
}
.pet-dog-plaque {
  position: absolute;
  top: 12%;
  left: 50%;
  width: 62%;
  aspect-ratio: 362 / 193;
  transform: translateX(-50%);
  background: url('/activity/pet-diary/img_s3BattlePass_bg1.png') center / 100% 100%;
}
.pet-dog-plaque h2 {
  position: absolute;
  top: 42%;
  left: 39%;
  margin: 0;
  color: #9e6545;
  font-size: clamp(16px, 2cqw, 21px);
  font-weight: 800;
  line-height: 1.3;
  white-space: nowrap;
}
.pet-rarity {
  position: absolute;
  top: 41%;
  left: 12%;
  width: 24%;
  aspect-ratio: 2;
  display: grid;
  place-items: center;
  color: #fff;
  font-size: clamp(11px, 1.7cqw, 18px);
  font-weight: 800;
  line-height: 1;
  text-shadow: 0 1px 1px #8e745540;
}
.pet-rarity img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}
.pet-rarity span {
  position: relative;
}
.pet-growth {
  position: absolute;
  inset: 0;
  width: 100%;
  line-height: 1.4;
}
.pet-growth > span {
  position: absolute;
  top: 65%;
  left: 12%;
  width: 25%;
  height: 16%;
  display: grid;
  place-items: center;
  font-size: clamp(10px, 1.45cqw, 15px);
  font-weight: 700;
  color: #fff2d9;
}
.pet-growth > div {
  position: absolute;
  top: 66%;
  left: 39%;
  width: 55%;
  height: 14%;
}
.pet-growth progress {
  display: block;
  width: 100%;
  height: 100%;
  overflow: hidden;
  border: 0;
  border-radius: 12px;
  background: #edd3b1;
}
.pet-growth progress::-webkit-progress-bar {
  background: url('/activity/pet-diary/img_s3BattlePass_progress.png') center / 100% 100%;
}
.pet-growth progress::-webkit-progress-value {
  background: #9fc94c;
  border-radius: 12px;
}
.pet-growth progress::-moz-progress-bar {
  background: #9fc94c;
  border-radius: 12px;
}
.pet-growth b {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  color: #946347;
  font-size: clamp(10px, 1.5cqw, 16px);
  white-space: nowrap;
  text-shadow:
    1px 1px #fff9e5,
    -1px -1px #fff9e5;
}
.pet-speech {
  position: absolute;
  top: 31%;
  left: 29%;
  display: grid;
  place-items: center;
  width: 44%;
  aspect-ratio: 363 / 226;
  background: url('/activity/pet-diary/img_s3BattlePass_chatBg.png') center / contain no-repeat;
}
.pet-speech img {
  width: 85%;
  height: auto;
}
.pet-room-shortcuts {
  position: absolute;
  top: 28%;
  right: 3%;
  display: flex;
  flex-direction: column;
  gap: 14px;
  width: 15%;
}
.pet-room-shortcuts button {
  position: relative;
  padding: 0;
  border: 0;
  background: none;
  cursor: pointer;
}
.pet-room-shortcuts img {
  display: block;
  width: 100%;
  height: auto;
}
.pet-room-shortcuts span {
  display: block;
  margin-top: -5px;
  color: #fff5d5;
  font-size: 11px;
  font-weight: 800;
  text-shadow:
    0 1px 2px #99632c,
    1px 0 2px #99632c,
    -1px 0 2px #99632c;
}
.pet-escort-shortcut {
  position: absolute;
  right: 2%;
  bottom: 21%;
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 20%;
  padding: 0;
  border: 0;
  color: #855533;
  background: none;
  cursor: pointer;
}
.pet-escort-shortcut img {
  width: 66%;
  max-width: 66px;
  height: auto;
}
.pet-escort-shortcut strong {
  font-size: clamp(11px, 1.6cqw, 16px);
  white-space: nowrap;
}
.pet-escort-shortcut span {
  padding: 0 5px;
  border-radius: 12px;
  color: #fffbea;
  background: #9b8256;
  font-size: 10px;
  white-space: nowrap;
}
.pet-care {
  position: absolute;
  bottom: 5%;
  left: 50%;
  width: 72%;
  transform: translateX(-50%);
  text-align: center;
}
.pet-feed-cost {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin-bottom: 5px;
  color: #fffcec;
  font-size: 16px;
  font-weight: 800;
  text-shadow:
    0 1px 2px #865831,
    1px 0 2px #865831,
    -1px 0 2px #865831;
}
.pet-feed-cost span {
  display: inline-flex;
  align-items: center;
  gap: 3px;
}
.pet-feed-cost img {
  width: 25px;
  height: 25px;
  object-fit: contain;
}
.pet-feed-button {
  display: block;
  width: 74%;
  max-width: 265px;
  aspect-ratio: 309 / 108;
  padding: 0 0 4px;
  margin: auto;
  border: 0;
  color: #da8213;
  background: url('/activity/pet-diary/img_s3BattlePass_btn.png') center / 100% 100%;
  font-size: clamp(19px, 2.4cqw, 26px) !important;
  font-weight: 800 !important;
  line-height: 1.2;
  cursor: pointer;
  filter: drop-shadow(0 3px 1px #92743b40);
}
.pet-care-note {
  display: block;
  margin: 5px 0 0;
  color: #885c38;
  font-size: 11px;
}
.pet-care-note--warning {
  max-width: 240px;
  margin-inline: auto;
  color: #99551e;
  line-height: 1.4;
}
.pet-permanent {
  margin-top: 24px;
  color: var(--pet-muted);
  font-size: 12px;
}
.pet-card {
  min-width: 0;
  padding: 24px;
  border: 1px solid var(--pet-border);
  border-radius: 18px;
  background: #fff5de;
  box-shadow: 0 3px 0 #bd8e4820;
}
.pet-card p {
  margin: 9px 0 18px;
  color: var(--pet-muted);
  font-size: 13px;
}
.pet-gift {
  align-self: start;
  margin: 145px 28px 30px 0;
  padding: 30px 24px;
  text-align: center;
}
.pet-gift-art {
  display: block;
  width: 78px;
  height: 78px;
  object-fit: contain;
  margin: -8px auto 12px;
}
.pet-section-title {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}
.pet-section-title h2 {
  margin: 0;
  font-size: 18px;
  font-weight: 800;
}
.pet-section-title > span {
  font-size: 12px;
  color: var(--pet-muted);
}
.pet-section-title > .pet-button {
  margin-left: auto;
}
.pet-gift .pet-section-title {
  justify-content: center;
}
.pet-seed-rewards {
  display: flex;
  justify-content: center;
  gap: 28px;
  margin: 25px 0;
}
.pet-seed-rewards > div {
  display: flex;
  align-items: center;
  flex-direction: column;
  gap: 3px;
  font-size: 12px;
}
.pet-seed-rewards img {
  width: 64px;
  height: 64px;
  object-fit: contain;
}
.pet-gift > .pet-button {
  width: 100%;
}
.pet-grow-tip {
  padding-top: 22px;
  margin-top: 26px;
  border-top: 1px dashed var(--pet-border);
  text-align: left;
}
.pet-grow-tip p {
  margin: 7px 0;
  font-size: 12px;
}
.pet-grow-tip .pet-text-button {
  margin-top: 12px;
  font-size: 12px;
}
.pet-home-panels {
  display: grid;
  gap: 26px;
  padding: 32px;
}
.pet-home-bottom {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 26px;
}
.pet-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 16px;
  min-height: 180px;
  padding: 20px;
  color: var(--pet-muted);
}
.pet-empty--initial {
  min-height: 400px;
  padding-top: 140px;
}
.pet-empty--small {
  min-height: 130px;
  font-size: 12px;
}
.pet-empty img {
  width: 54px;
  height: 54px;
  object-fit: contain;
  opacity: 0.7;
}
.pet-treasure,
.pet-charm {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 0;
  border-top: 1px dashed var(--pet-border);
}
.pet-treasure > img,
.pet-charm > img {
  flex: none;
  width: 45px;
  height: 45px;
  object-fit: contain;
}
.pet-treasure > div,
.pet-charm > div {
  flex: 1;
  min-width: 0;
}
.pet-treasure span,
.pet-treasure b {
  display: block;
  color: var(--pet-muted);
  font-size: 11px;
  font-weight: 400;
}
.pet-treasure strong,
.pet-charm strong {
  font-size: 13px;
}
.pet-charm p {
  font-size: 12px;
  margin: 5px 0;
}
.pet-charm small {
  padding: 2px 5px;
  border-radius: 6px;
  background: #e7edc7;
  color: #748830;
  font-size: 10px;
}
.pet-charm span,
.pet-muted {
  display: block;
  color: var(--pet-muted);
  font-size: 12px;
}
.pet-diary summary {
  font-weight: 700;
  cursor: pointer;
}
.pet-diary summary > span {
  color: var(--pet-muted);
  font-size: 12px;
  font-weight: 400;
}
.pet-rules {
  margin: 0 32px;
  background: #fff6dfc7;
}
.pet-rules p {
  white-space: pre-line;
  margin: 14px 0;
  font-size: 12px;
}
.pet-friend-form {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}
.pet-friend-form select {
  flex: 1;
  min-width: 150px;
  padding: 7px 12px;
  border: 1px solid var(--pet-border);
  border-radius: 10px;
  background: #fffaf0;
  color: var(--pet-ink);
}
.pet-friend-treasure {
  padding: 16px 0;
  border-bottom: 1px dashed var(--pet-border);
}
.pet-friend-treasure > span {
  margin-left: 12px;
  font-size: 12px;
}
.pet-preview {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 14px;
  margin-top: 10px;
  font-size: 12px;
}
.pet-preview > .pet-button {
  margin-left: auto;
}
.pet-log-tabs {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 18px;
}
.pet-log {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  padding: 12px 0;
  border-bottom: 1px dashed var(--pet-border);
  font-size: 12px;
}
.pet-log time {
  color: var(--pet-muted);
}
.pet-paper {
  position: relative;
  margin-top: -44px;
  padding: 76px 34px 36px;
  border: 0 solid transparent;
  border-image: url('/activity/pet-diary/img_S3Shop_bg.png') 160 0 50 fill / 82px 0 26px / 0 stretch;
}
.pet-story-paper {
  border-image-source: url('/activity/pet-diary/img_s3PhotoWall_bg.png');
}
.pet-story-title {
  display: block;
  width: min(100%, 760px);
  height: auto;
  margin: 0 auto 28px;
}
.pet-story-paper .pet-section-title {
  max-width: 880px;
  margin: auto;
}
.pet-stories {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  align-items: start;
  gap: 34px 28px;
  max-width: 880px;
  margin: 28px auto 8px;
}
.pet-story {
  position: relative;
  min-width: 0;
  text-align: center;
}
.pet-photo {
  position: relative;
  aspect-ratio: 539 / 774;
  overflow: hidden;
  background: url('/activity/pet-diary/img_s3PhotoWall_photoBg.png') center / 100% 100%;
}
.pet-photo img {
  position: absolute;
  inset: 4% 5%;
  display: block;
  width: 90%;
  height: 92%;
  object-fit: contain;
}
.pet-photo img.pet-photo-placeholder {
  inset: 0;
  width: 100%;
  height: 100%;
}
.pet-photo-pin {
  position: absolute;
  top: -9px;
  left: -7px;
  width: 28px;
  height: auto;
}
.pet-story p {
  font-size: 12px;
  margin: 8px 0 13px;
}
.pet-caption {
  display: block;
  width: 90%;
  height: 50px;
  object-fit: contain;
  margin: 5px auto 12px;
}
.pet-story.locked .pet-photo {
  background: transparent;
}
.pet-story .pet-button {
  font-size: 12px;
}
.pet-story-claim img {
  width: 25px;
  height: 25px;
  object-fit: contain;
}
.pet-shop-caption {
  display: flex;
  align-items: center;
  justify-content: center;
  max-width: 740px;
  min-height: 62px;
  margin: -8px auto 38px;
  padding: 9px 34px;
  border: 0 solid transparent;
  border-image: url('/activity/pet-diary/img_S3Shop_tips_bg.png') 0 50 fill / 0 36px / 0 stretch;
  color: #b77949;
  font-size: clamp(13px, 2.1cqw, 21px);
  font-weight: 800;
  text-align: center;
}
.pet-goods {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 32px 22px;
  max-width: 950px;
  margin: 0 auto;
}
.pet-product {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  padding: 26px 10px 8px;
  border: 0 solid transparent;
  border-image: url('/activity/pet-diary/img_S3Shop_rarity_bg_3.png') 50 0 85 fill / 36px 0 54px / 0 stretch;
  background: none;
  color: #9f724a;
  cursor: pointer;
  transition: transform 150ms ease;
}
.pet-product--gold {
  border-image-source: url('/activity/pet-diary/img_S3Shop_rarity_bg_4.png');
}
.pet-product:hover {
  transform: translateY(-3px);
}
.pet-product-image {
  display: grid;
  place-items: center;
  width: 100%;
  aspect-ratio: 1;
  overflow: hidden;
  background: url('/activity/pet-diary/img_S3Shop_icon_bg.png') center / 100% 100%;
}
.pet-product-image img {
  width: 100%;
  height: 100%;
  min-height: 0;
  object-fit: contain;
}
.pet-product-name {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
  margin: 5px 0;
  font-size: 14px;
  font-weight: 800;
  line-height: 1.4;
  text-align: center;
}
.pet-price {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  min-height: 38px;
  width: 100%;
  background: url('/activity/pet-diary/img_S3Shop_rarity_3.png') center / 100% 100%;
  color: #ff6249;
  font-size: 19px;
  font-weight: 800;
  text-shadow:
    1px 1px #fff8e6,
    -1px -1px #fff8e6,
    1px -1px #fff8e6,
    -1px 1px #fff8e6;
}
.pet-product--gold .pet-price {
  background-image: url('/activity/pet-diary/img_S3Shop_rarity_4.png');
}
.pet-price > span {
  display: inline-flex;
  align-items: center;
  gap: 1px;
}
.pet-price img {
  width: 28px;
  height: 28px;
  object-fit: contain;
}
.pet-product--sold .pet-product-image {
  opacity: 0.6;
}
.pet-product-sold {
  position: absolute;
  top: 30%;
  left: 50%;
  padding: 4px 15px;
  border-radius: 20px;
  background: #785b42dc;
  color: #fff9df;
  transform: translateX(-50%) rotate(-8deg);
  white-space: nowrap;
}
.pet-solar {
  display: flex;
  flex-direction: column;
  height: 100cqh;
  min-height: 540px;
  padding-bottom: 16px;
  color: #235674;
}
.pet-solar-scene {
  position: relative;
  flex: 1;
  min-height: 320px;
  overflow: hidden;
  background: #c1dde5;
}
.pet-solar-scene--bailu {
  background: #8dc5e2;
}
.pet-solar-scene > img {
  position: absolute;
  object-fit: contain;
}
.pet-solar-landscape {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover !important;
  object-position: center 54%;
}
.pet-solar-lettering {
  position: absolute;
  top: 25%;
  right: 27%;
  display: flex;
  align-items: flex-start;
  gap: 20px;
}
.pet-solar-lettering img:first-child {
  width: 95px;
  height: auto;
}
.pet-solar-lettering img:last-child {
  width: 44px;
  height: auto;
  margin-top: 145px;
}
.pet-term-tabs {
  position: absolute;
  top: 140px;
  left: 30px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.pet-term-tabs button {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  width: 80px;
  height: 56px;
  padding: 0;
  border: 2px solid #c1e2ed;
  border-radius: 16px;
  background: #d5ecf4e8;
  box-shadow: 0 3px 0 #397fa42b;
  color: #286486;
  font-size: 17px;
  font-weight: 800;
  cursor: pointer;
}
.pet-term-tabs button.selected {
  border-color: #6cacc2;
  background: #f4fcff;
  color: #235d78;
}
.pet-term-tabs span {
  font-size: 12px;
}
.pet-solar-upcoming {
  position: absolute;
  inset: 140px 20% auto;
  text-align: center;
}
.pet-solar-upcoming h2 {
  margin: 40px 0 12px;
  font-family: 'KaiTi', serif;
  font-size: 68px;
}
.pet-solar-upcoming p {
  font-size: 14px;
}
.pet-solar-gift {
  position: relative;
  flex: none;
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: center;
  gap: 10px 24px;
  margin-top: 0;
  padding: 30px 38px;
  border-top: 1px solid #ffffff80;
  border-radius: 28px 28px 0 0;
  color: #315b67;
  background: #e5eee2;
}
.pet-solar-gift h2 {
  margin: 0;
  font-size: 19px;
  font-weight: 800;
}
.pet-solar-gift p {
  margin: 3px 0 0;
  font-size: 12px;
  opacity: 0.75;
}
.pet-solar-gift > .pet-button {
  grid-column: 2;
  grid-row: 1 / 3;
}
.pet-inline-rewards {
  display: flex;
  align-items: center;
  gap: 20px;
  flex-wrap: wrap;
}
.pet-inline-rewards > span {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
}
.pet-inline-rewards img {
  width: 40px;
  height: 40px;
  object-fit: contain;
}
.pet-diary--solar .pet-content {
  background: #e5eee2;
}
.pet-diary--solar .pet-rules {
  margin-top: 14px;
  border-color: #c4d9c8;
  background: #f4f5e7c9;
}
.pet-status {
  flex: none;
  max-height: 25%;
  overflow: auto;
  padding: 8px 12px;
  background: #fff1d1;
}
.pet-message {
  padding: 8px 12px;
  border-radius: 10px;
  background: #edf0d1;
  color: #6c7d30;
  font-size: 12px;
  overflow-wrap: anywhere;
}
.pet-message + .pet-message {
  margin-top: 6px;
}
.pet-message--error {
  background: #f7dfca;
  color: #a35739;
}
.pet-message--warning {
  background: #f8edc9;
  color: #8b723c;
}
.pet-message button {
  margin-left: 8px;
  padding: 0;
  border: 0;
  color: inherit;
  background: none;
  text-decoration: underline;
  cursor: pointer;
}
.pet-exchange-dialog {
  position: fixed;
  top: 50%;
  left: 50%;
  width: min(450px, calc(100vw - 40px));
  max-width: none;
  max-height: calc(100dvh - 44px);
  margin: 0;
  padding: 0;
  transform: translate(-50%, -50%);
  overflow: visible;
  border: 9px solid #d59261;
  border-radius: 28px;
  color: #89533a;
  background: #fff0ce;
  box-shadow:
    0 6px 0 #a86237,
    0 24px 70px #30231c40;
}
.pet-exchange-dialog::backdrop {
  background: #242c20a3;
}
.pet-record-dialog {
  width: min(620px, calc(100vw - 40px));
}
.pet-exchange-dialog > header {
  position: relative;
  margin: -1px -1px 0;
  padding: 4px 30px 14px;
  border-radius: 17px 17px 0 0;
  background: #ce926d;
  text-align: center;
}
.pet-exchange-dialog h2 {
  margin: 0;
  color: #fff5e7;
  font-size: 24px;
  font-weight: 800;
}
.pet-dialog-close {
  position: absolute;
  top: -21px;
  right: -20px;
  display: grid;
  place-items: center;
  width: 48px;
  height: 48px;
  padding: 0;
  border: 3px solid #f6c291;
  border-radius: 45%;
  color: #fff7df;
  background: #e39c6b;
  box-shadow: 0 3px 0 #b5754c;
  cursor: pointer;
}
.pet-dialog-close svg {
  display: block;
  width: 26px;
  height: 26px;
  fill: none;
  stroke: currentColor;
  stroke-width: 3;
  stroke-linecap: round;
}
.pet-dialog-body {
  max-height: calc(100dvh - 124px);
  overflow: auto;
  padding: 24px;
  border-radius: 0 0 18px 18px;
}
.pet-exchange-product {
  display: flex;
  align-items: center;
  gap: 18px;
  margin-bottom: 24px;
}
.pet-exchange-product > img {
  width: 96px;
  height: 96px;
  object-fit: contain;
  flex: none;
  border-radius: 18px;
  background: #f9e8b9;
}
.pet-exchange-product h3 {
  margin: 0 0 8px;
  font-size: 19px;
  font-weight: 800;
}
.pet-exchange-product p {
  margin: 0;
  color: #aa8564;
  font-size: 12px;
}
.pet-quantity-label {
  display: block;
  margin-bottom: 7px;
  color: #a5805b;
  font-size: 12px;
}
.pet-quantity {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 12px;
  border: 1px solid #f0d5a1;
  border-radius: 16px;
  background: #f7e5bc;
  box-shadow: inset 0 2px 4px #ae854515;
}
.pet-quantity button {
  display: grid;
  place-items: center;
  flex: none;
  min-width: 37px;
  height: 37px;
  padding: 0 6px;
  border: 2px solid #b1a998;
  border-radius: 9px;
  color: #fff9ed;
  background: #868479;
  box-shadow: 0 3px 0 #655f535e;
  font-size: 23px;
  font-weight: 800;
  cursor: pointer;
}
.pet-quantity button:last-child {
  font-size: 12px;
}
.pet-quantity input {
  width: 100%;
  min-width: 0;
  height: 37px;
  border: 1px solid #dfc691;
  border-radius: 9px;
  color: #86613d;
  background: #fff8e6;
  text-align: center;
  font-weight: 800;
}
.pet-exchange-limit {
  margin: 20px 0 8px;
  font-size: 13px;
  text-align: center;
}
.pet-exchange-cost {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  min-height: 31px;
  color: #ed674a;
  font-size: 20px;
  font-weight: 800;
}
.pet-exchange-cost span {
  display: inline-flex;
  align-items: center;
  gap: 3px;
}
.pet-exchange-cost img {
  width: 31px;
  height: 31px;
  object-fit: contain;
}
.pet-exchange-hint {
  margin: 8px 0 0;
  text-align: center;
  color: #aa664c;
  font-size: 12px;
}
.pet-exchange-submit {
  display: flex;
  min-width: 170px;
  margin: 18px auto 0;
  font-size: 19px !important;
}
.pet-dialog-body .pet-message {
  margin-top: 12px;
}
.pet-diary button:focus-visible,
.pet-diary summary:focus-visible,
.pet-diary input:focus-visible,
.pet-diary select:focus-visible,
.pet-scroll:focus-visible {
  outline: 3px solid #749645;
  outline-offset: 3px;
}
/* 桌面场景按可用高度等比缩放，为右侧四卡保留空间。 */
@container (min-width: 761px) {
  .pet-header {
    position: relative;
    inset: auto;
    align-items: center;
    padding: 16px 24px;
  }
  .pet-heading {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px 16px;
  }
  .pet-heading h1 {
    margin: 0;
  }
  .pet-heading h1 img {
    width: 240px;
  }
  .pet-countdown {
    flex: none;
    white-space: nowrap;
  }
  .pet-home-top {
    grid-template-columns: min(32%, max(180px, calc((100cqh - 110px) * 9 / 14))) minmax(0, 1fr);
    height: 100%;
    min-height: 0;
    align-items: start;
    gap: 24px;
    padding: 0 24px 20px;
  }
  .pet-garden {
    aspect-ratio: auto;
    border-radius: 18px;
    background: #f8e7be;
  }
  .pet-room {
    position: relative;
    display: block;
    width: 100%;
    aspect-ratio: 9 / 14;
  }
  .pet-care {
    position: absolute;
    bottom: 1%;
    left: 50%;
    width: 90%;
    padding: 0;
    transform: translateX(-50%);
  }
  .pet-feed-button {
    width: 180px;
    max-width: 100%;
    font-size: 18px !important;
  }
  .pet-care-note {
    margin-top: 2px;
    font-size: 10px;
    line-height: 1.3;
  }
  .pet-feed-cost img {
    width: 20px;
    height: 20px;
  }
  .pet-feed-cost {
    color: var(--pet-ink);
    font-size: 14px;
    text-shadow: none;
  }
  .pet-dog-plaque h2 {
    font-size: 14px;
  }
  .pet-rarity {
    font-size: 12px;
  }
  .pet-growth > span {
    font-size: 10px;
  }
  .pet-growth b {
    font-size: 11px;
  }
  .pet-gift {
    width: 100%;
    margin: 0;
    padding: 20px;
  }
  .pet-gift-art {
    width: 56px;
    height: 56px;
    margin: 0 auto 8px;
  }
  .pet-seed-rewards {
    margin: 16px 0;
  }
  .pet-grow-tip {
    margin-top: 18px;
    padding-top: 14px;
  }
  .pet-home-panels {
    padding: 0 24px 24px;
    gap: 18px;
  }
  .pet-paper {
    margin: 16px 24px 0;
    padding: 40px 24px 28px;
    border-image-width: 44px 0 26px;
  }
  .pet-story-title {
    width: min(65%, 560px);
    margin-bottom: 24px;
  }
  .pet-story-paper .pet-section-title,
  .pet-stories,
  .pet-goods {
    max-width: none;
  }
  .pet-stories {
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 28px;
  }
  .pet-goods {
    grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
    gap: 24px;
  }
  .pet-shop-caption {
    font-size: 17px;
    margin-bottom: 24px;
  }
  .pet-solar {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(280px, 340px);
    align-items: stretch;
    gap: 24px;
    height: auto;
    min-height: 0;
    padding: 0 24px 24px;
  }
  .pet-solar-scene {
    min-height: 460px;
    height: clamp(460px, 65cqh, 680px);
    border-radius: 18px;
  }
  .pet-term-tabs {
    top: 24px;
    left: 24px;
    flex-direction: row;
    flex-wrap: wrap;
  }
  .pet-solar-gift {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    justify-content: center;
    gap: 24px;
    padding: 28px;
    border: 1px solid #c7d9c8;
    border-radius: 18px;
  }
  .pet-inline-rewards {
    flex-wrap: wrap;
  }
  .pet-tabs {
    height: 92px;
    padding-inline: max(24px, calc((100% - 960px) / 2));
  }
  .pet-tabs img {
    width: 80px;
    height: 80px;
  }
  .pet-tabs button.selected img {
    width: 88px;
    height: 88px;
  }
}
@container (max-width: 760px) {
  .pet-header {
    position: relative;
    inset: auto;
    padding: 16px;
    flex-wrap: nowrap;
    gap: 8px;
  }
  .pet-brand {
    flex: 1;
    min-width: 0;
  }
  .pet-heading {
    flex: 1;
  }
  .pet-heading h1 img {
    width: clamp(150px, 32cqw, 210px);
  }
  .pet-header-tools {
    flex: none;
    gap: 6px;
  }
  .pet-wallet {
    right: auto;
    left: 0;
    width: min(300px, calc(100cqw - 32px));
  }
  .pet-home-top {
    display: block;
    padding-inline: 28px;
  }
  .pet-garden {
    width: 100%;
    margin: 0;
  }
  .pet-gift {
    margin: 28px 0 0;
  }
  .pet-solar {
    height: auto;
    min-height: 0;
    padding-inline: 28px;
    gap: 24px;
  }
  .pet-solar-scene {
    flex: none;
    height: 440px;
    border-radius: 18px;
  }
  .pet-solar-gift {
    border-radius: 18px;
  }
  .pet-term-tabs {
    top: 20px;
  }
  .pet-home-panels {
    padding: 28px;
  }
  .pet-home-bottom {
    grid-template-columns: 1fr;
  }
  .pet-goods {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
  .pet-stories {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .pet-solar-gift {
    grid-template-columns: 1fr;
  }
  .pet-solar-gift > .pet-button {
    grid-column: auto;
    grid-row: auto;
    justify-self: start;
    margin-top: 8px;
  }
}
@container (max-width: 520px) {
  .pet-home-top,
  .pet-solar {
    padding-inline: 16px;
  }
  .pet-content {
    padding-bottom: 20px;
  }
  .pet-header {
    inset: auto;
    padding: 16px;
    gap: 7px;
  }
  .pet-brand,
  .pet-header-tools {
    gap: 6px;
  }
  .pet-heading h1 img {
    width: clamp(120px, 32cqw, 168px);
  }
  .pet-heading h1 {
    margin-bottom: 7px;
  }
  .pet-icon-button {
    width: 28px;
    height: 28px;
  }
  .pet-countdown {
    padding: 1px 7px;
    font-size: 10px;
  }
  .pet-refresh {
    width: 28px;
    height: 28px;
    font-size: 12px;
  }
  .pet-wallet-menu > summary {
    min-width: 76px;
    height: 26px;
    padding-right: 6px;
  }
  .pet-wallet-menu > summary > img {
    width: 30px;
    height: 30px;
  }
  .pet-wallet-menu > summary > strong {
    font-size: 12px;
  }
  .pet-wallet-menu > summary > span {
    font-size: 9px;
  }
  .pet-wallet {
    top: 38px;
    padding: 16px;
  }
  .pet-tabs {
    height: 86px;
    padding: 0 5px;
    gap: 0;
  }
  .pet-tabs button {
    padding-bottom: 3px;
  }
  .pet-tabs img {
    width: 70px;
    height: 70px;
    max-width: 100%;
  }
  .pet-tabs button.selected img {
    width: 80px;
    height: 80px;
    max-width: 100%;
  }
  .pet-tabs i {
    top: 5px;
    left: calc(50% + 22px);
  }
  .pet-dog-plaque {
    top: 12%;
    width: 62%;
  }
  .pet-dog-plaque h2 {
    font-size: 16px;
  }
  .pet-rarity {
    font-size: 12px;
  }
  .pet-room-shortcuts {
    gap: 12px;
  }
  .pet-room-shortcuts span {
    font-size: 9px;
  }
  .pet-care {
    bottom: 4%;
  }
  .pet-feed-cost {
    margin-bottom: 2px;
    font-size: 14px;
  }
  .pet-feed-cost img {
    width: 22px;
    height: 22px;
  }
  .pet-care-note {
    font-size: 10px;
  }
  .pet-gift {
    margin: 24px 0 0;
    padding: 25px 22px;
  }
  .pet-home-panels {
    gap: 22px;
    padding: 26px 16px;
  }
  .pet-home-bottom {
    gap: 22px;
  }
  .pet-card {
    padding: 20px;
  }
  .pet-section-title h2 {
    font-size: 17px;
  }
  .pet-section-title > span {
    font-size: 11px;
  }
  .pet-rules {
    margin-inline: 16px;
  }
  .pet-paper {
    margin-top: -30px;
    padding: 55px 15px 28px;
    border-image-width: 55px 0 20px;
  }
  .pet-story-title {
    margin-bottom: 22px;
  }
  .pet-stories {
    gap: 26px 15px;
    margin-top: 22px;
  }
  .pet-photo-pin {
    width: 21px;
    top: -6px;
    left: -5px;
  }
  .pet-story .pet-button {
    padding: 8px 12px;
    font-size: 11px;
  }
  .pet-caption {
    height: 42px;
  }
  .pet-shop-caption {
    min-height: 43px;
    padding: 6px 16px;
    margin: -6px auto 28px;
    border-image-width: 0 23px;
    font-size: 12px;
  }
  .pet-goods {
    gap: 26px 10px;
  }
  .pet-product {
    padding: 15px 5px 6px;
    gap: 2px;
    border-image-width: 22px 0 36px;
  }
  .pet-product-name {
    margin: 3px 0;
    font-size: 10px;
    line-height: 1.4;
  }
  .pet-price {
    min-height: 28px;
    font-size: 14px;
  }
  .pet-price img {
    width: 20px;
    height: 20px;
  }
  .pet-friend-form {
    gap: 7px;
  }
  .pet-friend-form > .pet-button {
    padding: 8px;
    font-size: 12px;
  }
  .pet-log {
    flex-direction: column;
    gap: 4px;
  }
  .pet-solar-landscape {
    object-position: center 47%;
  }
  .pet-term-tabs {
    top: 20px;
    left: 17px;
    gap: 12px;
  }
  .pet-term-tabs button {
    width: 56px;
    height: 38px;
    font-size: 14px;
  }
  .pet-solar-lettering {
    top: 24%;
    right: 22%;
    gap: 12px;
  }
  .pet-solar-lettering img:first-child {
    width: 65px;
  }
  .pet-solar-lettering img:last-child {
    width: 30px;
    margin-top: 110px;
  }
  .pet-solar-gift {
    padding: 24px;
  }
  .pet-solar-gift h2 {
    font-size: 17px;
  }
  .pet-inline-rewards {
    gap: 16px;
  }
  .pet-inline-rewards > span {
    font-size: 11px;
  }
  .pet-inline-rewards img {
    width: 34px;
    height: 34px;
  }
  .pet-exchange-dialog {
    border-width: 7px;
  }
  .pet-dialog-body {
    padding: 22px 18px;
  }
  .pet-exchange-product {
    gap: 13px;
  }
  .pet-exchange-product > img {
    width: 76px;
    height: 76px;
  }
  .pet-exchange-product h3 {
    font-size: 17px;
  }
}
@container (max-width: 430px) {
  .pet-header {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
  }
  .pet-brand {
    grid-column: 1 / -1;
  }
  .pet-header-tools {
    grid-column: 1 / -1;
    justify-content: flex-start;
  }
  .pet-wallet {
    width: min(300px, calc(100cqw - 32px));
  }
}
@container (max-width: 350px) {
  .pet-heading h1 img {
    width: 135px;
  }
  .pet-header {
    inset: auto;
    padding-inline: 16px;
  }
  .pet-product-name {
    font-size: 9px;
  }
  .pet-price {
    font-size: 12px;
  }
  .pet-price img {
    width: 17px;
    height: 17px;
  }
  .pet-growth > span {
    font-size: 8px;
  }
}
/* 动画只作为页面背景，不占用前景布局高度。 */
.pet-story-section,
.pet-shop {
  position: relative;
  isolation: isolate;
  padding: 16px;
}
.pet-page-background {
  position: absolute;
  z-index: -1;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
  background: #74bae1;
}
.pet-page-background picture,
.pet-page-background img {
  display: block;
  width: 100%;
  height: 100%;
}
.pet-page-background img {
  object-fit: cover;
  object-position: center;
}
.pet-story-paper,
.pet-shop-paper {
  margin: 0;
  padding: 16px;
  border: 0;
  border-image: none;
  background: #fff5de24;
  border-radius: 18px;
}
.pet-story,
.pet-product {
  padding: 12px;
  border: 1px solid #e8cd9bb3;
  border-image: none;
  border-radius: 14px;
  background: #fff5dee8;
  box-shadow: 0 2px 8px #55422612;
}
.pet-product--gold {
  border-color: #e4b64c;
  background: #fff0c9eb;
}
.pet-story-paper .pet-section-title {
  padding: 6px 12px;
  border-radius: 10px;
  background: #fff5deed;
}
.pet-story-title,
.pet-shop-caption {
  flex-shrink: 0;
}

@container (min-width: 761px) {
  .pet-diary--stories .pet-content,
  .pet-diary--shop .pet-content {
    display: flex;
    flex-direction: column;
    height: 100cqh;
    min-height: 0;
    padding-bottom: 0;
  }
  .pet-diary--stories .pet-header,
  .pet-diary--shop .pet-header {
    flex: none;
  }
  .pet-story-section,
  .pet-shop {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    padding: 12px 24px;
    gap: 10px;
  }
  .pet-story-paper,
  .pet-shop-paper {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    margin: 0;
    padding: 18px 18px 10px;
    border-image-width: 24px 0 14px;
    gap: 8px;
  }
  .pet-story-title {
    width: auto;
    max-width: 65%;
    height: 30px;
    object-fit: contain;
    margin: 0 auto;
  }
  .pet-story-paper .pet-section-title {
    flex: none;
    width: 100%;
    margin: 0;
  }
  .pet-stories,
  .pet-goods {
    flex: 1;
    min-height: 0;
    width: 100%;
    margin: 0;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    grid-auto-rows: minmax(0, 1fr);
    align-items: stretch;
    gap: 12px 18px;
  }
  .pet-story {
    display: flex;
    flex-direction: column;
    align-items: center;
    min-height: 0;
    gap: 4px;
  }
  .pet-photo {
    flex: 1;
    min-height: 0;
    width: 100%;
    aspect-ratio: auto;
    background-size: contain;
    background-repeat: no-repeat;
  }
  .pet-caption {
    flex: none;
    height: 24px;
    margin: 0;
  }
  .pet-story p {
    margin: 0;
    font-size: 11px;
  }
  .pet-story .pet-button {
    flex: none;
    padding: 4px 12px;
    font-size: 11px;
  }
  .pet-story-claim img {
    width: 18px;
    height: 18px;
  }
  .pet-shop-caption {
    flex: none;
    min-height: 28px;
    padding: 3px 24px;
    margin: 0 auto;
    font-size: 14px;
  }
  .pet-product {
    min-height: 0;
    padding: 10px 8px 4px;
    border-image-width: 18px 0 28px;
    gap: 3px;
  }
  .pet-product-image {
    flex: 1;
    min-height: 0;
    aspect-ratio: auto;
    background-size: contain;
    background-repeat: no-repeat;
  }
  .pet-product-name {
    flex: none;
    margin: 0;
    font-size: 12px;
  }
  .pet-price {
    flex: none;
    min-height: 26px;
    font-size: 14px;
  }
  .pet-price img {
    width: 20px;
    height: 20px;
  }
}
@container (min-width: 1100px) {
  .pet-stories,
  .pet-goods {
    grid-template-columns: repeat(6, minmax(0, 1fr));
  }
}
/* 节令场景铺满内容区，赠礼卡浮于右侧。 */
.pet-diary--solar .pet-content {
  display: flex;
  flex-direction: column;
  height: 100cqh;
  min-height: 0;
  padding-bottom: 0;
}
.pet-diary--solar .pet-header {
  flex: none;
}
.pet-solar {
  position: relative;
  isolation: isolate;
  display: flex;
  flex: 1;
  flex-direction: row;
  align-items: center;
  justify-content: flex-end;
  height: auto;
  min-height: 0;
  padding: 24px;
}
.pet-solar-scene {
  position: absolute;
  z-index: -1;
  inset: 0;
  width: 100%;
  height: 100%;
  min-height: 0;
  border-radius: 0;
}
.pet-solar-gift {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  justify-content: center;
  gap: 20px;
  width: min(340px, 38%);
  max-height: 100%;
  overflow: auto;
  padding: 24px;
  border: 1px solid #ffffffb3;
  border-radius: 18px;
  background: #e5eee2d9;
  box-shadow: 0 8px 24px #23567420;
  backdrop-filter: blur(6px);
  scrollbar-width: thin;
}
.pet-solar-gift p {
  opacity: 1;
  overflow-wrap: anywhere;
}
.pet-solar-lettering {
  right: 45%;
}
.pet-solar-upcoming {
  inset: 100px 42% auto 10%;
}
.pet-solar > .pet-empty {
  width: 100%;
  min-height: 0;
  padding: 24px;
}
@container (max-width: 760px) {
  .pet-solar {
    align-items: flex-end;
    padding: 16px;
    min-height: 440px;
  }
  .pet-solar-gift {
    width: min(340px, 100%);
    max-height: 55%;
    padding: 18px;
    gap: 12px;
  }
  .pet-solar-lettering {
    top: 12%;
    right: 20%;
  }
  .pet-solar-upcoming {
    inset: 50px 12% auto 25%;
  }
}
/* 桌面四卡同屏；长列表在卡片内滚动，移动端按阅读顺序排列。 */
.pet-home-dashboard {
  display: grid;
  gap: 24px;
  min-width: 0;
}
.pet-home-dashboard > .pet-card {
  margin: 0;
  min-width: 0;
}
.pet-home-dashboard .pet-section-title {
  flex-wrap: wrap;
}
@container (min-width: 761px) {
  .pet-diary--home .pet-content {
    display: flex;
    flex-direction: column;
    height: 100cqh;
    min-height: 0;
    padding-bottom: 0;
  }
  .pet-diary--home .pet-header {
    flex: none;
  }
  .pet-home {
    flex: 1;
    min-height: 0;
  }
  .pet-home-dashboard {
    height: 100%;
    min-height: 0;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    grid-template-rows: repeat(2, minmax(0, 1fr));
    gap: 16px;
  }
  .pet-home-dashboard > .pet-card {
    align-self: stretch;
    overflow: auto;
    padding: 16px;
    scrollbar-width: thin;
  }
  .pet-home-dashboard .pet-section-title {
    gap: 8px;
  }
  .pet-home-dashboard .pet-section-title h2 {
    font-size: 17px;
  }
  .pet-home-dashboard .pet-card p {
    margin: 8px 0;
    font-size: 12px;
  }
  .pet-home-dashboard .pet-gift-art {
    float: left;
    width: 32px;
    height: 32px;
    margin: 0 8px 4px 0;
  }
  .pet-home-dashboard .pet-seed-rewards {
    margin: 8px 0;
    gap: 16px;
  }
  .pet-home-dashboard .pet-seed-rewards img {
    width: 40px;
    height: 40px;
  }
  .pet-home-dashboard .pet-empty--small {
    min-height: 0;
    padding: 12px;
    gap: 8px;
  }
  .pet-home-dashboard .pet-friend-form {
    flex-wrap: wrap;
  }
  .pet-home-dashboard .pet-friend-form select {
    min-width: 0;
    width: 100%;
  }
}
@container (max-width: 760px) {
  .pet-home-dashboard {
    margin-top: 24px;
  }
}
/* 统一功能卡标题与内容节奏。 */
.pet-home-dashboard > .pet-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
  text-align: left;
}
.pet-home-dashboard .pet-section-title {
  flex: none;
  justify-content: flex-start;
  min-height: 38px;
  gap: 10px;
}
.pet-home-dashboard .pet-section-title > .pet-button {
  margin-left: auto;
}
.pet-home-dashboard .pet-gift-art {
  float: none;
  flex: none;
  width: 32px;
  height: 32px;
  margin: 0;
}
.pet-home-dashboard .pet-card p {
  margin: 0;
}
.pet-home-dashboard .pet-seed-rewards {
  flex: 1;
  align-items: center;
  justify-content: center;
  margin: 0;
}
.pet-home-dashboard .pet-gift > .pet-button {
  align-self: center;
  width: min(100%, 280px);
  margin-top: auto;
}
.pet-home-dashboard .pet-empty--small {
  flex: 1;
  justify-content: center;
}
.pet-home-dashboard .pet-charm {
  padding: 12px 0;
}
.pet-home-dashboard .pet-muted {
  margin-top: auto;
}
.pet-friend-picker {
  flex: 1;
  min-width: 0;
  border: 1px solid var(--pet-border);
  border-radius: 12px;
  background: #fffaf0;
}
.pet-friend-picker summary,
.pet-friend-options button {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  cursor: pointer;
}
.pet-friend-picker summary {
  list-style: none;
}
.pet-friend-picker summary::-webkit-details-marker {
  display: none;
}
.pet-friend-picker summary > span:nth-last-child(2),
.pet-friend-options button > span:last-child {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}
.pet-friend-picker img,
.pet-avatar-fallback {
  flex: none;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  object-fit: cover;
}
.pet-friend-options {
  max-height: 180px;
  overflow: auto;
  border-top: 1px solid var(--pet-border);
}
.pet-friend-options button {
  width: 100%;
  border: 0;
  background: transparent;
  color: var(--pet-ink);
  text-align: left;
}
.pet-friend-options button:hover,
.pet-friend-options button[aria-pressed='true'] {
  background: #f6e8bc;
}
.pet-home-dashboard .pet-friend-form {
  align-items: flex-start;
}
@container (min-width: 761px) {
  .pet-story-title {
    width: min(100%, 560px);
    max-width: 100%;
    height: 44px;
  }
  .pet-shop-caption {
    min-height: 44px;
    font-size: 16px;
  }
  .pet-stories {
    grid-template-columns: repeat(10, minmax(0, 1fr));
  }
  .pet-story {
    grid-column: span 2;
  }
  .pet-story:nth-child(6) {
    grid-column: 2 / span 2;
  }
}
@media (max-width: 1023px) {
  .pet-diary.pet-diary {
    /* 移动端 header 仍 64，但 mt-2 8 + 滚动容器 p-3 上下 24，并留出底部安全区 */
    height: max(480px, calc(100dvh - 96px - env(safe-area-inset-bottom)));
    border-radius: 15px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .pet-tabs img,
  .pet-product {
    transition: none;
  }
}
</style>
