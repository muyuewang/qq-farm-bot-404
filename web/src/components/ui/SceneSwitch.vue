<script setup lang="ts">
/**
 * 场景切换段。
 *
 * 农场和牧场是同一个账号下的两个游戏场景（game_scene_id 1 / 2），背包、商店这类子系统
 * 在两边都存在且协议不同：农场走 /api/* 直接读写，牧场要先进场景再 quote → execute。
 * 这里只负责告诉页面用户想看哪个场景，不碰任何请求，具体读取由页面对应的面板负责。
 */
withDefaults(defineProps<{
  modelValue: 'farm' | 'ranch'
  farmLabel?: string
  ranchLabel?: string
  disabled?: boolean
}>(), {
  farmLabel: '农场',
  ranchLabel: '牧场',
  disabled: false,
})

const emit = defineEmits<{ 'update:modelValue': [value: 'farm' | 'ranch'] }>()

const options: Array<{ value: 'farm' | 'ranch', icon: string, labelKey: 'farmLabel' | 'ranchLabel' }> = [
  { value: 'farm', icon: 'i-carbon-sprout', labelKey: 'farmLabel' },
  { value: 'ranch', icon: 'i-carbon-wheat', labelKey: 'ranchLabel' },
]
</script>

<template>
  <div
    class="h-9 inline-flex overflow-hidden border border-gray-200 rounded-lg bg-white p-0.5 dark:border-gray-700 dark:bg-gray-800"
    role="group"
    aria-label="切换游戏场景"
  >
    <button
      v-for="item in options"
      :key="item.value"
      type="button"
      class="min-w-24 rounded-md px-3 text-sm font-medium transition inline-flex items-center justify-center gap-1.5"
      :class="modelValue === item.value
        ? 'text-white shadow-sm'
        : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700'"
      :style="modelValue === item.value ? { backgroundColor: 'var(--theme-primary)' } : {}"
      :disabled="disabled"
      @click="emit('update:modelValue', item.value)"
    >
      <div :class="[item.icon, 'text-base']" />
      <span>{{ item.labelKey === 'farmLabel' ? farmLabel : ranchLabel }}</span>
    </button>
  </div>
</template>
