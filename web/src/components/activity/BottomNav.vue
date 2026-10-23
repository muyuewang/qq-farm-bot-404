<script setup lang="ts">
import type { ActivityTabKey } from '@/stores/activity-center'

export type ActivityTab = ActivityTabKey

withDefaults(defineProps<{
  modelValue: ActivityTab
  badges?: Partial<Record<ActivityTab, boolean>>
}>(), { badges: () => ({}) })

defineEmits<{
  'update:modelValue': [value: ActivityTab]
}>()

const items: Array<{ key: ActivityTab, label: string, description: string, icon: string }> = [
  { key: 'travel', label: '游记进度', description: '等级与奖励', icon: 'i-carbon-roadmap' },
  { key: 'constellation', label: '观星礼录', description: '星宿与点亮', icon: 'i-carbon-star' },
  { key: 'shop', label: '星砂商店', description: '活动兑换', icon: 'i-carbon-store' },
  { key: 'solar', label: '节令小礼', description: '节气奖励', icon: 'i-carbon-sun' },
]
</script>

<template>
  <nav class="activity-nav" aria-label="活动页面">
    <button
      v-for="item in items"
      :key="item.key"
      type="button"
      :aria-label="item.label"
      :aria-current="modelValue === item.key ? 'page' : undefined"
      :data-active="modelValue === item.key || undefined"
      @click="$emit('update:modelValue', item.key)"
    >
      <span class="activity-nav__icon" :class="item.icon" aria-hidden="true" />
      <span class="activity-nav__copy">
        <strong>{{ item.label }}</strong>
        <small>{{ item.description }}</small>
        <i v-if="badges[item.key]" class="activity-nav__badge" aria-label="有可操作内容" />
      </span>
    </button>
  </nav>
</template>

<style scoped>
.activity-nav {
  position: absolute;
  z-index: 30;
  top: calc(110px + env(safe-area-inset-top));
  bottom: 24px;
  left: 24px;
  width: 220px;
  display: grid;
  grid-template-columns: 1fr;
  grid-auto-rows: 72px;
  align-content: start;
  gap: 10px;
  padding: 14px;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius-card);
  background: rgba(255, 255, 255, 0.5);
}
button {
  position: relative;
  min-width: 0;
  min-height: 72px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  border: 1px solid var(--ui-border);
  border-radius: 8px;
  color: var(--ui-muted);
  text-align: left;
  background: var(--ui-surface);
  cursor: pointer;
  transition:
    border-color 0.16s ease,
    background 0.16s ease,
    box-shadow 0.16s ease,
    transform 0.16s ease;
}
button:hover {
  border-color: rgba(42, 119, 91, 0.3);
  transform: translateY(-1px);
}
button[data-active] {
  border-color: rgba(67, 141, 99, 0.24);
  color: var(--ui-primary);
  background: var(--ui-primary-soft);
  box-shadow:
    0 8px 22px rgba(45, 98, 77, 0.1),
    inset 0 1px rgba(255, 255, 255, 0.9);
}
.activity-nav__icon {
  width: 24px;
  flex: none;
  color: currentColor;
  font-size: 24px;
}
.activity-nav__copy {
  position: relative;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.activity-nav__copy strong {
  overflow: hidden;
  color: inherit;
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.activity-nav__copy small {
  margin-top: 2px;
  overflow: hidden;
  color: var(--ui-subtle);
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.activity-nav__badge {
  position: absolute;
  top: -7px;
  right: -8px;
  width: 8px;
  height: 8px;
  border: 2px solid white;
  border-radius: 50%;
  background: var(--ui-danger);
}
@media (max-width: 900px) {
  .activity-nav {
    top: calc(82px + env(safe-area-inset-top));
    right: 10px;
    bottom: auto;
    left: 10px;
    width: auto;
    grid-template-columns: none;
    grid-auto-flow: column;
    grid-auto-columns: 108px;
    grid-auto-rows: 44px;
    gap: 7px;
    overflow-x: auto;
    padding: 4px 8px 10px;
    border: 0;
    border-radius: 0;
    background: transparent;
    scroll-padding-inline: 8px;
    scroll-snap-type: x proximity;
    scrollbar-width: none;
  }
  .activity-nav::-webkit-scrollbar {
    display: none;
  }
  button {
    min-width: 108px;
    min-height: 44px;
    justify-content: flex-start;
    gap: 6px;
    padding: 7px 9px;
    border-radius: 9px;
    scroll-snap-align: start;
  }
  .activity-nav__icon {
    width: 16px;
    font-size: 16px;
  }
  .activity-nav__copy strong {
    font-size: 11px;
  }
  .activity-nav__copy small {
    display: none;
  }
}
</style>
