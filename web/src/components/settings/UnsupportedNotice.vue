<script setup lang="ts">
withDefaults(defineProps<{
  message: string
  visible?: boolean
}>(), {
  visible: true,
})
</script>

<template>
  <div v-if="!visible" class="space-y-2">
    <div class="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-800/60 dark:bg-amber-900/20 dark:text-amber-400">
      {{ message }}
    </div>
    <div class="pointer-events-none select-none opacity-50">
      <slot />
    </div>
  </div>
  <slot v-else />
</template>
