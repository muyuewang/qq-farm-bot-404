import { ref } from 'vue'
import api from '@/api'

export interface SystemConfig {
  serverUrl: string
  clientVersion: string
  platform: string
  os: string
}

export interface CaptureConfig {
  enabled: boolean
  embedded: boolean
  running?: boolean
  apiBase: string
  apiToken: string
  tokenConfigured: boolean
  autoImportQqGids: boolean
}

interface UseAdminSystemConfigOptions {
  showAlert: (message: string, type?: 'primary' | 'danger') => void
}

// 上游后端不再提供 Code/GID 抓取服务配置，入口保留但置灰，避免用户在页面上做无效操作。
const CAPTURE_CONFIG_SUPPORTED = false
const CAPTURE_CONFIG_UNSUPPORTED_MESSAGE = '当前后端版本未提供 Code/GID 抓取服务配置'

const defaultSystemConfigValues: SystemConfig = {
  serverUrl: 'wss://gate-obt.nqf.qq.com/prod/ws',
  clientVersion: '1.13.0.5_20260723',
  platform: 'qq',
  os: 'iOS',
}

const defaultCaptureConfig: CaptureConfig = {
  enabled: true,
  embedded: true,
  running: false,
  apiBase: 'http://127.0.0.1:8450',
  apiToken: '',
  tokenConfigured: false,
  autoImportQqGids: true,
}

export function useAdminSystemConfig(options: UseAdminSystemConfigOptions) {
  const systemConfigSaving = ref(false)
  const systemConfigLoading = ref(false)
  const captureConfigSaving = ref(false)
  const captureConfigTesting = ref(false)

  const localSystemConfig = ref<SystemConfig>({ ...defaultSystemConfigValues })
  const defaultSystemConfig = ref<SystemConfig>({ ...defaultSystemConfigValues })
  const localCaptureConfig = ref<CaptureConfig>({ ...defaultCaptureConfig })

  const platformOptions = [
    { label: 'QQ', value: 'qq' },
    { label: '微信', value: 'wx' },
  ]

  const osOptions = [
    { label: 'iOS', value: 'iOS' },
    { label: 'Android', value: 'Android' },
  ]

  function loadCaptureConfig() {
    localCaptureConfig.value = { ...defaultCaptureConfig }
  }

  function handleTestCaptureConfig() {
    options.showAlert(CAPTURE_CONFIG_UNSUPPORTED_MESSAGE, 'danger')
  }

  async function loadSystemConfig() {
    systemConfigLoading.value = true
    try {
      const { data } = await api.get('/api/settings/system-config')
      if (data?.ok) {
        if (data.data.saved)
          localSystemConfig.value = { ...data.data.saved }
        if (data.data.default)
          defaultSystemConfig.value = { ...data.data.default }
      }
    }
    catch (e: any) {
      console.error('加载系统配置失败:', e)
    }
    finally {
      systemConfigLoading.value = false
    }
  }

  async function handleResetSystemConfig() {
    systemConfigSaving.value = true
    try {
      const { data } = await api.post('/api/settings/system-config/reset', {
        confirmed: true,
      })
      if (data?.ok) {
        localSystemConfig.value = { ...data.data.saved }
        options.showAlert('系统配置已重置为默认值', 'primary')
      }
      else {
        options.showAlert(data?.error || '重置失败', 'danger')
      }
    }
    catch (e: any) {
      options.showAlert(`重置失败: ${e.message || '未知错误'}`, 'danger')
    }
    finally {
      systemConfigSaving.value = false
    }
  }

  return {
    captureConfigSupported: CAPTURE_CONFIG_SUPPORTED,
    captureConfigUnsupportedMessage: CAPTURE_CONFIG_UNSUPPORTED_MESSAGE,
    systemConfigSaving,
    captureConfigSaving,
    captureConfigTesting,
    localSystemConfig,
    defaultSystemConfig,
    localCaptureConfig,
    platformOptions,
    osOptions,
    loadCaptureConfig,
    handleTestCaptureConfig,
    loadSystemConfig,
    handleResetSystemConfig,
  }
}
