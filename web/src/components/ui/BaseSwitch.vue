<script setup lang="ts">
import { useAttrs } from 'vue'

defineOptions({ inheritAttrs: false })
defineProps<{
  label?: string
  disabled?: boolean
}>()
const attrs = useAttrs()
const model = defineModel<boolean>()
</script>

<template>
  <label class="min-h-11 inline-flex items-center gap-3" :class="[attrs.class, disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer']" :style="attrs.style as any">
    <div class="relative inline-flex items-center">
      <input v-bind="Object.fromEntries(Object.entries(attrs).filter(([key]) => key !== 'class' && key !== 'style'))" v-model="model" type="checkbox" role="switch" :aria-checked="!!model" class="peer sr-only" :disabled="disabled">
      <div class="base-switch h-6 w-11 rounded-full bg-gray-200 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:border after:border-gray-300 dark:border-gray-600 after:rounded-full after:bg-white dark:bg-gray-700 peer-focus:outline-none peer-focus:ring-2 after:transition-transform after:content-[''] peer-checked:after:translate-x-full peer-checked:after:border-white" />
    </div>
    <span v-if="label" class="select-none text-sm text-gray-700 font-medium dark:text-gray-300">
      {{ label }}
    </span>
  </label>
</template>

<style scoped>
.peer:checked + .base-switch {
  background: var(--theme-primary);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--theme-primary) 14%, transparent);
}
</style>
