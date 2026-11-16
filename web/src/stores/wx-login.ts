import { defineStore } from 'pinia'
import { ref } from 'vue'
import api from '@/api'

// 上游把微信扫码登录改成任务制：创建任务 → 轮询状态 → 确认 → 换取 Code。
type TaskStatus = 'waiting' | 'scanned' | 'authorized' | 'ready_for_code' | 'cancelled' | 'expired' | 'failed'

export const useWxLoginStore = defineStore('wx-login', () => {
  // 扫码登录状态
  const isLoading = ref(false)
  const qrCode = ref<string | null>(null)
  const qrCreatedAt = ref(0)
  const taskId = ref('')
  const wxid = ref('')
  const status = ref<'idle' | 'qr_loading' | 'qr_ready' | 'scanning' | 'confirming' | 'code_loading' | 'success' | 'error'>('idle')
  const statusMessage = ref('')
  const errorMessage = ref('')

  // 上游任务本身有 110 秒有效期，主动释放失败也不影响重新获取。
  function dropTask() {
    const id = taskId.value
    taskId.value = ''
    if (!id)
      return
    void api.delete(`/api/wx-login/tasks/${id}`, { timeout: 10000, skipErrorToast: true } as any).catch(() => {})
  }

  // 重置登录状态
  function resetState() {
    dropTask()
    qrCode.value = null
    qrCreatedAt.value = 0
    wxid.value = ''
    status.value = 'idle'
    statusMessage.value = ''
    errorMessage.value = ''
  }

  function toDataURL(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer)
    let binary = ''
    const chunkSize = 0x8000
    for (let i = 0; i < bytes.length; i += chunkSize)
      binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
    return `data:image/jpeg;base64,${btoa(binary)}`
  }

  // 获取二维码
  async function getQRCode(): Promise<boolean> {
    isLoading.value = true
    status.value = 'qr_loading'
    statusMessage.value = '正在获取二维码...'
    errorMessage.value = ''

    try {
      const { data } = await api.post('/api/wx-login/tasks', {}, { timeout: 30000, skipErrorToast: true } as any)
      if (!data?.ok || !data.data?.task_id)
        throw new Error(data?.error || '获取二维码失败')

      taskId.value = String(data.data.task_id)
      const qrPath = String(data.data.qr_url || `/api/wx-login/tasks/${taskId.value}/qr`)
      // 二维码接口要求管理头，不能直接交给 <img src>，取回后转成 data URL。
      const image = await api.get(qrPath, { responseType: 'arraybuffer', timeout: 30000, skipErrorToast: true } as any)

      qrCode.value = toDataURL(image.data as ArrayBuffer)
      qrCreatedAt.value = Date.now()
      status.value = 'qr_ready'
      statusMessage.value = '请使用微信扫码登录'
      return true
    }
    catch (e: any) {
      taskId.value = ''
      qrCode.value = null
      qrCreatedAt.value = 0
      status.value = 'error'
      errorMessage.value = e?.response?.data?.error || e?.message || '获取二维码失败'
      return false
    }
    finally {
      isLoading.value = false
    }
  }

  // 检查登录状态，已确认时交由 getFarmCode 换取农场 Code
  async function checkLogin(): Promise<{ success: boolean, pending: boolean }> {
    const checkedTaskId = taskId.value
    if (!checkedTaskId)
      return { success: false, pending: false }

    const previousStatus = status.value === 'confirming' ? 'confirming' : 'qr_ready'
    errorMessage.value = ''
    status.value = 'scanning'
    statusMessage.value = '正在检查登录状态...'

    try {
      const { data } = await api.get(`/api/wx-login/tasks/${checkedTaskId}/status`, { timeout: 20000, skipErrorToast: true } as any)
      if (taskId.value !== checkedTaskId)
        return { success: false, pending: false }
      if (!data?.ok)
        throw new Error(data?.error || '登录检查失败')

      const taskStatus = String(data.data?.status || '') as TaskStatus
      if (taskStatus === 'waiting') {
        status.value = 'qr_ready'
        statusMessage.value = '等待扫码中'
        return { success: false, pending: true }
      }
      if (taskStatus === 'scanned') {
        status.value = 'confirming'
        statusMessage.value = '已扫码，请在手机确认登录'
        return { success: false, pending: true }
      }
      if (taskStatus === 'authorized' || taskStatus === 'ready_for_code') {
        if (taskStatus === 'authorized') {
          const confirm = await api.post(`/api/wx-login/tasks/${checkedTaskId}/confirm`, undefined, { timeout: 30000, skipErrorToast: true } as any)
          if (taskId.value !== checkedTaskId)
            return { success: false, pending: false }
          if (!confirm.data?.ok)
            throw new Error(confirm.data?.error || '确认登录失败')
        }
        status.value = 'confirming'
        statusMessage.value = '已确认登录，正在获取农场 Code'
        return { success: true, pending: false }
      }
      throw new Error(taskStatus === 'expired' || taskStatus === 'cancelled' ? '二维码已失效，请重新获取' : '登录尚未完成')
    }
    catch (e: any) {
      if (taskId.value !== checkedTaskId)
        return { success: false, pending: false }
      // 拿不到响应说明只是超时或网络抖动，保留二维码继续轮询；有响应才是任务真的失败。
      if (!e?.response) {
        status.value = previousStatus
        statusMessage.value = '连接暂时中断，正在重试登录检查...'
        return { success: false, pending: true }
      }
      taskId.value = ''
      status.value = 'error'
      errorMessage.value = e.response?.data?.error || e.message || '登录检查失败'
      return { success: false, pending: false }
    }
  }

  // 获取QQ农场Code
  async function getFarmCode(): Promise<{ success: boolean, code?: string, wxid?: string, nickname?: string }> {
    const checkedTaskId = taskId.value
    if (!checkedTaskId)
      return { success: false }

    isLoading.value = true
    status.value = 'code_loading'
    statusMessage.value = '正在获取QQ农场Code...'
    errorMessage.value = ''

    try {
      const { data } = await api.post(`/api/wx-login/tasks/${checkedTaskId}/code`, undefined, { timeout: 60000, skipErrorToast: true } as any)
      if (!data?.ok || !data.data?.code)
        throw new Error(data?.error || '获取Code失败')

      const openid = String(data.data.openid || '')
      const nickname = String(data.data.nickname || '') || undefined
      taskId.value = ''
      wxid.value = openid
      status.value = 'success'
      statusMessage.value = '已获取QQ农场Code'
      return { success: true, code: String(data.data.code), wxid: openid || undefined, nickname }
    }
    catch (e: any) {
      status.value = 'error'
      errorMessage.value = e?.response?.data?.error || e?.message || '获取Code失败'
      return { success: false }
    }
    finally {
      isLoading.value = false
    }
  }

  return {
    isLoading,
    qrCode,
    qrCreatedAt,
    taskId,
    wxid,
    status,
    statusMessage,
    errorMessage,
    resetState,
    getQRCode,
    checkLogin,
    getFarmCode,
  }
})
