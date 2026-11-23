<script setup lang="ts">
import type { RanchAnimal, RanchDirectRequest, RanchFeedStage, RanchResource, RanchState } from '@/utils/ranch'
import { computed, ref } from 'vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import BaseSwitch from '@/components/ui/BaseSwitch.vue'
import { bucketSeconds, formatSeconds, RANCH_BUCKET_IDS, RANCH_BUCKET_TYPES, RANCH_FEED_STAGE_HINTS, RANCH_FEED_STAGE_LABELS, RANCH_FEED_STAGE_OPTIONS } from '@/utils/ranch'

/**
 * 牧场喂养菜单。
 *
 * 喂养按桶类型分两套判据：有限制罐头（limitedCanUsed）的动物只能用有机罐头，
 * 后端 feed 的 eligible 就是 `bucketType === 1 || !limited_can_used`，所以这里选桶类型
 * 之后必须重新算一遍可喂数量和空桶提示，不能直接复用单个动物动作的 enabled。
 *
 * 「喂养并生产」对应后端的 input.produceAfterFeed：只对有动物喂完当轮进入可生产的
 * 情况才发起催产，并且会复用同一场景，不会额外开一次牧场。默认关闭，因为它会连带
 * 改动动物状态。
 */
const props = defineProps<{
  state: RanchState | null
  /** 自动化配置里的罐头时机默认值，进来时同步一次，用户改这里不回写配置。 */
  defaultNormalStage?: RanchFeedStage
  defaultOrganicStage?: RanchFeedStage
}>()

const emit = defineEmits<{
  direct: [payload: RanchDirectRequest]
}>()

type BucketKind = 'normal' | 'organic'

const bucketKind = ref<BucketKind>('normal')
// 两种罐头各自记自己的时机，切换类型不会把已选的值冲掉。
const normalStage = ref<RanchFeedStage>(props.defaultNormalStage ?? 'longest')
const organicStage = ref<RanchFeedStage>(props.defaultOrganicStage ?? 'near_harvest')
const feedStage = computed<RanchFeedStage>({
  get: () => bucketKind.value === 'organic' ? organicStage.value : normalStage.value,
  set: (value) => {
    if (bucketKind.value === 'organic')
      organicStage.value = value
    else
      normalStage.value = value
  },
})
const produceAfterFeed = ref(false)

const BUCKET_OPTIONS: Array<{ value: BucketKind, label: string }> = [
  { value: 'normal', label: '普通罐头' },
  { value: 'organic', label: '有机罐头' },
]

const resources = computed<RanchResource[]>(() => props.state?.resources || [])

/** 只有带栏舍的设施能出动物；窝与棚都要算进来，按设施分组便于限定范围。 */
const ranches = computed(() => (props.state?.facilities || []).filter(facility => facility.isRanch && facility.ranch))

const facilityId = ref<string>('all')

const allAnimals = computed<RanchAnimal[]>(() => ranches.value.flatMap(facility => facility.ranch?.animals || []))

const facilityOptions = computed(() => [
  { value: 'all', label: `全部栏舍（${allAnimals.value.length} 只）` },
  ...ranches.value.map(facility => ({
    value: facility.id,
    label: `${facility.name}（${facility.ranch?.animals.length || 0} 只）`,
  })),
])

/** 当前范围下的动物：选「全部」就是所有栏舍，否则只取该设施。 */
const scopedAnimals = computed<RanchAnimal[]>(() => {
  if (facilityId.value === 'all')
    return allAnimals.value
  return ranches.value.find(facility => facility.id === facilityId.value)?.ranch?.animals || []
})

const bucketType = computed(() => bucketKind.value === 'organic' ? RANCH_BUCKET_TYPES.organic : RANCH_BUCKET_TYPES.normal)
const bucketId = computed(() => bucketKind.value === 'organic' ? RANCH_BUCKET_IDS.organic : RANCH_BUCKET_IDS.normal)
const bucketRemaining = computed(() => bucketSeconds(resources.value, bucketId.value))
const bucketLabel = computed(() => bucketKind.value === 'organic' ? '有机' : '普通')

/**
 * 可喂动物：只按后端显式下发的布尔位判定。
 *
 * 有限制罐头（limitedCanUsed）的动物只能用有机桶，这是后端 feed 的 eligible 判据
 * （bucketType === 1 || !limited_can_used），前端必须复现一遍，否则「喂养 N 只」
 * 的数字会和后端实际喂的对不上。
 *
 * 时机筛选不做前端复现：阶段时长与收获时间点都不在前端 DTO 里，
 * 猜出来的结果只会和真实结果不一致。数量按可喂总数显示，实际喂几只由后端回包决定。
 */
const feedable = computed(() => scopedAnimals.value.filter((animal) => {
  if (animal.canFeed !== true)
    return false
  if (bucketType.value === RANCH_BUCKET_TYPES.normal && animal.limitedCanUsed)
    return false
  return true
}))

/** 被限制罐头挡掉的动物数，用于解释「为什么选了普通罐头数量变少」。 */
const limitedBlocked = computed(() => scopedAnimals.value
  .filter(animal => animal.canFeed === true && animal.limitedCanUsed && bucketType.value === RANCH_BUCKET_TYPES.normal)
  .length)

const busy = computed(() => props.state === null)
const bucketEmpty = computed(() => bucketRemaining.value <= 0n)

const feedHint = computed(() => {
  if (bucketEmpty.value)
    return `${bucketLabel.value}罐头桶为空，请先在罐头商城购买并在背包里加入罐头桶`
  if (!feedable.value.length)
    return '当前没有可喂养的动物'
  return ''
})

/** 时机只影响后端挑哪几只，前端说明清楚即可，不假装能算出具体数量。 */
const stageHint = computed(() => RANCH_FEED_STAGE_HINTS[feedStage.value])

const produceHint = computed(() => produceAfterFeed.value
  ? '喂养成功后会紧接着对本次喂过、且已可生产的动物发起催产；催产失败不影响喂养结果，会单独提示。'
  : '只扣除罐头，不额外改动动物状态。')

function submit() {
  if (!feedable.value.length)
    return
  const input: Record<string, any> = { bucketType: bucketType.value }
  // 范围优先：选了单个栏舍就带 ranchId，否则让后端按 all 自己挑，前端不复制筛选条件。
  if (facilityId.value === 'all')
    input.all = true
  else
    input.ranchId = facilityId.value
  // 时机按桶类型分别下发：后端普通桶读 normalStage，有机桶读 organicStage。
  if (feedStage.value !== 'any')
    input[bucketKind.value === 'organic' ? 'organicStage' : 'normalStage'] = feedStage.value
  if (produceAfterFeed.value)
    input.produceAfterFeed = true
  const stageText = feedStage.value === 'any' ? '' : `（${RANCH_FEED_STAGE_LABELS[feedStage.value]}）`
  emit('direct', {
    action: 'feed',
    input,
    title: `使用${bucketLabel.value}罐头喂养${stageText}`,
  })
}
</script>

<template>
  <div class="border border-gray-200 rounded-xl bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <h2 class="text-sm font-semibold">
        罐头喂养
      </h2>
      <span class="rounded-lg bg-gray-50 px-2.5 py-1 text-xs text-gray-600 dark:bg-gray-900/40 dark:text-gray-300">
        {{ bucketLabel }}罐头桶剩余 {{ formatSeconds(bucketRemaining) }}
      </span>
    </div>

    <div class="grid mt-3 gap-2 sm:grid-cols-2">
      <BaseSelect v-model="bucketKind" label="罐头类型" :options="BUCKET_OPTIONS" :disabled="busy" />
      <BaseSelect v-model="facilityId" label="喂养范围" :options="facilityOptions" :disabled="busy" />
    </div>

    <div class="mt-3">
      <BaseSelect v-model="feedStage" :label="`${bucketLabel}罐头使用时机`" :options="RANCH_FEED_STAGE_OPTIONS" :disabled="busy" />
      <p class="mt-1 text-xs" :style="{ color: 'var(--muted-text)' }">
        {{ stageHint }}
      </p>
    </div>

    <div class="mt-3">
      <BaseSwitch v-model="produceAfterFeed" label="喂养后顺带催产" :disabled="busy" />
      <p class="mt-1 text-xs" :style="{ color: 'var(--muted-text)' }">
        {{ produceHint }}
      </p>
    </div>

    <div class="mt-4 flex flex-wrap items-center gap-2">
      <BaseButton
        variant="primary"
        size="sm"
        :disabled="busy || !feedable.length || bucketEmpty"
        :title="feedHint || '开始喂养'"
        @click="submit"
      >
        喂养 {{ feedable.length }} 只
      </BaseButton>
      <span v-if="limitedBlocked && bucketKind === 'normal'" class="rounded bg-blue-50 px-2 py-0.5 text-[11px] text-blue-600 dark:bg-blue-950/40 dark:text-blue-300">
        {{ limitedBlocked }} 只仅限有机罐头，已排除
      </span>
      <span v-if="feedHint" class="text-xs text-amber-600 dark:text-amber-400">
        {{ feedHint }}
      </span>
    </div>
  </div>
</template>
