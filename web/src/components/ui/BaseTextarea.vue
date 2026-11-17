<script setup lang="ts">
import { computed, useAttrs, useId } from 'vue'

defineOptions({ inheritAttrs: false })
const props = defineProps<{
  placeholder?: string
  id?: string
  error?: string
  hint?: string
  label?: string
  disabled?: boolean
  rows?: number
}>()
const attrs = useAttrs()
const generatedId = useId()
function controlAttrs() {
  return Object.fromEntries(Object.entries(attrs).filter(([key]) => key !== 'class' && key !== 'style'))
}
const fieldId = computed(() => props.id || generatedId)
const model = defineModel<string>()
</script>

<template>
  <div class="flex flex-col gap-1.5" :class="attrs.class" :style="attrs.style as any">
    <label v-if="label" :for="fieldId" class="text-sm text-gray-700 font-medium dark:text-gray-300">
      {{ label }}
    </label>
    <textarea
      v-bind="controlAttrs()"
      :id="fieldId"
      v-model="model"
      :aria-invalid="error ? true : undefined"
      :aria-describedby="[attrs['aria-describedby'], error || hint ? `${fieldId}-feedback` : undefined].filter(Boolean).join(' ') || undefined"
      :rows="rows || 3"
      :placeholder="placeholder"
      :disabled="disabled"
      class="base-textarea w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none transition-colors duration-150 dark:border-gray-700 disabled:bg-gray-50 dark:text-white disabled:text-gray-400 dark:disabled:bg-gray-800/50"
    />
    <p v-if="error || hint" :id="`${fieldId}-feedback`" :role="error ? 'alert' : undefined" class="text-sm" :class="error ? 'text-red-600 dark:text-red-400' : 'text-gray-600 dark:text-gray-300'">
      {{ error || hint }}
    </p>
  </div>
</template>

<style scoped>
.base-textarea {
  background: var(--input-bg);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.28);
}

.base-textarea:focus {
  border-color: var(--theme-primary);
  box-shadow:
    0 0 0 3px color-mix(in srgb, var(--theme-primary) 18%, transparent),
    inset 0 1px 0 rgba(255, 255, 255, 0.32);
}
</style>
