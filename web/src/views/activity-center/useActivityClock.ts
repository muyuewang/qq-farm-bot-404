import type { Ref } from 'vue'
import { storeToRefs } from 'pinia'
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useActivityCenterStore } from '@/stores/activity-center'

export function useActivityClock() {
  const activityStore = useActivityCenterStore()
  const { serverClockOffset } = storeToRefs(activityStore)
  const clockNow = ref(Date.now())
  let timer: number | undefined

  const serverNow = computed(() => clockNow.value + serverClockOffset.value)

  function remaining(endTime: Ref<number | null | undefined>) {
    return computed(() => {
      if (!endTime.value)
        return ''
      const diff = Math.max(0, endTime.value - serverNow.value)
      if (diff === 0)
        return '活动已结束'
      const days = Math.floor(diff / 86400000)
      const hours = Math.floor(diff % 86400000 / 3600000)
      const minutes = Math.floor(diff % 3600000 / 60000)
      return days > 0 ? `剩余：${days}天${hours}小时` : `剩余：${hours}小时${minutes}分钟`
    })
  }

  onMounted(() => {
    timer = window.setInterval(() => clockNow.value = Date.now(), 1000)
  })
  onUnmounted(() => {
    if (timer)
      window.clearInterval(timer)
  })

  return { serverNow, remaining }
}
