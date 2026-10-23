<script setup lang="ts">
import type { Ref } from 'vue'
import { NTabs } from 'naive-ui/es/tabs'
import { inject, ref } from 'vue'

defineOptions({ inheritAttrs: false })

const target = inject<Ref<HTMLElement | null>>('page-tabs-target', ref(null))
</script>

<template>
  <Teleport :to="target || 'body'" :disabled="!target">
    <NTabs class="page-tabs" type="line" v-bind="$attrs">
      <slot />
    </NTabs>
  </Teleport>
</template>
