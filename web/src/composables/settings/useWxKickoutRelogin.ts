import type { Ref } from 'vue'
import { onUnmounted, ref, watch } from 'vue'
import api from '@/api'

export interface WxKickoutReloginConfig {
  enabled: boolean
  delayMinutes: number
  dailyLimit: number
  validUntil: string
}

export interface WxKickoutReloginStatus {
  enabled: boolean
  bound: boolean
  blocked: boolean
  credentialReady: boolean
  pending: boolean
  nextRunAt: number
  attempts: number
  failures: number
  expiresAt: number
  lastSuccessAt: number
  delayMinutes?: number
  dailyLimit?: number
  validUntil?: string
}

const DEFAULT_CONFIG: WxKickoutReloginConfig = {
  enabled: true,
  delayMinutes: 0,
  dailyLimit: 5,
  validUntil: '',
}

const DEFAULT_STATUS: WxKickoutReloginStatus = {
  enabled: true,
  bound: false,
  blocked: false,
  credentialReady: false,
  pending: false,
  nextRunAt: 0,
  attempts: 0,
  failures: 0,
  expiresAt: 0,
  lastSuccessAt: 0,
}

const STATUS_POLL_MS = 60_000

interface Options {
  currentAccountId: Ref<any>
  showAlert: (message: string, type?: 'primary' | 'danger') => void
}

function clampInt(value: unknown, min: number, max: number, fallback: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed)
    ? Math.max(min, Math.min(max, Math.floor(parsed)))
    : fallback
}

function normalizeConfig(raw: any): WxKickoutReloginConfig {
  const source = raw && typeof raw === 'object' ? raw : {}
  return {
    enabled: typeof source.enabled === 'boolean' ? source.enabled : DEFAULT_CONFIG.enabled,
    delayMinutes: clampInt(source.delayMinutes, 0, 4320, DEFAULT_CONFIG.delayMinutes),
    dailyLimit: clampInt(source.dailyLimit, 0, 999, DEFAULT_CONFIG.dailyLimit),
    validUntil: typeof source.validUntil === 'string' ? source.validUntil : '',
  }
}

export function useWxKickoutRelogin(options: Options) {
  const config = ref<WxKickoutReloginConfig>({ ...DEFAULT_CONFIG })
  const status = ref<WxKickoutReloginStatus | null>(null)
  const statusError = ref('')
  const saving = ref(false)
  let statusRequest: Promise<void> | null = null
  let statusSeq = 0
  let pollTimer: ReturnType<typeof setInterval> | null = null

  // 并发调用复用同一个请求；切换账号或保存后用 force 强制刷新，
  // 并忽略过期响应，避免旧账号状态覆盖新账号。
  async function loadStatus(force = false): Promise<void> {
    if (!force && statusRequest) return statusRequest
    const seq = ++statusSeq
    const accountId = String((options.currentAccountId.value as any) ?? '')
    const headers = accountId ? { 'x-account-id': accountId } : {}
    const request = (async () => {
      try {
        const { data } = await api.get('/api/settings/wx-reconnect/status', { headers })
        if (seq !== statusSeq) return
        if (data?.ok) {
          status.value = { ...DEFAULT_STATUS, ...(data.data || {}) }
          statusError.value = ''
        }
      }
      catch (error: any) {
        if (seq !== statusSeq) return
        status.value = null
        statusError.value = error?.response?.data?.error || error?.message || '读取自动连回状态失败'
      }
      finally {
        // 只有最后一次请求可以清空去重标记，避免旧请求覆盖新请求的状态。
        if (seq === statusSeq) statusRequest = null
      }
    })()
    statusRequest = request
    return request
  }

  async function load() {
    try {
      const { data } = await api.get('/api/settings/login-config')
      if (data?.ok)
        config.value = normalizeConfig(data.data?.wxKickoutRelogin)
      await loadStatus()
    }
    catch (error: any) {
      options.showAlert(error?.response?.data?.error || error?.message || '读取微信自动连回设置失败', 'danger')
    }
  }

  async function save() {
    if (saving.value)
      return
    saving.value = true
    try {
      const { data } = await api.post('/api/settings/login-config', { wxKickoutRelogin: config.value })
      if (!data?.ok)
        throw new Error(data?.error || '保存失败')
      config.value = normalizeConfig(data.data?.wxKickoutRelogin)
      await loadStatus(true)
      options.showAlert('微信被踢自动连回设置已保存')
    }
    catch (error: any) {
      options.showAlert(error?.response?.data?.error || error?.message || '保存微信自动连回设置失败', 'danger')
    }
    finally {
      saving.value = false
    }
  }

  watch(options.currentAccountId, () => {
    status.value = null
    statusError.value = ''
    void loadStatus(true)
  })

  const canPoll = typeof document !== 'undefined'
  function onVisibilityChange() {
    if (!document.hidden) void loadStatus(true)
  }

  // 后台自动连回完成后低频同步状态；页面隐藏时不请求，重新可见时立即刷新。
  if (canPoll) {
    pollTimer = setInterval(() => {
      if (!document.hidden) void loadStatus()
    }, STATUS_POLL_MS)
    document.addEventListener('visibilitychange', onVisibilityChange)
  }

  onUnmounted(() => {
    if (pollTimer) clearInterval(pollTimer)
    if (canPoll) document.removeEventListener('visibilitychange', onVisibilityChange)
  })

  return {
    wxKickoutReloginConfig: config,
    wxKickoutReloginStatus: status,
    wxKickoutReloginError: statusError,
    wxKickoutReloginSaving: saving,
    loadWxKickoutRelogin: load,
    loadWxKickoutReloginStatus: loadStatus,
    saveWxKickoutRelogin: save,
  }
}
