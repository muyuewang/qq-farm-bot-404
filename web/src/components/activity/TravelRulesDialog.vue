<script setup lang="ts">
import type { ActivityRulesDto } from '@/stores/activity-center'
import ActivityRulesDialog from './ActivityRulesDialog.vue'

defineProps<{
  open: boolean
  rules: ActivityRulesDto
}>()
const emit = defineEmits<{ close: [] }>()
</script>

<template>
  <ActivityRulesDialog :open="open" :rules="rules" @close="emit('close')">
    <template #guide>
      <div class="rules-guide" aria-label="活动玩法流程">
        <div class="guide-step">
          <span class="guide-icon guide-icon--fruit" aria-hidden="true">✿</span>
          <strong>收获游记果实</strong>
          <small>获得游记积分</small>
        </div>
        <span class="guide-arrow" aria-hidden="true">➜</span>
        <div class="guide-step">
          <span class="guide-icon guide-icon--level" aria-hidden="true">★</span>
          <strong>游记升级</strong>
          <small>领取星砂</small>
        </div>
        <span class="guide-arrow" aria-hidden="true">➜</span>
        <div class="guide-step">
          <span class="guide-icon guide-icon--sand" aria-hidden="true"><img src="/activity-center/stellar/star-sand.png" alt=""></span>
          <strong>星砂商店</strong>
          <small>兑换装扮</small>
        </div>
      </div>
      <p class="guide-note">
        注：集齐同主题装扮部件才可激活该套效果哦！
      </p>
    </template>
  </ActivityRulesDialog>
</template>

<style scoped>
.rules-guide {
  display: grid;
  grid-template-columns: 1fr 20px 1fr 20px 1fr;
  align-items: center;
  gap: 2px;
  padding: 7px 2px 14px;
  border-bottom: 1px dashed rgba(116, 71, 25, 0.42);
}
.guide-step {
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
}
.guide-step strong {
  margin-top: 5px;
  font-size: 12px;
  white-space: nowrap;
}
.guide-step small {
  margin-top: 2px;
  color: #996327;
  font-size: 10px;
  white-space: nowrap;
}
.guide-arrow {
  color: #c47d30;
  font-size: 19px;
  text-align: center;
}
.guide-icon {
  width: 54px;
  height: 54px;
  display: grid;
  place-items: center;
  border: 3px solid #e6aa54;
  border-radius: 50%;
  color: white;
  background: radial-gradient(circle at 40% 32%, #ffe8a1, #d98832 66%, #985121);
  box-shadow: 0 3px 6px rgba(107, 60, 19, 0.35);
  font-size: 30px;
  text-shadow: 0 2px 2px #85501c;
}
.guide-icon--fruit {
  color: #ffe382;
}
.guide-icon--level {
  color: #fff6a3;
}
.guide-icon--sand img {
  width: 43px;
  height: 43px;
  object-fit: contain;
}
.guide-note {
  margin: 9px 2px 17px;
  color: #a26325;
  font-size: 10px;
  text-align: center;
}
</style>
