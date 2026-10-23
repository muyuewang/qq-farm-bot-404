<script setup lang="ts">
import { useResizeObserver } from '@vueuse/core'
import { NTooltip } from 'naive-ui/es/tooltip'
import { nextTick, onMounted, ref, watch } from 'vue'

defineOptions({ inheritAttrs: false })

const props = withDefaults(defineProps<{
  text: string
  lines?: number
}>(), { lines: 1 })

const content = ref<HTMLElement>()
const overflowing = ref(false)
const show = ref(false)
const tooltipWidth = ref(384)

function measureOverflow() {
  const element = content.value
  overflowing.value = !!element && (element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1)
  if (element && overflowing.value) {
    const bounds = element.getBoundingClientRect()
    const viewport = element.ownerDocument.documentElement.clientWidth
    const center = (bounds.left + bounds.right) / 2
    // 以文字位置计算居中可用宽度，避免窄屏上自动翻转后仍越界。
    const centeredWidth = 2 * (Math.min(center, viewport - center) - 12)
    tooltipWidth.value = Math.max(160, Math.min(384, viewport - 24, Math.floor(centeredWidth)))
  }
  if (!overflowing.value)
    show.value = false
}

function setShow(value: boolean) {
  if (value)
    measureOverflow()
  show.value = value && overflowing.value
}

useResizeObserver(content, measureOverflow)
onMounted(measureOverflow)
watch(() => [props.text, props.lines], async () => {
  show.value = false
  await nextTick()
  measureOverflow()
})

function toggle() {
  if (overflowing.value)
    setShow(!show.value)
}
</script>

<template>
  <NTooltip
    :show="show && overflowing"
    :disabled="!overflowing"
    :delay="200"
    placement="top"
    :width="tooltipWidth"
    :theme-overrides="{
      color: 'var(--ui-surface-strong)',
      textColor: 'var(--ui-ink)',
      borderRadius: '8px',
      padding: '10px 12px',
    }"
    @update:show="setShow"
  >
    <template #trigger>
      <span
        ref="content"
        v-bind="$attrs"
        class="overflow-tooltip"
        :class="{ 'overflow-tooltip--clipped': overflowing, 'overflow-tooltip--multiline': lines > 1 }"
        :style="{ '--text-lines': lines }"
        :tabindex="overflowing ? 0 : undefined"
        :role="overflowing ? 'button' : undefined"
        :aria-expanded="overflowing ? show : undefined"
        @focus="setShow(true)"
        @blur="show = false"
        @click="setShow(true)"
        @keydown.enter.prevent="toggle"
        @keydown.space.prevent="toggle"
        @keydown.esc="show = false"
      >{{ text }}</span>
    </template>
    <div class="overflow-tooltip__full">
      {{ text }}
    </div>
  </NTooltip>
</template>

<style scoped>
.overflow-tooltip {
  display: block;
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.overflow-tooltip--multiline {
  display: -webkit-box;
  white-space: normal;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: var(--text-lines);
}

.overflow-tooltip--clipped {
  cursor: help;
}

.overflow-tooltip--clipped:focus-visible {
  border-radius: 4px;
  outline: 2px solid var(--ui-primary);
  outline-offset: 2px;
}

.overflow-tooltip__full {
  max-width: 100%;
  max-height: min(360px, 60vh);
  overflow-y: auto;
  font-size: 13px;
  line-height: 1.65;
  overflow-wrap: anywhere;
  white-space: pre-line;
}
</style>
