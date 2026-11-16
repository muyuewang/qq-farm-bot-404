<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, useId, watch } from 'vue'

const props = defineProps<{
  label?: string
  options?: { label: string, value: string | number, disabled?: boolean }[]
  disabled?: boolean
  placeholder?: string
}>()

const emit = defineEmits<{
  (e: 'change', value: string | number): void
}>()

const model = defineModel<string | number>()

const selectId = useId()
const activeIndex = ref(-1)
const isOpen = ref(false)
const containerRef = ref<HTMLElement | null>(null)
const triggerRef = ref<HTMLElement | null>(null)
const dropdownDirection = ref<'down' | 'up'>('down')
const dropdownMaxHeight = ref(240)

const selectedLabel = computed(() => {
  const selected = props.options?.find(opt => opt.value === model.value)
  return selected ? selected.label : (props.placeholder || '请选择')
})

function updateDropdownPlacement() {
  const trigger = triggerRef.value
  if (!trigger)
    return

  const triggerRect = trigger.getBoundingClientRect()
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight
  const gap = 8
  const preferredHeight = 240
  const spaceBelow = viewportHeight - triggerRect.bottom - gap
  const spaceAbove = triggerRect.top - gap
  const shouldOpenUp = spaceBelow < preferredHeight && spaceAbove > spaceBelow
  const availableHeight = shouldOpenUp ? spaceAbove : spaceBelow

  dropdownDirection.value = shouldOpenUp ? 'up' : 'down'
  dropdownMaxHeight.value = Math.max(0, Math.min(preferredHeight, Math.floor(availableHeight)))
}

async function toggleDropdown() {
  if (props.disabled)
    return
  isOpen.value = !isOpen.value
  if (isOpen.value) {
    await nextTick()
    updateDropdownPlacement()
    activeIndex.value = props.options?.findIndex(opt => opt.value === model.value && !opt.disabled) ?? -1
    if (activeIndex.value < 0)
      activeIndex.value = props.options?.findIndex(opt => !opt.disabled) ?? -1
  }
}

function selectOption(value: string | number) {
  model.value = value
  isOpen.value = false
  emit('change', value)
  triggerRef.value?.focus()
}

async function onKeydown(event: KeyboardEvent) {
  if (props.disabled)
    return
  if (event.key === 'Tab') {
    isOpen.value = false
    return
  }
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    isOpen.value = false
    return
  }
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' '].includes(event.key))
    return
  event.preventDefault()
  if (!isOpen.value) {
    await toggleDropdown()
    if (!['Home', 'End'].includes(event.key))
      return
  }
  const enabled = (props.options || []).map((opt, index) => opt.disabled ? -1 : index).filter(index => index >= 0)
  if (!enabled.length)
    return
  const current = enabled.indexOf(activeIndex.value)
  if (event.key === 'Home')
    activeIndex.value = enabled[0]!
  else if (event.key === 'End')
    activeIndex.value = enabled[enabled.length - 1]!
  else if (event.key === 'ArrowDown' || event.key === 'ArrowUp')
    activeIndex.value = enabled[(current + (event.key === 'ArrowDown' ? 1 : -1) + enabled.length) % enabled.length]!
  else {
    const option = props.options?.[activeIndex.value]
    if (option && !option.disabled)
      selectOption(option.value)
  }
  await nextTick()
  document.getElementById(`${selectId}-option-${activeIndex.value}`)?.scrollIntoView({ block: 'nearest' })
}

watch(() => props.options, () => {
  if (isOpen.value && (!props.options?.[activeIndex.value] || props.options[activeIndex.value]?.disabled))
    activeIndex.value = props.options?.findIndex(opt => !opt.disabled) ?? -1
}, { deep: true })

watch(() => props.disabled, (disabled) => {
  if (disabled)
    isOpen.value = false
})

function onFocusout(event: FocusEvent) {
  if (!containerRef.value?.contains(event.relatedTarget as Node | null))
    isOpen.value = false
}

function closeDropdown(e: MouseEvent) {
  if (containerRef.value && !containerRef.value.contains(e.target as Node)) {
    isOpen.value = false
  }
}

function handleViewportChange() {
  if (isOpen.value)
    updateDropdownPlacement()
}

onMounted(() => {
  document.addEventListener('click', closeDropdown)
  document.addEventListener('scroll', handleViewportChange, true)
  window.addEventListener('resize', handleViewportChange)
})

onUnmounted(() => {
  document.removeEventListener('click', closeDropdown)
  document.removeEventListener('scroll', handleViewportChange, true)
  window.removeEventListener('resize', handleViewportChange)
})
</script>

<template>
  <div ref="containerRef" @focusout="onFocusout" class="flex flex-col gap-1.5">
    <label v-if="label" :id="`${selectId}-label`" :for="selectId" class="text-sm text-gray-700 font-medium dark:text-gray-300">
      {{ label }}
    </label>
    <div class="relative">
      <!-- Trigger -->
      <button
        :id="selectId"
        ref="triggerRef"
        type="button"
        role="combobox"
        :disabled="disabled"
        :aria-expanded="isOpen"
        aria-haspopup="listbox"
        :aria-controls="`${selectId}-listbox`"
        :aria-labelledby="label ? `${selectId}-label` : undefined"
        :aria-label="!label ? placeholder || '请选择' : undefined"
        :aria-activedescendant="isOpen && activeIndex >= 0 ? `${selectId}-option-${activeIndex}` : undefined"
        @keydown="onKeydown"
        class="base-select-trigger w-full flex cursor-pointer items-center justify-between border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none transition-colors duration-150 dark:border-gray-700 dark:text-white"
        :class="{
          'bg-gray-50 text-gray-400 cursor-not-allowed dark:bg-gray-800/50': disabled,
          'is-open': isOpen,
        }"
        @click="toggleDropdown"
      >
        <span class="truncate">{{ selectedLabel }}</span>
        <div class="i-carbon-chevron-down text-lg text-gray-400 transition-transform duration-200" :class="{ 'rotate-180': isOpen }" />
      </button>

      <!-- Dropdown Menu -->
      <Transition name="select-popover">
        <div
          v-if="isOpen"
          :id="`${selectId}-listbox`"
          role="listbox"
          :aria-label="label || placeholder || '请选择'"
          class="glass-panel absolute left-0 right-0 z-[70] overflow-auto rounded-lg py-1"
          :class="dropdownDirection === 'up' ? 'bottom-full mb-1' : 'top-full mt-1'"
          :style="{ maxHeight: `${dropdownMaxHeight}px`, transformOrigin: dropdownDirection === 'up' ? 'bottom center' : 'top center' }"
        >
          <template v-if="options?.length">
            <div
              v-for="(opt, index) in options"
              :key="opt.value"
              :id="`${selectId}-option-${index}`"
              role="option"
              :aria-selected="model === opt.value"
              :aria-disabled="!!opt.disabled"
              @pointerdown.prevent
              @mouseenter="!opt.disabled && (activeIndex = index)"
              class="cursor-pointer px-3 py-2 text-sm transition-colors hover:bg-gray-100 dark:hover:bg-gray-700/50"
              :class="{
                'text-primary': model === opt.value,
                'is-active': activeIndex === index,
                'text-gray-400 cursor-not-allowed hover:bg-transparent dark:text-gray-500': opt.disabled,
                'text-gray-700 dark:text-gray-200': model !== opt.value && !opt.disabled,
              }"
              @click="!opt.disabled && selectOption(opt.value)"
            >
              <slot name="option" :option="opt" :selected="model === opt.value">
                {{ opt.label }}
              </slot>
            </div>
          </template>
          <div v-else class="px-3 py-2 text-center text-sm text-gray-400">
            暂无选项
          </div>
        </div>
      </Transition>
    </div>
  </div>
</template>

<style scoped>
.select-popover-enter-active, .select-popover-leave-active {
  transition: transform 100ms ease-out, opacity 100ms ease-out;
}
.select-popover-enter-from, .select-popover-leave-to {
  opacity: 0;
  transform: scale(0.98);
}

.base-select-trigger {
  background: var(--input-bg);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.28);
}

.base-select-trigger:focus-visible,
.base-select-trigger.is-open {
  border-color: var(--theme-primary);
  box-shadow:
    0 0 0 3px color-mix(in srgb, var(--theme-primary) 18%, transparent),
    inset 0 1px 0 rgba(255, 255, 255, 0.32);
}

.is-active {
  outline: 2px solid var(--theme-primary);
  outline-offset: -2px;
}

.text-primary {
  background: color-mix(in srgb, var(--theme-primary) 10%, transparent);
  color: var(--theme-primary);
}
</style>
