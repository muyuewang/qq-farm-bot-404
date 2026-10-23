<script setup lang="ts">
import { ref, watch } from 'vue'

const props = withDefaults(defineProps<{
  src?: string
  alt?: string
  size?: 'sm' | 'md' | 'lg'
}>(), {
  src: '',
  alt: '',
  size: 'md',
})

const failed = ref(false)
watch(() => props.src, () => failed.value = false)
</script>

<template>
  <div class="item-image" :class="`item-image--${size}`">
    <img v-if="src && !failed" :src="src" :alt="alt" @error="failed = true">
    <div v-else class="i-carbon-image text-gray-400" aria-hidden="true" />
  </div>
</template>

<style scoped>
.item-image {
  display: grid;
  place-items: center;
  flex: none;
  overflow: hidden;
  background: color-mix(in srgb, var(--ui-surface-strong) 72%, transparent);
  border: 1px solid rgba(125, 101, 68, 0.14);
  border-radius: 8px;
}
.item-image img {
  width: 88%;
  height: 88%;
  object-fit: contain;
  image-rendering: auto;
}
.item-image--sm {
  width: 36px;
  height: 36px;
}
.item-image--md {
  width: 64px;
  height: 64px;
}
.item-image--lg {
  width: clamp(112px, 18vw, 164px);
  height: clamp(112px, 18vw, 164px);
}
</style>
