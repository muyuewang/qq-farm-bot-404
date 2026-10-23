<script setup lang="ts">
import { computed, ref, watch } from 'vue'

const props = withDefaults(defineProps<{
  name: string
  count?: string | number
  image?: string
  rarity?: string | number | null
  locked?: boolean
  claimed?: boolean
  checked?: boolean
  variant?: 'blue' | 'violet' | 'gold' | 'green'
  compact?: boolean
}>(), {
  count: '',
  image: '',
  rarity: null,
  locked: false,
  claimed: false,
  checked: false,
  variant: 'blue',
  compact: false,
})

const imageFailed = ref(false)
watch(() => props.image, () => imageFailed.value = false)
const rarityClass = computed(() => {
  const value = String(props.rarity ?? '').toLowerCase()
  if (['5', '6', 'legendary', 'orange', 'gold'].includes(value))
    return 'gold'
  if (['4', 'epic', 'purple', 'violet'].includes(value))
    return 'violet'
  if (['3', 'rare', 'blue'].includes(value))
    return 'blue'
  if (['2', 'uncommon', 'green'].includes(value))
    return 'green'
  return props.variant
})
</script>

<template>
  <div
    class="reward-item"
    :class="[`reward-item--${rarityClass}`, { 'reward-item--compact': compact, 'reward-item--locked': locked, 'reward-item--checked': claimed || checked }]"
    :title="name"
    :aria-label="`${name}${count !== '' ? ` ×${count}` : ''}${locked ? '，已锁定' : claimed || checked ? '，已领取' : ''}`"
  >
    <img v-if="image && !imageFailed" :src="image" alt="" @error="imageFailed = true">
    <span v-else class="reward-item__placeholder" aria-hidden="true" />
    <span v-if="locked" class="reward-item__lock" aria-hidden="true">
      <svg viewBox="0 0 24 24"><rect x="5" y="10" width="14" height="11" rx="3" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>
    </span>
    <span v-else-if="claimed || checked" class="reward-item__check" aria-hidden="true">
      <svg viewBox="0 0 24 24"><path d="m5 12 4.5 4.5L19 7" /></svg>
    </span>
    <b v-if="count !== ''">{{ count }}</b>
  </div>
</template>

<style scoped>
.reward-item {
  position: relative;
  width: 64px;
  height: 64px;
  display: grid;
  place-items: center;
  overflow: hidden;
  border: 2px solid #9de8ff;
  border-radius: 11px;
  color: #5ef0ff;
  background: linear-gradient(145deg, rgba(28, 155, 220, 0.92), rgba(26, 76, 159, 0.96));
  box-shadow:
    inset 0 0 12px rgba(255, 255, 255, 0.34),
    0 3px 7px rgba(0, 36, 83, 0.48);
}
.reward-item--violet {
  border-color: #f0b4ff;
  color: #f0a1ff;
  background: linear-gradient(145deg, #c05ddd, #70419c);
}
.reward-item--gold {
  border-color: #fff4a8;
  color: #ffe170;
  background: linear-gradient(145deg, #f5b853, #b46d32);
}
.reward-item--green {
  border-color: #d2ffa9;
  color: #a6f16d;
  background: linear-gradient(145deg, #85cd59, #348a66);
}
.reward-item--compact {
  width: 54px;
  height: 54px;
}
.reward-item--locked {
  filter: saturate(0.62);
}
.reward-item--locked::after {
  content: '';
  position: absolute;
  inset: 0;
  background: rgba(10, 25, 58, 0.22);
  pointer-events: none;
}
.reward-item--checked {
  filter: saturate(0.72);
}
img {
  width: 78%;
  height: 78%;
  object-fit: contain;
  filter: drop-shadow(0 2px 2px rgba(0, 0, 0, 0.28));
}
.reward-item__placeholder {
  width: 25px;
  height: 25px;
  border: 2px solid currentColor;
  border-radius: 50%;
  opacity: 0.32;
}
.reward-item__placeholder::after {
  content: '';
  display: block;
  width: 7px;
  height: 7px;
  margin: 7px;
  border-radius: 50%;
  background: currentColor;
}
.reward-item__lock {
  position: absolute;
  z-index: 2;
  inset: 0;
  display: grid;
  place-items: center;
  background: rgba(9, 24, 55, 0.22);
}
.reward-item__lock svg {
  width: 23px;
  fill: rgba(19, 38, 65, 0.88);
  stroke: #e9f5ff;
  stroke-width: 1.8;
}
.reward-item__check {
  position: absolute;
  z-index: 2;
  inset: 0;
  display: grid;
  place-items: center;
  background: rgba(66, 55, 7, 0.28);
}
.reward-item__check svg {
  width: 34px;
  height: 34px;
  padding: 3px;
  border: 2px solid #fff3a3;
  border-radius: 50%;
  fill: none;
  stroke: #ffeb56;
  stroke-width: 4;
  stroke-linecap: round;
  stroke-linejoin: round;
  filter: drop-shadow(0 2px 2px #6d5000);
}
b {
  position: absolute;
  z-index: 3;
  right: 4px;
  bottom: 2px;
  color: white;
  font-size: 11px;
  line-height: 1;
  text-shadow: 0 1px 3px #102d55;
}
</style>
