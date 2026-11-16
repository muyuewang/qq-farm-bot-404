<script setup lang="ts">
import { computed, ref, useAttrs, useId } from 'vue'

const props = defineProps<{
  type?: string
  placeholder?: string
  id?: string
  error?: string
  hint?: string
  label?: string
  disabled?: boolean
  clearable?: boolean
  min?: string | number
  max?: string | number
  step?: string | number
}>()
const emit = defineEmits<{
  (e: 'clear'): void
}>()
defineOptions({ inheritAttrs: false })
const attrs = useAttrs()
const generatedId = useId()
function controlAttrs() {
  return Object.fromEntries(Object.entries(attrs).filter(([key]) => key !== 'class' && key !== 'style'))
}
const fieldId = computed(() => props.id || generatedId)
const [model, modelModifiers] = defineModel<string | number>()
const showPassword = ref(false)
const inputType = computed(() => {
  if (props.type === 'password' && showPassword.value) {
    return 'text'
  }
  return props.type || 'text'
})

function updateModel(event: Event) {
  const value = (event.target as HTMLInputElement).value
  model.value = (props.type === 'number' || modelModifiers.number) && value !== ''
    ? Number(value)
    : value
}
</script>

<template>
  <div class="flex flex-col gap-1.5" :class="attrs.class" :style="attrs.style as any">
    <label v-if="label" :for="fieldId" class="text-sm text-gray-700 font-medium dark:text-gray-300">
      {{ label }}
    </label>
    <div class="relative">
      <input
        v-bind="controlAttrs()"
        :id="fieldId"
        :aria-invalid="error ? true : undefined"
        :aria-describedby="[attrs['aria-describedby'], error || hint ? `${fieldId}-feedback` : undefined].filter(Boolean).join(' ') || undefined"
        :value="model"
        :type="inputType"
        :placeholder="placeholder"
        :disabled="disabled"
        :min="min"
        :max="max"
        :step="step"
        class="base-input w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none transition-colors duration-150 dark:border-gray-700 disabled:bg-gray-50 dark:text-white disabled:text-gray-400 focus:ring-2 dark:disabled:bg-gray-800/50"
        :class="{ 'pr-10': type === 'password' || (clearable && model) }"
        @input="updateModel"
      >
      <button
        v-if="type === 'password'"
        :aria-label="showPassword ? '隐藏密码' : '显示密码'"
        :aria-pressed="showPassword"
        type="button"
        :disabled="disabled"
        class="absolute right-0 top-1/2 h-11 w-11 flex items-center justify-center text-gray-500 -translate-y-1/2 hover:text-gray-600 dark:hover:text-gray-300"
        @click="showPassword = !showPassword"
      >
        <div v-if="showPassword" class="i-carbon-view-off" />
        <div v-else class="i-carbon-view" />
      </button>

      <button
        v-else-if="clearable && model"
        aria-label="清空输入"
        type="button"
        :disabled="disabled"
        class="absolute right-0 top-1/2 h-11 w-11 flex items-center justify-center text-gray-500 -translate-y-1/2 hover:text-gray-600 dark:hover:text-gray-300"
        @click="model = ''; emit('clear')"
      >
        <div class="i-carbon-close" />
      </button>
    </div>
    <p v-if="error || hint" :id="`${fieldId}-feedback`" :role="error ? 'alert' : undefined" class="text-sm" :class="error ? 'text-red-600 dark:text-red-400' : 'text-gray-600 dark:text-gray-300'">
      {{ error || hint }}
    </p>
  </div>
</template>

<style scoped>
.base-input::-ms-reveal,
.base-input::-ms-clear {
  display: none;
}

.base-input {
  background: var(--input-bg);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.28);
}

.base-input:focus {
  border-color: var(--theme-primary);
  box-shadow:
    0 0 0 3px color-mix(in srgb, var(--theme-primary) 18%, transparent),
    inset 0 1px 0 rgba(255, 255, 255, 0.32);
}
</style>
