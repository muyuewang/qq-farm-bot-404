<script setup lang="ts">
defineProps<{ theme?: 'night' | 'day' }>()
</script>

<template>
  <section class="activity-shell" :class="`activity-shell--${theme || 'night'}`">
    <div class="activity-shell__frame">
      <slot />
    </div>
  </section>
</template>

<style scoped>
.activity-shell {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  padding: 0;
  color: var(--ui-ink);
  background: transparent;
  font-family: 'Microsoft YaHei', 'PingFang SC', sans-serif;
}
.activity-shell--day {
  background: transparent;
}
.activity-shell__frame {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius-card);
  background: rgba(255, 255, 255, 0.62);
  box-shadow:
    var(--ui-shadow-sm),
    inset 0 1px rgba(255, 255, 255, 0.92);
}
@media (max-width: 1023px) {
  .activity-shell {
    height: 100%;
    min-height: 0;
  }
  .activity-shell__frame {
    border-radius: var(--ui-radius-card);
  }
}
</style>
