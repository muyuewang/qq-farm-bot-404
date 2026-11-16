<script setup lang="ts">
defineProps<{ item: any, named?: boolean }>()
</script>

<template>
  <div class="tea-reward" :title="`${item.name || ''} ×${item.count}`">
    <span v-if="named" class="reward-name">{{ item.name }}</span>
    <div class="reward-frame" :class="`rarity-${item.rarity || 0}`">
      <img v-if="item.image" :src="item.image" :alt="item.name || ''">
      <span v-else class="reward-fallback">{{ item.name || '奖励' }}</span>
      <b>{{ item.count }}</b>
    </div>
  </div>
</template>

<style scoped>
.tea-reward {
  min-width: 0;
  text-align: center;
}
.reward-name {
  display: block;
  font-size: 2.7cqw;
  font-weight: 800;
  line-height: 1.3;
  overflow-wrap: anywhere;
}
.reward-frame {
  position: relative;
  width: 100%;
  aspect-ratio: 1;
  border: 0.6cqw solid #fff6dd;
  border-radius: 2cqw;
  background: #f6d477;
  box-shadow: 0 0.3cqw 0.3cqw #9c7b4a55;
}
.rarity-1 {
  background: #96ddee;
}
.rarity-2 {
  background: #d4a0f6;
}
.reward-frame img {
  width: 90%;
  height: 90%;
  object-fit: contain;
  margin: 5%;
}
.reward-frame b {
  position: absolute;
  right: 0.4cqw;
  bottom: 0;
  font-size: 2.6cqw;
  line-height: 1.1;
  color: #68482f;
  text-shadow: 0 0 0.4cqw #fff;
}
.reward-fallback {
  display: flex;
  height: 100%;
  align-items: center;
  justify-content: center;
  font-size: 2.3cqw;
}
</style>
