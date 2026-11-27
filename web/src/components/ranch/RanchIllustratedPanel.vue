<script setup lang="ts">
import type { RanchRequest, RanchState } from '@/utils/ranch'
import { storeToRefs } from 'pinia'
import { computed, ref } from 'vue'
import api from '@/api'
import BaseButton from '@/components/ui/BaseButton.vue'
import { useAccountStore } from '@/stores/account'
import { useToastStore } from '@/stores/toast'
import { formatQuantity, itemListLine } from '@/utils/ranch'

const props = defineProps<{ state: RanchState | null }>()

const emit = defineEmits<{ request: [payload: RanchRequest] }>()

const { currentAccountId } = storeToRefs(useAccountStore())
const toast = useToastStore()

const TABS = [
  { value: 'animals', label: '动物图鉴' },
  { value: 'giant', label: '巨大图鉴' },
  { value: 'reward', label: '图鉴奖励' },
  { value: 'mutation', label: '变异规则' },
] as const

const tab = ref<'animals' | 'giant' | 'reward' | 'mutation'>('animals')

const book = computed(() => props.state?.book ?? null)
const animals = computed(() => book.value?.animals || [])
const mutations = computed(() => book.value?.mutations || [])
const giantLevels = computed(() => book.value?.giant.levels || [])
const normal = computed(() => book.value?.normal ?? null)
const giant = computed(() => book.value?.giant ?? null)
const giantClaimable = computed(() => giantLevels.value.filter(level => level.canClaim))
const unlockedCount = computed(() => animals.value.filter(animal => animal.unlocked).length)
// 巨大图鉴按巨大产物单独成条目：图标与名称都取 giantItem，进度/解锁状态沿用所属动物。
// 后端在巨大产物与普通产物共用同一张图时会清空 giantItem.image，这里按缺图降级。
const giantEntries = computed(() => animals.value
  .filter(animal => animal.giantItem)
  .map(animal => ({ ...animal, ...animal.giantItem, giantItem: undefined })))
const giantUnlockedCount = computed(() => giantEntries.value.filter(entry => entry.unlocked).length)
// 「全部已读」只针对巨大图鉴的未读条目：后端按 fruit_id 清除，未读标记在所属动物的 giant 上。
const freshGiantIds = computed(() => animals.value
  .filter(animal => animal.giantItem && animal.giant?.isNew)
  .map(animal => Number(animal.id) || 0)
  .filter(id => id > 0))
const clearing = ref(false)

function claimNormal() {
  emit('request', {
    action: 'claimIllustrated',
    input: { kind: 'normal' },
    title: '领取图鉴等级奖励',
    note: '服务端按当前图鉴进度结算所有可领等级，重复领取会被判为无需执行。',
  })
}

function claimGiant() {
  emit('request', {
    action: 'claimIllustrated',
    input: { kind: 'giant' },
    title: `领取巨大化重量积分奖励（${giantClaimable.value.length} 档）`,
    note: '逐档领取巨大变异重量积分奖励，只领取服务端标记为可领取的档位。',
  })
}

/**
 * 巨大图鉴「全部已读」：交给后端按牧场图鉴列表自行收集未读项并逐条上报。
 * 该接口不接受 fruitIds，且要等回读确认，所以单独放宽超时；
 * 回包只带被服务端确认清除的 id，这里按 cleared 精确改本地标记，而不是整体清空。
 */
async function clearGiantNew() {
  const accountId = String(currentAccountId.value || '')
  if (clearing.value || !accountId)
    return
  if (!freshGiantIds.value.length) {
    toast.warning('没有未读的巨大图鉴')
    return
  }
  clearing.value = true
  try {
    const { data } = await api.post('/api/ranch/illustrated/clear-new', {}, {
      headers: { 'x-account-id': accountId },
      skipErrorToast: true,
      // 后端要逐条上报再回读确认，比普通牧场请求慢得多。
      timeout: 45_000,
    } as any)
    if (!data?.ok)
      throw new Error(data?.error || '清除巨大图鉴已读失败')
    const cleared: number[] = Array.isArray(data?.data?.cleared) ? data.data.cleared.map((id: any) => Number(id)) : []
    const notice: string = String(data?.data?.notice || '')
    if (cleared.length) {
      const done = new Set(cleared)
      for (const animal of animals.value) {
        if (done.has(Number(animal.id)) && animal.giant)
          animal.giant.isNew = false
      }
      // 后端可能只确认了部分条目，此时它是 warning 性质的提示，不能一律当成功。
      if (/未确认/.test(notice))
        toast.warning(notice)
      else
        toast.success(notice || `已读 ${cleared.length} 条巨大图鉴`)
    }
    else {
      toast.warning(notice || '没有未读的巨大图鉴')
    }
  }
  catch (cause: any) {
    toast.error(cause?.response?.data?.error || cause?.message || '清除巨大图鉴已读失败')
  }
  finally {
    clearing.value = false
  }
}

function giantText(animal: any) {
  const giant = animal.giant
  if (!giant)
    return ''
  const range = giant.maxWeightKg ? ` · 区间 ${giant.minWeightKg}~${giant.maxWeightKg} kg` : ''
  return `最佳 ${giant.weightKg} kg${giant.tierName ? ` · ${giant.tierName}` : ''}${range} · 收获 ${formatQuantity(giant.harvestCount)} 次`
}
</script>

<template>
  <div class="space-y-3">
    <div v-if="!state?.book" class="border border-gray-200 rounded-lg border-dashed px-6 py-10 text-center text-sm text-gray-500 dark:border-gray-700">
      牧场图鉴数据未下发，请点击刷新重新读取。
    </div>

    <template v-else>
      <div class="flex flex-wrap items-center gap-2">
        <div class="h-9 inline-flex overflow-hidden border border-gray-200 rounded-lg bg-white p-0.5 dark:border-gray-700 dark:bg-gray-800">
          <button
            v-for="row in TABS"
            :key="row.value"
            class="min-w-24 rounded-md px-3 text-sm font-medium transition"
            :class="tab === row.value ? 'text-white shadow-sm' : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700'"
            :style="tab === row.value ? { backgroundColor: 'var(--theme-primary)' } : {}"
            @click="tab = row.value"
          >
            {{ row.label }}
          </button>
        </div>
        <span class="rounded-lg bg-gray-50 px-3 py-1.5 text-xs text-gray-600 dark:bg-gray-900/40 dark:text-gray-300">
          <template v-if="tab === 'giant'">已收录 {{ giantUnlockedCount }} / {{ giantEntries.length }} 种巨大化</template>
          <template v-else>已收录 {{ unlockedCount }} / {{ animals.length }} 种</template>
        </span>
        <BaseButton
          v-if="tab === 'giant'"
          variant="outline"
          size="sm"
          :loading="clearing"
          :disabled="!freshGiantIds.length || !currentAccountId"
          @click="clearGiantNew"
        >
          全部已读<span v-if="freshGiantIds.length" class="ml-1">（{{ freshGiantIds.length }}）</span>
        </BaseButton>
      </div>

      <template v-if="tab === 'reward'">
        <div class="grid gap-3 lg:grid-cols-2">
          <div class="border border-gray-200 rounded-xl bg-white p-3 shadow-sm dark:border-gray-700 dark:bg-gray-800">
            <div class="flex items-start justify-between gap-2">
              <div>
                <p class="text-sm font-medium">
                  普通图鉴 · Lv.{{ normal?.level }}
                </p>
                <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                  收集进度 {{ formatQuantity(normal?.progress ?? "0") }} / 下一级 {{ formatQuantity(normal?.nextProgress ?? "0") }}
                </p>
              </div>
              <BaseButton variant="primary" size="sm" :disabled="!normal?.canClaim" @click="claimNormal">
                领取
              </BaseButton>
            </div>
            <div class="mt-2 flex flex-wrap items-center gap-1.5">
              <img v-if="normal?.rewards[0]?.image" :src="normal?.rewards[0]?.image" :alt="normal?.rewards[0]?.name" class="h-5 w-5 rounded object-contain">
              <span class="truncate text-xs text-gray-500 dark:text-gray-400">
                本次可领奖励 {{ itemListLine(normal?.rewards) }}
              </span>
            </div>
          </div>

          <div class="border border-gray-200 rounded-xl bg-white p-3 shadow-sm dark:border-gray-700 dark:bg-gray-800">
            <div class="flex items-start justify-between gap-2">
              <div>
                <p class="text-sm font-medium">
                  巨大化重量积分 · {{ formatQuantity(giant?.score ?? "0") }}
                </p>
                <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                  计分模式取值 {{ giant?.calculationMode ?? "未下发" }}（服务端未提供该字段释义，此处原样展示）
                </p>
              </div>
              <BaseButton variant="primary" size="sm" :disabled="!giantClaimable.length" @click="claimGiant">
                领取 {{ giantClaimable.length }} 档
              </BaseButton>
            </div>

            <div class="mt-3 space-y-1.5">
              <div
                v-for="level in giantLevels"
                :key="level.id"
                class="flex items-center gap-2 rounded-lg bg-gray-50 px-2 py-1.5 text-xs dark:bg-gray-900/40"
              >
                <span class="shrink-0 font-medium">需 {{ formatQuantity(level.score) }} 分</span>
                <span class="min-w-0 flex-1 truncate text-gray-500 dark:text-gray-400">{{ itemListLine(level.rewards) }}</span>
                <span
                  class="shrink-0 rounded px-1.5 py-0.5 text-[11px]"
                  :class="level.claimed ? 'bg-gray-100 text-gray-500 dark:bg-gray-700' : (level.canClaim ? 'bg-green-50 text-green-700 dark:bg-green-950/40 dark:text-green-300' : 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300')"
                >
                  {{ level.claimed ? '已领取' : (level.canClaim ? '可领取' : '未达标') }}
                </span>
              </div>
              <p v-if="!giantLevels.length" class="text-xs text-gray-500">
                服务端未下发巨大化档位。
              </p>
            </div>
          </div>
        </div>
      </template>

      <template v-else-if="tab === 'giant'">
        <div v-if="!giantEntries.length" class="border border-gray-200 rounded-lg border-dashed px-6 py-8 text-center text-sm text-gray-500 dark:border-gray-700">
          服务端未下发巨大化产物条目。
        </div>
        <div class="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
          <div
            v-for="entry in giantEntries"
            :key="entry.id"
            class="border border-gray-200 rounded-xl bg-white p-3 shadow-sm dark:border-gray-700 dark:bg-gray-800"
            :class="entry.unlocked ? '' : 'opacity-60'"
          >
            <div class="flex items-start gap-2">
              <img v-if="entry.image" :src="entry.image" :alt="entry.name" class="h-10 w-10 shrink-0 rounded object-contain">
              <div v-else class="i-fas-star h-10 w-10 shrink-0 text-xl text-gray-300" />
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-medium">
                  {{ entry.name }}
                </p>
                <p class="mt-0.5 truncate text-[11px] text-gray-500">
                  巨大化产物 · 进度 {{ formatQuantity(entry.progress) }}
                </p>
              </div>
              <span v-if="entry.giant?.isNew" class="shrink-0 rounded bg-blue-50 px-1.5 py-0.5 text-[10px] text-blue-600 dark:bg-blue-950/40 dark:text-blue-300">NEW</span>
            </div>
            <p class="mt-2 truncate text-[11px] text-gray-500 dark:text-gray-400">
              {{ entry.unlocked ? (entry.giant ? giantText(entry) : '已获得巨大化个体') : '未收录' }}
            </p>
            <div v-if="entry.giant" class="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
              <span class="rounded bg-purple-50 px-1.5 py-0.5 text-purple-600 dark:bg-purple-950/40 dark:text-purple-300">
                {{ entry.giant.unlocked ? `巨大化 ${entry.giant.tierName || `T${entry.giant.tier}`}` : '巨大化未解锁' }}
              </span>
            </div>
          </div>
        </div>
      </template>

      <template v-else-if="tab === 'mutation'">
        <div v-if="!mutations.length" class="border border-gray-200 rounded-lg border-dashed px-6 py-8 text-center text-sm text-gray-500 dark:border-gray-700">
          暂无变异规则配置。
        </div>
        <div class="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3">
          <div
            v-for="row in mutations"
            :key="row.type"
            class="border border-gray-200 rounded-xl bg-white p-3 shadow-sm dark:border-gray-700 dark:bg-gray-800"
          >
            <div class="flex items-center justify-between gap-2">
              <p class="truncate text-sm font-medium">
                {{ row.name }}
              </p>
              <span class="shrink-0 rounded bg-gray-50 px-1.5 py-0.5 text-[11px] text-gray-600 dark:bg-gray-900/40 dark:text-gray-300">
                基础概率 {{ row.baseProbabilityPercent }}%
              </span>
            </div>
            <p class="mt-1 text-xs text-gray-500 leading-5 dark:text-gray-400">
              {{ row.description || '服务端未提供该变异的说明文案' }}
            </p>
          </div>
        </div>
      </template>

      <template v-else>
        <div v-if="!animals.length" class="border border-gray-200 rounded-lg border-dashed px-6 py-8 text-center text-sm text-gray-500 dark:border-gray-700">
          图鉴列表为空。
        </div>
        <div class="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
          <div
            v-for="animal in animals"
            :key="animal.id"
            class="border border-gray-200 rounded-xl bg-white p-3 shadow-sm dark:border-gray-700 dark:bg-gray-800"
            :class="animal.unlocked ? '' : 'opacity-60'"
          >
            <div class="flex items-start gap-2">
              <img v-if="animal.image" :src="animal.image" :alt="animal.name" class="h-10 w-10 shrink-0 rounded object-contain">
              <div v-else class="i-fas-paw h-10 w-10 shrink-0 text-xl text-gray-300" />
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-medium">
                  {{ animal.name }}
                </p>
                <p class="mt-0.5 truncate text-[11px] text-gray-500">
                  稀有度 {{ animal.rarity }} · 层级 {{ animal.layer }} · 进度 {{ formatQuantity(animal.progress) }}
                </p>
              </div>
              <span v-if="animal.giant?.isNew" class="shrink-0 rounded bg-blue-50 px-1.5 py-0.5 text-[10px] text-blue-600 dark:bg-blue-950/40 dark:text-blue-300">NEW</span>
            </div>
            <p class="mt-2 truncate text-[11px] text-gray-500 dark:text-gray-400">
              {{ animal.unlocked ? (animal.giant ? giantText(animal) : '尚未获得巨大化个体') : '未收录' }}
            </p>
            <div v-if="animal.giant" class="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
              <span class="rounded bg-purple-50 px-1.5 py-0.5 text-purple-600 dark:bg-purple-950/40 dark:text-purple-300">
                {{ animal.giant.unlocked ? `巨大化 ${animal.giant.tierName || `T${animal.giant.tier}`}` : '巨大化未解锁' }}
              </span>
            </div>
          </div>
        </div>
      </template>
    </template>
  </div>
</template>
