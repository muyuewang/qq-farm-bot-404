<script setup lang="ts">
import type { RanchFriendRanch, RanchItem, RanchRequest, RanchState } from '@/utils/ranch'
import { storeToRefs } from 'pinia'
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import api from '@/api'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import { useAccountStore } from '@/stores/account'
import { useRanchStore } from '@/stores/ranch'
import { useToastStore } from '@/stores/toast'
import { formatQuantity, friendGrassLimit, friendGrassRoom, itemListLine } from '@/utils/ranch'

/**
 * 好友牧场面板。
 *
 * 好友详情走 store 的 fetchFriendRanch 单独读取，不进全局快照：列表和展开详情各存一份，
 * 同一时间只展开一位好友，切换时自动收起上一位；操作完成后只刷新这一位，不会把整页翻一次。
 * 所有写操作仍然只 emit request，由外层 RanchSceneHost 统一走 quote → execute，
 * 价格、限额和资源校验都在后端，页面不自己估算。
 */
const props = defineProps<{ state: RanchState | null }>()

const emit = defineEmits<{
  request: [payload: RanchRequest]
}>()

const { currentAccountId } = storeToRefs(useAccountStore())
const ranchStore = useRanchStore()
const toast = useToastStore()

const keyword = ref('')

const friends = computed(() => props.state?.friends || [])
const listReady = computed(() => Array.isArray(props.state?.friends))

/** 已展开的好友详情，按 gid 缓存；只在这里存，避免覆盖全局快照。 */
const details = ref<Record<string, RanchFriendRanch>>({})
const detailErrors = ref<Record<string, string>>({})
const expandedGid = ref<string | null>(null)
const loadingGid = ref('')
/** 刚提交过操作的好友：等写请求结束后只刷新这一位。 */
const pendingGid = ref('')
const grassInputs = reactive<Record<string, number>>({})
/** 请求序号：切账号或连续展开时丢弃过期响应。 */
let detailRequest = 0
let alive = true

onBeforeUnmount(() => alive = false)

/**
 * 牧场拜访黑名单。后端巡查按这份名单跳过好友，「不是好友」被服务端拒绝的 GID 也会自动进来。
 * 名单与农场好友黑名单彼此独立：牧场好友本身就是按场景单独同步的另一批人。
 */
const blacklistGids = ref<number[]>([])
const blacklistedSet = computed(() => new Set(blacklistGids.value))
const showBlacklist = ref(false)
const toggling = ref('')
/** 名单读取态：失败时不冒充「空名单」，否则界面会让人以为黑名单被清空了。 */
const blacklistLoading = ref(false)
const blacklistError = ref('')

const visibleFriends = computed(() => {
  const text = keyword.value.trim().toLowerCase()
  if (!text)
    return friends.value
  return friends.value.filter(friend => friend.name.toLowerCase().includes(text) || friend.gid.includes(text))
})

/** 黑名单视图：能对上好友列表的补昵称头像，纯 GID 的兜底显示 GID。 */
const blacklistItems = computed(() => blacklistGids.value.map((gid) => {
  const friend = friends.value.find(entry => Number(entry.gid) === gid)
  return { gid, name: friend?.name || `GID:${gid}`, avatarUrl: friend?.avatarUrl || '' }
}))

function detailOf(gid: string) {
  return details.value[gid] || null
}

function collapse(gid: string) {
  if (expandedGid.value === gid)
    expandedGid.value = null
}

function collapseAll() {
  expandedGid.value = null
}

function grassRoomOf(detail: RanchFriendRanch | null) {
  return friendGrassRoom(detail?.feedMachine)
}

function grassLimitOf(detail: RanchFriendRanch | null) {
  return friendGrassLimit(detail)
}

/** 详情到手后把赠送数量重置为当前上限，避免沿用上一次的旧值。 */
function syncGrassInput(gid: string, detail: RanchFriendRanch | null) {
  const limit = grassLimitOf(detail)
  grassInputs[gid] = limit > 0 ? limit : 0
}

async function loadDetail(gid: string) {
  const accountId = String(currentAccountId.value || '')
  if (!accountId || !gid)
    return
  const request = ++detailRequest
  loadingGid.value = gid
  detailErrors.value = { ...detailErrors.value, [gid]: '' }
  const result = await ranchStore.fetchFriendRanch(accountId, gid)
  // 账号切走或又展开了别的卡片时，这份回包已经过期。
  if (!alive || request !== detailRequest || accountId !== String(currentAccountId.value || ''))
    return
  loadingGid.value = ''
  if (!result.ok || !result.ranch) {
    detailErrors.value = { ...detailErrors.value, [gid]: result.error || '读取好友牧场失败' }
    return
  }
  details.value = { ...details.value, [gid]: result.ranch }
  syncGrassInput(gid, result.ranch)
}

async function toggle(gid: string, event?: MouseEvent) {
  if (!gid)
    return
  if (expandedGid.value === gid) {
    collapse(gid)
    return
  }
  // 收起上一位后下方卡片整体上移：记录按钮位置，展开后把滚动条补回同一视点。
  const trigger = event?.currentTarget as HTMLElement | undefined
  const scrollEl = trigger?.closest('.custom-scrollbar') as HTMLElement | null
  const triggerTop = trigger?.getBoundingClientRect().top
  collapseAll()
  expandedGid.value = gid
  await nextTick()
  if (scrollEl && trigger && triggerTop !== undefined)
    scrollEl.scrollTop += trigger.getBoundingClientRect().top - triggerTop
  // 已有缓存时先展示旧数据，同时后台刷新一次，好友那边刚变化的产物也能跟上。
  await loadDetail(gid)
}

async function reloadDetail(gid: string) {
  if (expandedGid.value !== gid)
    return
  await loadDetail(gid)
}

/** 写请求结束后只刷新刚操作过的好友：acting 由 true 回到 false 即一次提交结束。 */
watch(() => ranchStore.acting, (acting, was) => {
  if (!was || acting)
    return
  const gid = pendingGid.value
  pendingGid.value = ''
  if (gid && expandedGid.value === gid)
    void loadDetail(gid)
})

function requestSteal(gid: string, name: string) {
  pendingGid.value = gid
  emit('request', {
    action: 'steal',
    input: { hostGid: gid },
    title: `偷取${name}的牧场产物`,
    note: '服务端按进入牧场那一刻的可偷货架执行，可能少于页面显示的数量；每位好友每天可偷次数由服务端控制。',
  })
}

function requestClean(gid: string, name: string) {
  pendingGid.value = gid
  emit('request', {
    action: 'cleanFriend',
    input: { hostGid: gid },
    title: `清理${name}的栏舍`,
    note: '只清理他人投放且允许清理的危险物，自己放的蚊子不会被清除。',
  })
}

function requestStroke(gid: string, name: string, ranchId: string, animalId: string | number, animalName: string) {
  pendingGid.value = gid
  emit('request', {
    action: 'stroke',
    input: { hostGid: gid, ranchId, animalId },
    title: `抚摸${name}家的${animalName}`,
    note: '抚摸有概率触发巨大变异，每日次数由服务端下发。',
  })
}

function requestMosquito(gid: string, name: string, ranchId: string, ranchName: string) {
  pendingGid.value = gid
  emit('request', {
    action: 'putMosquito',
    input: { hostGid: gid, ranchId },
    title: `向${name}的${ranchName}放蚊子`,
    note: '会影响好友的牧场产出，属于对抗性操作，每日次数与每栏上限由服务端控制。',
    danger: true,
  })
}

function requestGrass(gid: string, name: string) {
  const detail = detailOf(gid)
  const machine = detail?.feedMachine
  const count = Math.floor(Number(grassInputs[gid]) || 0)
  const limit = grassLimitOf(detail)
  if (!machine || count <= 0) {
    toast.error('请填写要赠送的牧草数量')
    return
  }
  if (count > limit) {
    toast.error(`最多可赠送 ${formatQuantity(String(limit))} 份牧草`)
    return
  }
  pendingGid.value = gid
  emit('request', {
    action: 'addGrass',
    input: { hostGid: gid, facilityId: machine.id, count },
    title: `向${name}赠送牧草 ×${count}`,
    note: '牧草从当前账号背包扣除，直接补进好友牧草机；对方机器已满或库存不足时服务端会拒绝。',
  })
}

function shelfText(shelf: { products: RanchItem[] }) {
  return shelf.products.length ? itemListLine(shelf.products) : '货架已空'
}

async function loadBlacklist() {
  const accountId = String(currentAccountId.value || '')
  if (!accountId || blacklistLoading.value)
    return
  blacklistLoading.value = true
  blacklistError.value = ''
  try {
    const { data } = await api.get('/api/ranch-friend-blacklist', {
      headers: { 'x-account-id': accountId },
      skipErrorToast: true,
    } as any)
    if (!data?.ok)
      throw new Error(data?.error || '牧场黑名单读取失败')
    blacklistGids.value = Array.isArray(data.data?.gids) ? data.data.gids.map((gid: any) => Number(gid)) : []
  }
  catch (cause: any) {
    // 失败时保留上一次读到的名单，只把错误显示出来供重试。
    blacklistError.value = cause?.response?.data?.error || cause?.message || '牧场黑名单读取失败'
  }
  finally {
    blacklistLoading.value = false
  }
}

/**
 * 加入/移出黑名单。
 * 显式传 blacklisted 而不是让后端按当前状态取反：并发或重复点击时取反会抖到相反结果。
 * 后端回包带最终状态与最新全量 gids，直接覆盖本地。
 */
async function toggleBlacklist(gid: string | number) {
  const target = Number(gid)
  const accountId = String(currentAccountId.value || '')
  if (!accountId || toggling.value)
    return
  const wanted = !blacklistedSet.value.has(target)
  toggling.value = String(target)
  try {
    const { data } = await api.post('/api/ranch-friend-blacklist/toggle', { gid: target, blacklisted: wanted }, {
      headers: { 'x-account-id': accountId },
      skipErrorToast: true,
    } as any)
    if (!data?.ok)
      throw new Error(data?.error || '操作失败')
    blacklistGids.value = Array.isArray(data.data?.gids) ? data.data.gids.map((item: any) => Number(item)) : []
    blacklistError.value = ''
    // 拉黑后这张卡片不能再展开，否则会出现「已拉黑但仍可操作」的矛盾状态。
    if (wanted)
      collapse(String(target))
    // 以服务端返回的最终状态为准，避免网络重试后本地提示与实际相反。
    const actual = data.data?.blacklisted === true
    toast.success(actual ? '已加入牧场黑名单，巡查不再拜访' : '已移出牧场黑名单')
  }
  catch (cause: any) {
    toast.error(cause?.response?.data?.error || cause?.message || '操作失败')
  }
  finally {
    toggling.value = ''
  }
}

onMounted(() => {
  void loadBlacklist()
})

// 切换账号时重读名单并清掉好友详情，避免把上一个账号的数据显示到新账号上。
watch(currentAccountId, () => {
  blacklistGids.value = []
  blacklistError.value = ''
  showBlacklist.value = false
  details.value = {}
  detailErrors.value = {}
  pendingGid.value = ''
  loadingGid.value = ''
  detailRequest++
  collapseAll()
  void loadBlacklist()
})
</script>

<template>
  <div class="space-y-3">
    <div v-if="!listReady" class="border border-gray-200 rounded-lg border-dashed px-6 py-10 text-center text-sm text-gray-500 dark:border-gray-700">
      好友牧场数据未下发，请点击刷新重新读取。
    </div>

    <template v-else>
      <div class="flex flex-wrap items-center gap-2">
        <template v-if="!showBlacklist">
          <BaseInput v-model="keyword" placeholder="搜索好友昵称或 GID" class="w-56" clearable />
          <span class="rounded-lg bg-gray-50 px-3 py-1.5 text-xs text-gray-600 dark:bg-gray-900/40 dark:text-gray-300">
            共 {{ friends.length }} 位好友
          </span>
        </template>
        <span v-else class="rounded-lg bg-gray-50 px-3 py-1.5 text-xs text-gray-600 dark:bg-gray-900/40 dark:text-gray-300">
          黑名单 {{ blacklistGids.length }} 位
        </span>
        <BaseButton variant="ghost" size="sm" @click="showBlacklist = !showBlacklist">
          {{ showBlacklist ? '返回好友列表' : '牧场黑名单' }}
        </BaseButton>
      </div>

      <template v-if="showBlacklist">
        <p class="rounded-lg bg-gray-50 px-3 py-2 text-[11px] text-gray-500 leading-5 dark:bg-gray-900/40 dark:text-gray-400">
          黑名单里的好友不会被自动巡查、偷取或清理；拜访时被服务端判定「不是好友」的对象也会自动加入。
        </p>
        <!-- 名单读取失败时不显示「黑名单为空」，否则会让人误以为已清空。 -->
        <div v-if="blacklistError" class="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-950/40 dark:text-red-300">
          <span>{{ blacklistError }}</span>
          <BaseButton variant="secondary" size="sm" :loading="blacklistLoading" @click="loadBlacklist()">
            重试
          </BaseButton>
        </div>
        <p v-else-if="blacklistLoading && !blacklistGids.length" class="px-3 py-6 text-center text-sm text-gray-500">
          正在读取牧场黑名单…
        </p>
        <div v-else-if="!blacklistItems.length" class="border border-gray-200 rounded-lg border-dashed px-6 py-10 text-center text-sm text-gray-500 dark:border-gray-700">
          黑名单为空，在好友列表里点「拉黑」即可加入。
        </div>
        <div v-else class="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3">
          <div
            v-for="row in blacklistItems"
            :key="row.gid"
            class="flex items-center gap-2 border border-gray-200 rounded-xl bg-white p-3 shadow-sm dark:border-gray-700 dark:bg-gray-800"
          >
            <img v-if="row.avatarUrl" :src="row.avatarUrl" :alt="row.name" class="h-9 w-9 shrink-0 rounded-full object-cover">
            <div v-else class="i-carbon-user-avatar h-9 w-9 shrink-0 text-xl text-gray-300" />
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-medium">
                {{ row.name }}
              </p>
              <p class="truncate text-[11px] text-gray-500">
                GID {{ row.gid }}
              </p>
            </div>
            <BaseButton
              variant="secondary"
              size="sm"
              :loading="toggling === String(row.gid)"
              @click="toggleBlacklist(row.gid)"
            >
              移出
            </BaseButton>
          </div>
        </div>
      </template>

      <template v-else>
        <div v-if="!friends.length" class="border border-gray-200 rounded-lg border-dashed px-6 py-10 text-center text-sm text-gray-500 dark:border-gray-700">
          没有可访问的好友。
        </div>
        <div v-else-if="!visibleFriends.length" class="border border-gray-200 rounded-lg border-dashed px-6 py-8 text-center text-sm text-gray-500 dark:border-gray-700">
          没有匹配 {{ keyword }} 的好友。
        </div>

        <div v-else class="space-y-3">
          <div
            v-for="friend in visibleFriends"
            :key="friend.gid"
            class="border border-gray-200 rounded-xl bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800"
            :class="{ 'opacity-70': blacklistedSet.has(Number(friend.gid)) }"
          >
            <!-- 卡片头：昵称、巡查判据、黑名单与展开入口 -->
            <div class="flex flex-wrap items-center gap-2 p-3">
              <img v-if="friend.avatarUrl" :src="friend.avatarUrl" :alt="friend.name" class="h-9 w-9 shrink-0 rounded-full object-cover">
              <div v-else class="i-carbon-user-avatar h-9 w-9 shrink-0 text-xl text-gray-300" />
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2">
                  <p class="min-w-0 truncate text-sm font-medium">
                    {{ friend.name }}
                  </p>
                  <p class="shrink-0 text-[11px] text-gray-400">
                    {{ friend.gid }}
                  </p>
                </div>
                <!-- 巡查判据由后端整条下发，这里只做展示，不自行推断可偷/可帮生产/可清理。 -->
                <div class="mt-1 flex flex-wrap gap-1">
                  <span
                    v-if="blacklistedSet.has(Number(friend.gid))"
                    class="rounded bg-red-50 px-1.5 py-0.5 text-[10px] text-red-600 dark:bg-red-950/40 dark:text-red-300"
                  >
                    已拉黑
                  </span>
                  <template v-else>
                    <span v-if="friend.stealLotCount" class="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                      可偷 {{ friend.stealLotCount }} 批
                    </span>
                    <span v-if="friend.canMidwife" class="rounded bg-sky-50 px-1.5 py-0.5 text-[10px] text-sky-700 dark:bg-sky-950/40 dark:text-sky-300">
                      可帮生产{{ friend.midwifeCount ? ` ${friend.midwifeCount} 次` : '' }}
                    </span>
                    <span v-if="friend.helpCount" class="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                      可帮 {{ friend.helpCount }} 次
                    </span>
                    <span v-if="!friend.stealLotCount && !friend.canMidwife && !friend.helpCount" class="rounded bg-gray-50 px-1.5 py-0.5 text-[10px] text-gray-500 dark:bg-gray-900/40 dark:text-gray-400">
                      暂无互动
                    </span>
                  </template>
                </div>
              </div>
              <BaseButton
                variant="secondary"
                size="sm"
                :loading="toggling === friend.gid"
                @click="toggleBlacklist(friend.gid)"
              >
                {{ blacklistedSet.has(Number(friend.gid)) ? '移出黑名单' : '拉黑' }}
              </BaseButton>
              <BaseButton
                variant="ghost"
                size="sm"
                :disabled="blacklistedSet.has(Number(friend.gid))"
                @click="toggle(friend.gid, $event)"
              >
                {{ expandedGid === friend.gid ? '收起' : '查看牧场' }}
              </BaseButton>
            </div>

            <!-- 展开区：详情走单独接口，未拿到前不猜任何状态 -->
            <div v-if="expandedGid === friend.gid" class="border-t border-gray-100 px-3 pb-3 pt-3 space-y-3 dark:border-gray-700">
              <div v-if="loadingGid === friend.gid && !detailOf(friend.gid)" class="py-6 text-center text-xs text-gray-500">
                正在进入{{ friend.name }}的牧场…
              </div>
              <div v-else-if="detailErrors[friend.gid]" class="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-950/40 dark:text-red-300">
                <span>{{ detailErrors[friend.gid] }}</span>
                <BaseButton variant="secondary" size="sm" :loading="loadingGid === friend.gid" @click="reloadDetail(friend.gid)">
                  重试
                </BaseButton>
              </div>

              <template v-else-if="detailOf(friend.gid)">
                <div class="flex flex-wrap items-center gap-2">
                  <span class="rounded-lg bg-gray-50 px-2 py-1 text-[11px] text-gray-600 dark:bg-gray-900/40 dark:text-gray-300">
                    牧场 Lv.{{ detailOf(friend.gid)!.level }}
                  </span>
                  <span
                    v-if="detailOf(friend.gid)!.feedMachine"
                    class="rounded-lg bg-gray-50 px-2 py-1 text-[11px] text-gray-600 dark:bg-gray-900/40 dark:text-gray-300"
                  >
                    牧草机 {{ formatQuantity(detailOf(friend.gid)!.feedMachine!.count) }} / {{ formatQuantity(detailOf(friend.gid)!.feedMachine!.capacity) }}
                  </span>
                  <span class="rounded-lg bg-gray-50 px-2 py-1 text-[11px] text-gray-600 dark:bg-gray-900/40 dark:text-gray-300">
                    今日抚摸剩余 {{ detailOf(friend.gid)!.strokeRemaining ?? '未下发' }} 次
                  </span>
                  <span class="rounded-lg bg-gray-50 px-2 py-1 text-[11px] text-gray-600 dark:bg-gray-900/40 dark:text-gray-300">
                    今日放蚊剩余 {{ detailOf(friend.gid)!.mosquitoRemaining ?? '未下发' }} 次
                  </span>
                  <BaseButton variant="ghost" size="sm" :loading="loadingGid === friend.gid" @click="reloadDetail(friend.gid)">
                    刷新
                  </BaseButton>
                </div>

                <!-- 生涯统计是服务端长期累计值；对方没开放或查询失败时整行不出现。 -->
                <div v-if="detailOf(friend.gid)!.career" class="flex flex-wrap gap-2">
                  <span class="rounded-lg bg-gray-50 px-2 py-1 text-[11px] text-gray-600 dark:bg-gray-900/40 dark:text-gray-300">
                    累计收获 {{ formatQuantity(detailOf(friend.gid)!.career!.harvest) }}
                  </span>
                  <span class="rounded-lg bg-gray-50 px-2 py-1 text-[11px] text-gray-600 dark:bg-gray-900/40 dark:text-gray-300">
                    培养成熟 {{ formatQuantity(detailOf(friend.gid)!.career!.mature) }}
                  </span>
                  <span class="rounded-lg bg-gray-50 px-2 py-1 text-[11px] text-gray-600 dark:bg-gray-900/40 dark:text-gray-300">
                    累计偷取 {{ formatQuantity(detailOf(friend.gid)!.career!.steal) }}
                  </span>
                </div>

                <div class="flex flex-wrap items-center gap-2 border border-gray-200 rounded-lg px-2.5 py-2 dark:border-gray-700">
                  <span class="text-xs text-gray-600 dark:text-gray-300">
                    背包牧草 {{ formatQuantity(detailOf(friend.gid)!.grassAvailable) }}
                  </span>
                  <BaseInput
                    v-model.number="grassInputs[friend.gid]"
                    type="number"
                    :min="1"
                    :max="grassLimitOf(detailOf(friend.gid)) || 1"
                    class="w-24"
                    :disabled="!grassLimitOf(detailOf(friend.gid))"
                  />
                  <BaseButton
                    variant="primary"
                    size="sm"
                    :disabled="!grassLimitOf(detailOf(friend.gid))"
                    @click="requestGrass(friend.gid, friend.name)"
                  >
                    赠送牧草
                  </BaseButton>
                  <span v-if="!detailOf(friend.gid)!.feedMachine" class="text-[11px] text-gray-400">
                    对方还没有可用的牧草机
                  </span>
                  <span v-else-if="grassRoomOf(detailOf(friend.gid)) <= 0" class="text-[11px] text-gray-400">
                    对方牧草机已满
                  </span>
                  <span v-else-if="!grassLimitOf(detailOf(friend.gid))" class="text-[11px] text-gray-400">
                    背包牧草不足
                  </span>
                  <span v-else class="text-[11px] text-gray-400">
                    最多可送 {{ formatQuantity(String(grassLimitOf(detailOf(friend.gid)))) }} 份
                  </span>
                  <BaseButton
                    variant="secondary"
                    size="sm"
                    :disabled="!detailOf(friend.gid)!.cleanableHazards"
                    @click="requestClean(friend.gid, friend.name)"
                  >
                    一键清理 {{ detailOf(friend.gid)!.cleanableHazards ? `(${detailOf(friend.gid)!.cleanableHazards})` : '' }}
                  </BaseButton>
                  <BaseButton
                    variant="secondary"
                    size="sm"
                    :disabled="!detailOf(friend.gid)!.canSteal"
                    @click="requestSteal(friend.gid, friend.name)"
                  >
                    一键偷取
                  </BaseButton>
                </div>

                <div v-if="!detailOf(friend.gid)!.ranches.length" class="border border-gray-200 rounded-lg border-dashed px-6 py-6 text-center text-sm text-gray-500 dark:border-gray-700">
                  该好友尚未建造窝或棚。
                </div>

                <div class="grid gap-3 lg:grid-cols-2">
                  <div
                    v-for="row in detailOf(friend.gid)!.ranches"
                    :key="row.id"
                    class="border border-gray-200 rounded-lg p-3 dark:border-gray-700"
                  >
                    <div class="flex items-center gap-2">
                      <span class="i-fa-solid-paw h-4 w-4 shrink-0" :style="{ color: 'var(--theme-primary)' }" />
                      <p class="min-w-0 flex-1 truncate text-sm font-medium">
                        {{ row.name }}
                      </p>
                      <span class="shrink-0 rounded bg-gray-50 px-1.5 py-0.5 text-[11px] text-gray-600 dark:bg-gray-900/40 dark:text-gray-300">
                        蚊子 {{ row.mosquitoes }} / {{ row.mosquitoLimit || '未配置' }}
                      </span>
                      <BaseButton
                        variant="outline"
                        size="sm"
                        :disabled="!(row.mosquitoRoom > 0) || detailOf(friend.gid)!.mosquitoRemaining === 0"
                        @click="requestMosquito(friend.gid, friend.name, row.id, row.name)"
                      >
                        放蚊子
                      </BaseButton>
                    </div>

                    <div v-if="row.animals.length" class="grid grid-cols-[repeat(auto-fill,minmax(116px,1fr))] mt-2.5 gap-2">
                      <div
                        v-for="animal in row.animals"
                        :key="`${row.id}-${animal.id}`"
                        class="border border-gray-200 rounded-lg px-2 py-1.5 dark:border-gray-700"
                      >
                        <p class="truncate text-xs font-medium">
                          {{ animal.name }}
                        </p>
                        <p class="truncate text-[11px] text-gray-500">
                          {{ animal.stageName }} · 产物 {{ formatQuantity(animal.produceCount) }}
                        </p>
                        <BaseButton
                          variant="secondary"
                          size="sm"
                          class="mt-1.5 w-full"
                          :disabled="!animal.canStroke || animal.stroked || detailOf(friend.gid)!.strokeRemaining === 0"
                          @click="requestStroke(friend.gid, friend.name, row.id, animal.id, animal.name)"
                        >
                          {{ animal.stroked ? '今日已抚摸' : '抚摸' }}
                        </BaseButton>
                      </div>
                    </div>
                    <p v-else class="mt-2 text-xs text-gray-500">
                      {{ row.name }}里暂时没有动物。
                    </p>
                  </div>
                </div>

                <div class="border border-gray-200 rounded-lg p-3 dark:border-gray-700">
                  <div class="flex items-center gap-2">
                    <span class="i-carbon-shopping-bag h-4 w-4 shrink-0 text-amber-500" />
                    <p class="min-w-0 flex-1 truncate text-sm font-medium">
                      货架产物
                    </p>
                    <span class="shrink-0 rounded bg-gray-50 px-1.5 py-0.5 text-[11px] text-gray-600 dark:bg-gray-900/40 dark:text-gray-300">
                      可偷 {{ detailOf(friend.gid)!.stealableShelves }} 个
                    </span>
                  </div>
                  <div
                    v-for="row in detailOf(friend.gid)!.ranches"
                    :key="`shelf-${row.id}`"
                    class="mt-2 space-y-1.5"
                  >
                    <div
                      v-for="shelf in row.shelves"
                      :key="`${row.id}-${shelf.slot}`"
                      class="flex items-center gap-2 rounded-lg bg-gray-50 px-2 py-1.5 text-xs dark:bg-gray-900/40"
                    >
                      <span class="shrink-0 text-gray-500">{{ row.name }} 架 {{ shelf.slot }}</span>
                      <span class="min-w-0 flex-1 truncate text-gray-600 dark:text-gray-300">{{ shelfText(shelf) }}</span>
                      <span
                        v-if="shelf.canSteal"
                        class="shrink-0 rounded bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
                      >
                        可偷
                      </span>
                    </div>
                  </div>
                  <p v-if="!detailOf(friend.gid)!.ranches.some(row => row.shelves.length)" class="mt-2 text-xs text-gray-500">
                    好友的货架上暂时没有产物。
                  </p>
                </div>
              </template>
            </div>
          </div>
        </div>
      </template>
    </template>
  </div>
</template>
