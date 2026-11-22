<script setup lang="ts">
import type { RanchCareer } from '@/utils/ranch'
import { computed } from 'vue'
import { formatQuantity } from '@/utils/ranch'

/**
 * 牧场生涯。
 *
 * 数据来自生涯接口的 ranch 段（core/src/services/career.ts），只有 overview 视图会带。
 * 三个累计数是服务端长期累计值，不是本次会话统计，所以不加「今日」之类的措辞。
 */
const props = defineProps<{ career: RanchCareer }>()

const metrics = computed(() => [
  { key: 'harvest', label: '累计收获', icon: 'i-carbon-crop-growth', value: formatQuantity(props.career.harvest) },
  { key: 'mature', label: '培养成熟', icon: 'i-carbon-growth', value: formatQuantity(props.career.mature) },
  { key: 'steal', label: '累计偷取', icon: 'i-carbon-shopping-bag', value: formatQuantity(props.career.steal) },
])

/** 产物排行：count 是十进制字符串，可能超出安全整数，必须用 BigInt 比较。 */
const ranking = computed(() => [...props.career.products]
  .sort((left, right) => {
    const a = BigInt(/^-?\d+$/.test(left.count) ? left.count : '0')
    const b = BigInt(/^-?\d+$/.test(right.count) ? right.count : '0')
    return a === b ? 0 : (a > b ? -1 : 1)
  })
  .slice(0, 4))
</script>

<template>
  <div class="ui-card metric-card flex flex-col rounded-lg p-5">
    <div class="mb-3 flex items-center gap-1.5 text-sm text-gray-500">
      <div class="i-carbon-trophy" />
      牧场生涯
    </div>

    <div class="grid grid-cols-3 gap-3">
      <div v-for="metric in metrics" :key="metric.key" class="min-w-0">
        <div class="flex items-center gap-1.5 text-xs text-gray-500">
          <div class="shrink-0 text-base" :class="metric.icon" />
          <span class="truncate">{{ metric.label }}</span>
        </div>
        <div class="truncate text-xl font-bold tabular-nums" :title="metric.value">
          {{ metric.value }}
        </div>
      </div>
    </div>

    <div v-if="ranking.length" class="mt-3 border-t border-gray-100 pt-3 dark:border-gray-700">
      <p class="mb-1.5 text-xs text-gray-500">
        产物累计
      </p>
      <ul class="text-xs space-y-1">
        <li v-for="product in ranking" :key="product.id" class="flex items-center justify-between gap-2">
          <span class="min-w-0 truncate" :title="product.name">{{ product.name }}</span>
          <b class="shrink-0 tabular-nums">{{ formatQuantity(product.count) }}</b>
        </li>
      </ul>
    </div>
  </div>
</template>
