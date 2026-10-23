<script setup lang="ts">
withDefaults(defineProps<{ size?: number | string }>(), { size: 28 })
</script>

<template>
  <img class="brand-mark-svg" src="/icon.svg?v=farmhouse-1" :width="size" :height="size" alt="" aria-hidden="true">
</template>

<style scoped>
.brand-mark-svg {
  display: block;
  flex: none;
}
</style>
