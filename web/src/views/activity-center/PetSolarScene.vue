<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{ term?: string }>()

const isBailu = computed(() => (props.term || '').includes('白露'))
const skyId = computed(() => `pet-scene-sky-${isBailu.value ? 'bailu' : 'plain'}`)
</script>

<template>
  <svg class="pet-scene" viewBox="0 0 320 176" role="img" :aria-label="`${term || '节令'}节气插画`">
    <defs>
      <linearGradient :id="skyId" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" :stop-color="isBailu ? '#f8f1e2' : '#f4f2e7'" />
        <stop offset="1" :stop-color="isBailu ? '#e6efe3' : '#e7efe5'" />
      </linearGradient>
    </defs>
    <rect width="320" height="176" :fill="`url(#${skyId})`" />
    <circle cx="252" cy="42" r="21" fill="#fdf8ea" stroke="#eadfc4" />
    <path d="M0 134c42-15 72 5 112-5s70-23 110-11 68 13 98 5v53H0Z" fill="#dde8db" />
    <path d="M0 150c46-10 78 6 118-2s76-16 116-6 66 10 86 4v30H0Z" fill="#cfdec9" />
    <template v-if="isBailu">
      <g fill="none" stroke="#84a077" stroke-linecap="round" stroke-width="2.4">
        <path d="M62 138c-3-24 4-43 15-56" />
        <path d="M76 140c0-20 7-35 18-46" />
        <path d="M90 142c1-15 7-26 15-33" />
      </g>
      <ellipse cx="186" cy="146" rx="48" ry="16" fill="#c6d8bd" />
      <ellipse cx="186" cy="141" rx="34" ry="11" fill="#d5e4cd" />
      <circle cx="172" cy="134" r="5.2" fill="#eef6f0" />
      <circle cx="198" cy="138" r="4" fill="#eef6f0" />
      <circle cx="186" cy="130" r="3.2" fill="#eef6f0" />
    </template>
    <template v-else>
      <g fill="none" stroke="#88a37c" stroke-linecap="round" stroke-width="2.4">
        <path d="M58 142c0-22 6-38 18-48" />
        <path d="M78 144c0-16 6-29 15-37" />
      </g>
      <circle cx="60" cy="96" r="9" fill="#cfe0c5" />
      <circle cx="82" cy="108" r="7" fill="#cfe0c5" />
      <circle cx="188" cy="140" r="10" fill="#e2ddc4" />
      <circle cx="212" cy="146" r="7" fill="#e2ddc4" />
    </template>
  </svg>
</template>

<style scoped>
.pet-scene {
  display: block;
  width: 100%;
  height: auto;
  border-radius: 12px;
}
</style>
