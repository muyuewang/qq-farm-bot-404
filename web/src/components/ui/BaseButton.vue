<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'

const props = defineProps<{
  variant?: 'primary' | 'secondary' | 'danger' | 'success' | 'ghost' | 'outline' | 'text'
  size?: 'sm' | 'md' | 'lg'
  loading?: boolean
  disabled?: boolean
  block?: boolean
  to?: string
  href?: string
  type?: 'button' | 'submit' | 'reset'
}>()

const emit = defineEmits<{
  (e: 'click', event: MouseEvent): void
}>()

const componentTag = computed(() => {
  if (props.to)
    return props.disabled || props.loading ? 'a' : RouterLink
  if (props.href)
    return 'a'
  return 'button'
})

const baseClasses = 'inline-flex items-center justify-center rounded-lg font-medium base-button transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 active:scale-[0.98]'

const variantClasses = computed(() => {
  switch (props.variant) {
    case 'primary':
      return 'text-white shadow-sm hover:brightness-105 focus:ring-[var(--theme-primary)]'
    case 'secondary':
      return 'border border-gray-200 bg-white/70 text-gray-700 shadow-sm hover:bg-gray-50 focus:ring-gray-400 dark:border-gray-700 dark:bg-gray-800/70 dark:text-gray-200 dark:hover:bg-gray-700'
    case 'success':
      return 'bg-green-600 text-white hover:bg-green-700 focus:ring-green-500 shadow-sm dark:bg-green-600 dark:hover:bg-green-500'
    case 'danger':
      return 'bg-red-600 text-white hover:bg-red-700 focus:ring-red-500 shadow-sm dark:bg-red-600 dark:hover:bg-red-500'
    case 'ghost':
      return 'text-gray-600 hover:bg-gray-100/80 dark:text-gray-400 dark:hover:bg-gray-800/80'
    case 'outline':
      return 'border border-gray-200 bg-transparent text-gray-700 hover:bg-gray-50 focus:ring-gray-400 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800'
    case 'text':
      return 'hover:underline p-0 bg-transparent shadow-none hover:bg-transparent'
    default:
      return 'text-white shadow-sm hover:brightness-95 focus:ring-green-500'
  }
})

const sizeClasses = computed(() => {
  if (props.variant === 'text')
    return ''

  switch (props.size) {
    case 'sm':
      return 'px-3 py-1.5 text-sm'
    case 'lg':
      return 'px-6 py-3 text-lg'
    default:
      return 'px-4 py-2 text-sm'
  }
})

const widthClasses = computed(() => props.block ? 'w-full' : '')

const buttonStyle = computed(() => {
  if (props.variant === 'primary' || (!props.variant && props.variant !== 'secondary' && props.variant !== 'danger' && props.variant !== 'success' && props.variant !== 'ghost' && props.variant !== 'outline' && props.variant !== 'text')) {
    return { background: 'var(--theme-primary)' }
  }
  if (props.variant === 'text') {
    return { color: 'var(--theme-primary)' }
  }
  return {}
})
</script>

<template>
  <component
    :is="componentTag"
    :to="to"
    :href="disabled || loading ? undefined : href"
    :tabindex="disabled || loading ? -1 : undefined"
    :type="!to && !href ? (type || 'button') : undefined"
    :disabled="!to && !href ? disabled || loading : undefined"
    :aria-disabled="disabled || loading || undefined"
    :aria-busy="loading || undefined"
    :class="[baseClasses, variantClasses, sizeClasses, widthClasses]"
    :style="buttonStyle"
    v-bind="$attrs"
    @click="disabled || loading ? $event.preventDefault() : emit('click', $event)"
  >
    <div v-if="loading" class="i-svg-spinners-ring-resize mr-2 animate-spin" />
    <slot />
  </component>
</template>
