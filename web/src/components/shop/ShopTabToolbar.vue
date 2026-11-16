<script setup lang="ts">
import BaseButton from '@/components/ui/BaseButton.vue'

type ShopTab = 'seed' | 'pet' | 'decoration' | 'mall' | 'mystery'

defineProps<{
  tab: ShopTab
  ascending: boolean
  loading: boolean
  disabled: boolean
}>()

const emit = defineEmits<{
  (e: 'update:tab', value: ShopTab): void
  (e: 'toggleAscending'): void
  (e: 'refresh'): void
}>()

const L = {
  seed: '\u79CD\u5B50\u5546\u5E97',
  pet: '\u5BA0\u7269\u5546\u5E97',
  decoration: '\u88C5\u626E\u5546\u5E97',
  mall: '\u9053\u5177\u5546\u5E97',
  mystery: '\u795E\u79D8\u5546\u4EBA',
  asc: '\u7B49\u7EA7\u5347\u5E8F',
  desc: '\u7B49\u7EA7\u964D\u5E8F',
  sort: '\u6392\u5E8F',
  refresh: '\u5237\u65B0',
}

const tabs: Array<{ value: ShopTab, label: string }> = [
  { value: 'seed', label: L.seed },
  { value: 'pet', label: L.pet },
  { value: 'decoration', label: L.decoration },
  { value: 'mall', label: L.mall },
  { value: 'mystery', label: L.mystery },
]

function tabClasses(active: boolean) {
  return active
    ? 'text-white shadow-sm'
    : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700'
}
</script>

<template>
  <div class="min-w-0 w-full flex flex-wrap items-center gap-2 xl:w-auto xl:justify-end">
    <div class="max-w-full min-w-0 w-full flex-none overflow-x-auto pb-1 xl:w-auto">
      <div class="h-9 min-w-max inline-flex overflow-hidden border border-gray-200 rounded-lg bg-white p-0.5 dark:border-gray-700 dark:bg-gray-800">
        <button
          v-for="item in tabs"
          :key="item.value"
          class="min-w-20 shrink-0 rounded-md px-3 text-sm font-medium transition"
          :class="tabClasses(tab === item.value)"
          :style="tab === item.value ? { backgroundColor: 'var(--theme-primary)' } : {}"
          @click="emit('update:tab', item.value)"
        >
          {{ item.label }}
        </button>
      </div>
    </div>

    <BaseButton
      variant="outline"
      :disabled="tab !== 'seed'"
      class="w-28"
      @click="tab === 'seed' && emit('toggleAscending')"
    >
      {{ tab === 'seed' ? (ascending ? L.asc : L.desc) : L.sort }}
    </BaseButton>
    <BaseButton class="w-24" variant="primary" :loading="loading" :disabled="disabled" @click="emit('refresh')">
      {{ L.refresh }}
    </BaseButton>
  </div>
</template>
