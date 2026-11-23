import { defineStore } from 'pinia'
import { ref } from 'vue'
import api from '@/api'

/**
 * 上游版本与宿主机更新器状态。
 *
 * 面板自己不能升级：容器内没有 git 与构建工具，真正的检查、构建、重启由宿主机上的
 * tools/updater 完成（见 docs/updater.md）。这里只读它写进数据目录的状态文件，
 * 再往请求文件里丢一个标记，没有装更新器时状态是「未检查」，界面会明确说明。
 */
export interface UpdateStatus {
  state?: 'idle' | 'running' | 'success' | 'failed' | 'unknown'
  step?: string
  hasUpdate?: boolean
  behind?: number
  deployedSha?: string
  deployedShort?: string
  latestSha?: string
  latestShort?: string
  commits?: string[]
  message?: string
  checkedAt?: number
  requestPending?: boolean
}

export const useUpdateStore = defineStore('update', () => {
  const status = ref<UpdateStatus | null>(null)
  const checking = ref(false)
  const modalOpen = ref(false)
  let timer: ReturnType<typeof setTimeout> | undefined

  /** 更新中要盯得紧一些；空闲时一分钟一次足够，不在后台反复打接口。 */
  function schedule() {
    const busy = status.value?.state === 'running' || status.value?.requestPending
    if (timer)
      clearTimeout(timer)
    timer = setTimeout(fetchStatus, busy ? 3000 : 60000)
  }

  async function fetchStatus() {
    try {
      const res = await api.get('/api/update/status', { skipErrorToast: true } as any)
      status.value = (res.data && res.data.data) || null
    }
    catch {
      // 更新过程中容器会重启，这段时间面板读不到状态属正常，等下一轮轮询。
    }
    schedule()
  }

  async function check() {
    checking.value = true
    try {
      await api.post('/api/update/check', {}, { skipErrorToast: true } as any)
      // 宿主机是定时任务扫请求文件，给它留出触发的间隔再读状态。
      setTimeout(fetchStatus, 2500)
    }
    finally {
      checking.value = false
    }
  }

  async function apply() {
    await api.post('/api/update/apply', {}, { skipErrorToast: true } as any)
    await fetchStatus()
  }

  return { status, checking, modalOpen, fetchStatus, check, apply }
})
