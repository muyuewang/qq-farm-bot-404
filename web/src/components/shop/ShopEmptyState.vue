<script setup lang="ts">
defineProps<{
  message: string
}>()
</script>

<template>
  <div class="border border-gray-200 rounded-lg border-dashed bg-white px-6 py-10 text-center text-sm text-gray-500 dark:border-gray-700 dark:bg-gray-900/30 dark:text-gray-400">
    {{ message }}
  </div>
</template>
