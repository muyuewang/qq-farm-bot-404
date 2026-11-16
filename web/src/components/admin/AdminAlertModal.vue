<script setup lang="ts">
import ConfirmModal from '@/components/ConfirmModal.vue'

export interface AdminAlertConfig {
  title: string
  message: string
  type: 'primary' | 'danger'
  isAlert: boolean
}

defineProps<{
  config: AdminAlertConfig
}>()

const show = defineModel<boolean>('show', { required: true })

function closeAlert() {
  show.value = false
}
</script>

<template>
  <ConfirmModal
    :show="show"
    :title="config.title"
    :message="config.message"
    :type="config.type"
    :is-alert="config.isAlert"
    confirm-text="知道了"
    @confirm="closeAlert"
    @close="closeAlert"
    @cancel="closeAlert"
  />
</template>
