<script setup lang="ts">
import { useEventListener, useIntervalFn } from '@vueuse/core'
import { computed, reactive, ref, useId, watch } from 'vue'
import api from '@/api'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseTextarea from '@/components/ui/BaseTextarea.vue'
import { useModalFocus } from '@/composables/useModalFocus'
import { useWxLoginStore } from '@/stores/wx-login'
import { parseManualLoginInput } from '@/utils/gateway-url'

const props = defineProps<{
  show: boolean
  editData?: any
}>()

const emit = defineEmits(['close', 'saved'])

const CODE_QUERY_RE = /[?&]code=([^&]+)/i
const QR_AUTO_REFRESH_MS = 110_000
const QQ_QR_AUTO_REFRESH_MS = 100_000

const wxLoginStore = useWxLoginStore()

const activeTab = ref<'wx' | 'qq' | 'manual'>('manual')
const loading = ref(false)
const wxChecking = ref(false)
const errorMessage = ref('')
const wxAccountName = ref('')
const qqEnabled = ref(false)
const qqAccountName = ref('')
const qqTaskId = ref('')
const qqQrImage = ref('')
const qqStatus = ref('点击获取二维码')
const qqError = ref('')
const qqLoading = ref(false)
const qqQrCreatedAt = ref(0)

const form = reactive({
  name: '',
  code: '',
  platform: 'qq' as 'qq' | 'wx',
})

const { pause: stopWxCheck, resume: startWxCheck } = useIntervalFn(pollWxLogin, 2000, { immediate: false })

async function pollWxLogin(refreshExpired = true) {
  if (!props.show || document.hidden || activeTab.value !== 'wx' || wxLoginStore.isLoading || wxChecking.value)
    return
  if (refreshExpired && shouldRefreshWxQr()) {
    await loadWxQRCode()
    return
  }
  if (wxLoginStore.status !== 'qr_ready' && wxLoginStore.status !== 'confirming')
    return

  wxChecking.value = true
  try {
    const result = await wxLoginStore.checkLogin()
    if (result.success) {
      stopWxCheck()
      const codeResult = await wxLoginStore.getFarmCode()
      if (codeResult.success && codeResult.code) {
        const name = wxAccountName.value.trim() || codeResult.nickname || `微信账号${Date.now()}`
        await addAccount({
          id: props.editData?.id,
          name: props.editData ? (props.editData.name || name) : name,
          code: codeResult.code,
          platform: 'wx',
          loginType: 'wx_qr',
          wxid: codeResult.wxid || '',
        })
      }
    }
  }
  finally {
    wxChecking.value = false
  }
}

useEventListener(document, 'visibilitychange', () => {
  // 先检查原二维码，避免切回时丢弃已在微信确认的登录。
  if (!document.hidden)
    void pollWxLogin(false)
})

const { pause: stopQqCheck, resume: startQqCheck } = useIntervalFn(async () => {
  if (activeTab.value !== 'qq' || !qqTaskId.value || qqLoading.value)
    return
  if (qqQrCreatedAt.value && Date.now() - qqQrCreatedAt.value >= QQ_QR_AUTO_REFRESH_MS) {
    await startQqLogin()
    return
  }
  try {
    const { data } = await api.post(`/api/qq-login/tasks/${qqTaskId.value}/status`, undefined, { timeout: 30000, skipErrorToast: true } as any)
    if (!data?.ok)
      throw new Error(data?.error || '查询扫码状态失败')
    const taskStatus = String(data.data?.status || '')
    if (taskStatus === 'cancelled' || taskStatus === 'expired' || taskStatus === 'failed')
      throw new Error('QQ 登录任务已失效，请重新获取二维码')
    qqStatus.value = taskStatus === 'scanned' ? '已扫码，请在 QQ 中确认' : '请使用 QQ 扫码登录'
    if (taskStatus === 'confirmed') {
      stopQqCheck()
      qqLoading.value = true
      qqStatus.value = '正在获取农场 Code 并清理 QQ 会话…'
      const result = await api.post(`/api/qq-login/tasks/${qqTaskId.value}/code`, undefined, { timeout: 130000, skipErrorToast: true } as any)
      if (!result.data?.ok || !result.data.data?.code)
        throw new Error(result.data?.error || '获取农场 Code 失败')
      const nickname = String(result.data.data.nickname || '')
      qqTaskId.value = ''
      await addAccount({ id: props.editData?.id, name: props.editData?.name || qqAccountName.value.trim() || nickname || `QQ账号${Date.now()}`, code: String(result.data.data.code), platform: 'qq', loginType: 'qq_napcat', startAfterSave: true })
    }
  }
  catch (e: any) {
    stopQqCheck()
    qqError.value = e.response?.data?.error || e.message || 'QQ 扫码登录失败'
  }
  finally { qqLoading.value = false }
}, 1500, { immediate: false })

async function loadQqCapability() {
  try {
    // 上游用同一份登录方式配置控制 NapCat 扫码，未开启时后端会直接拒绝创建任务。
    const { data } = await api.get('/api/settings/login-config', { timeout: 10000, skipErrorToast: true } as any)
    qqEnabled.value = data?.ok && data.data?.qqQrLogin === true
  }
  catch { qqEnabled.value = false }
}

async function cancelQqTask() {
  stopQqCheck()
  const id = qqTaskId.value
  qqTaskId.value = ''
  qqQrImage.value = ''
  qqQrCreatedAt.value = 0
  if (id) {
    try {
      await api.post(`/api/qq-login/tasks/${id}/cancel`, undefined, { timeout: 30000, skipErrorToast: true } as any)
    }
    catch {}
  }
}

async function startQqLogin() {
  if (qqLoading.value)
    return
  qqLoading.value = true
  qqError.value = ''
  await cancelQqTask()
  try {
    const { data } = await api.post('/api/qq-login/tasks', {}, { timeout: 30000, skipErrorToast: true } as any)
    if (!data?.ok || !data.data?.task_id)
      throw new Error(data?.error || '获取 QQ 二维码失败')
    qqTaskId.value = String(data.data.task_id)
    qqQrImage.value = String(data.data.qr_image || '')
    qqQrCreatedAt.value = Date.now()
    qqStatus.value = '请使用 QQ 扫码并确认登录'
    startQqCheck()
  }
  catch (e: any) { qqError.value = e.response?.data?.error || e.message || '获取 QQ 二维码失败' }
  finally { qqLoading.value = false }
}

function shouldRefreshWxQr() {
  return !!wxLoginStore.qrCreatedAt
    && (wxLoginStore.status === 'qr_ready' || wxLoginStore.status === 'confirming')
    && Date.now() - wxLoginStore.qrCreatedAt > QR_AUTO_REFRESH_MS
}

async function loadWxQRCode() {
  if (activeTab.value !== 'wx' || wxLoginStore.isLoading)
    return
  stopWxCheck()
  wxLoginStore.resetState()
  const success = await wxLoginStore.getQRCode()
  if (success)
    startWxCheck()
}

async function addAccount(data: any) {
  loading.value = true
  errorMessage.value = ''
  try {
    const res = await api.post('/api/accounts', data)
    if (res.data.ok) {
      emit('saved')
      close()
    }
    else {
      errorMessage.value = `保存失败: ${res.data.error}`
    }
  }
  catch (e: any) {
    errorMessage.value = `保存失败: ${e.response?.data?.error || e.message}`
  }
  finally {
    loading.value = false
  }
}

async function submitManual() {
  errorMessage.value = ''
  if (!form.code) {
    errorMessage.value = '请输入 Code'
    return
  }

  const parsedInput = parseManualLoginInput(form.code)
  let code = parsedInput.code
  if (!code) {
    errorMessage.value = '请输入有效 Code 或官方 WebSocket URL'
    return
  }
  if (!parsedInput.gatewayUrl) {
    const match = code.match(CODE_QUERY_RE)
    if (match && match[1])
      code = decodeURIComponent(match[1])
  }
  form.code = code
  if (parsedInput.platform)
    form.platform = parsedInput.platform

  // 上游要求备注非空，留空时按平台生成默认名，保持旧版“留空用默认账号名”的行为。
  const name = form.name.trim() || props.editData?.name || `${form.platform === 'qq' ? 'QQ' : '微信'}账号${Date.now()}`

  let payload: any = {}
  if (props.editData) {
    const onlyNameChanged = !parsedInput.gatewayUrl
      && name !== props.editData.name
      && form.code === (props.editData.code || '')
      && form.platform === (props.editData.platform || 'qq')

    if (onlyNameChanged) {
      payload = { id: props.editData.id, name }
    }
    else {
      payload = {
        id: props.editData.id,
        name,
        code,
        platform: form.platform,
        loginType: 'manual',
        ...(parsedInput.gatewayUrl ? { gatewayUrl: parsedInput.gatewayUrl } : {}),
      }
    }
  }
  else {
    payload = {
      name,
      code,
      platform: form.platform,
      loginType: 'manual',
      ...(parsedInput.gatewayUrl ? { gatewayUrl: parsedInput.gatewayUrl } : {}),
    }
  }

  await addAccount(payload)
}

const wxQrImageSrc = computed(() => {
  if (!wxLoginStore.qrCode)
    return ''
  if (wxLoginStore.qrCode.startsWith('data:'))
    return wxLoginStore.qrCode
  if (wxLoginStore.qrCode.startsWith('http'))
    return wxLoginStore.qrCode
  return `data:image/png;base64,${wxLoginStore.qrCode}`
})

function close() {
  stopWxCheck()
  void cancelQqTask()
  wxLoginStore.resetState()
  emit('close')
}

watch(() => props.show, (newVal) => {
  if (newVal) {
    errorMessage.value = ''
    void loadQqCapability()
    if (props.editData) {
      activeTab.value = 'manual'
      form.name = props.editData.name || ''
      form.code = props.editData.code || ''
      form.platform = props.editData.platform || 'qq'
      wxAccountName.value = props.editData.name || ''
      qqAccountName.value = props.editData.name || ''
    }
    else {
      activeTab.value = 'manual'
      form.name = ''
      form.code = ''
      form.platform = 'qq'
      wxAccountName.value = ''
      qqAccountName.value = ''
    }
  }
  else {
    stopWxCheck()
    void cancelQqTask()
    wxLoginStore.resetState()
  }
})

watch(activeTab, (tab) => {
  if (tab === 'wx')
    loadWxQRCode()
  if (tab === 'qq' && !qqTaskId.value)
    void startQqLogin()
  if (tab !== 'qq')
    void cancelQqTask()
})
const modalSurface = ref<HTMLElement | null>(null)
const modalId = useId()
useModalFocus(() => props.show, modalSurface, close)
</script>

<template>
  <div v-if="show" class="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50">
    <div ref="modalSurface" role="dialog" aria-modal="true" :aria-labelledby="`${modalId}-title`" tabindex="-1" class="max-h-[90vh] max-w-md w-full overflow-hidden rounded-lg shadow-xl" :style="{ background: 'var(--theme-bg)' }">
      <div class="flex items-center justify-between border-b p-4" :style="{ borderColor: 'color-mix(in srgb, var(--theme-text) 10%, transparent)' }">
        <h3 :id="`${modalId}-title`" class="text-lg font-semibold" :style="{ color: 'var(--theme-text)' }">
          {{ editData ? '编辑账号' : '添加账号' }}
        </h3>
        <BaseButton variant="ghost" aria-label="关闭弹窗" class="!p-1" @click="close">
          <div class="i-carbon-close text-xl" :style="{ color: 'var(--theme-text)' }" />
        </BaseButton>
      </div>

      <div class="max-h-[calc(90vh-80px)] overflow-y-auto p-4">
        <div v-if="errorMessage" class="mb-4 rounded p-3 text-sm" :style="{ background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444' }">
          {{ errorMessage }}
        </div>

        <div class="mb-4 flex border-b" :style="{ borderColor: 'color-mix(in srgb, var(--theme-text) 10%, transparent)' }">
          <button
            v-if="qqEnabled"
            class="flex-1 py-2 text-center text-sm font-medium transition-colors"
            :class="activeTab === 'qq' ? 'border-b-2' : 'opacity-60'"
            :style="{ color: activeTab === 'qq' ? 'var(--theme-primary)' : 'var(--theme-text)', borderColor: 'var(--theme-primary)' }"
            @click="activeTab = 'qq'"
          >
            QQ 扫码
          </button>
          <button
            class="flex-1 py-2 text-center text-sm font-medium transition-colors"
            :class="activeTab === 'manual' ? 'border-b-2' : 'opacity-60'"
            :style="{
              color: activeTab === 'manual' ? 'var(--theme-primary)' : 'var(--theme-text)',
              borderColor: 'var(--theme-primary)',
            }"
            @click="activeTab = 'manual'"
          >
            手动填码
          </button>
          <button
            class="flex-1 py-2 text-center text-sm font-medium transition-colors"
            :class="activeTab === 'wx' ? 'border-b-2' : 'opacity-60'"
            :style="{
              color: activeTab === 'wx' ? 'var(--theme-primary)' : 'var(--theme-text)',
              borderColor: 'var(--theme-primary)',
            }"
            @click="activeTab = 'wx'"
          >
            微信扫码
          </button>
        </div>

        <div v-if="activeTab === 'qq'" class="space-y-4">
          <BaseInput v-model="qqAccountName" label="账号备注（可选）" placeholder="留空则使用默认账号名" />
          <div class="flex flex-col items-center justify-center py-4 space-y-4">
            <div
              v-if="qqQrImage"
              class="border rounded-lg bg-white p-2 transition-opacity"
              :class="qqLoading ? 'cursor-wait opacity-60' : 'cursor-pointer hover:opacity-80'"
              title="点击刷新二维码"
              role="button"
              tabindex="0"
              @click="!qqLoading && startQqLogin()"
              @keydown.enter.prevent="!qqLoading && startQqLogin()"
              @keydown.space.prevent="!qqLoading && startQqLogin()"
            >
              <img :src="qqQrImage" class="h-48 w-48">
            </div>
            <div v-else class="h-48 w-48 flex items-center justify-center rounded-lg" :style="{ background: 'color-mix(in srgb, var(--theme-bg) 90%, var(--theme-text))' }">
              <div v-if="qqLoading" i-svg-spinners-90-ring-with-bg class="text-3xl" :style="{ color: 'var(--theme-primary)' }" />
              <span v-else class="text-sm" :style="{ color: 'var(--theme-text)' }">正在获取二维码…</span>
            </div>
            <p class="text-center text-sm" :style="{ color: 'var(--theme-text)' }">
              {{ qqStatus }}
            </p>
            <p v-if="qqError" class="text-center text-sm text-red-600">
              {{ qqError }}
            </p>
          </div>
          <div class="text-center text-xs opacity-60" :style="{ color: 'var(--theme-text)' }">
            扫码成功后会自动获取 Code，并退出临时 NapCat QQ 会话
          </div>
        </div>

        <div v-if="activeTab === 'wx'" class="space-y-4">
          <BaseInput
            v-model="wxAccountName"
            label="账号备注（可选）"
            placeholder="留空则使用微信昵称"
          />

          <div class="flex flex-col items-center justify-center py-4 space-y-4">
            <div
              v-if="wxQrImageSrc"
              class="border rounded-lg p-2"
              :style="{ borderColor: 'color-mix(in srgb, var(--theme-text) 20%, transparent)', background: '#fff' }"
            >
              <img :src="wxQrImageSrc" class="h-48 w-48">
            </div>
            <div
              v-else
              class="h-48 w-48 flex cursor-pointer items-center justify-center rounded-lg transition-opacity hover:opacity-80"
              :style="{ background: 'color-mix(in srgb, var(--theme-bg) 90%, var(--theme-text))' }"
              role="button"
              tabindex="0"
              @click="loadWxQRCode"
              @keydown.enter.prevent="loadWxQRCode"
              @keydown.space.prevent="loadWxQRCode"
            >
              <div v-if="wxLoginStore.isLoading" i-svg-spinners-90-ring-with-bg class="text-3xl" :style="{ color: 'var(--theme-primary)' }" />
              <span v-else class="text-sm" :style="{ color: 'var(--theme-text)' }">点击获取二维码</span>
            </div>

            <p class="text-center text-sm" :style="{ color: 'var(--theme-text)' }">
              {{ wxLoginStore.statusMessage }}
            </p>

            <p v-if="wxLoginStore.errorMessage" class="text-center text-sm text-red-600">
              {{ wxLoginStore.errorMessage }}
            </p>

            <BaseButton variant="secondary" size="sm" :loading="wxLoginStore.isLoading" @click="loadWxQRCode">
              {{ wxLoginStore.qrCode ? '刷新二维码' : '获取二维码' }}
            </BaseButton>
          </div>

          <div class="text-center text-xs opacity-60" :style="{ color: 'var(--theme-text)' }">
            使用微信扫描二维码登录，成功后会自动添加账号
          </div>
        </div>

        <div v-if="activeTab === 'manual'" class="space-y-4">
          <BaseInput
            v-model="form.name"
            label="账号备注（可选）"
            placeholder="留空则使用默认账号名"
          />

          <BaseTextarea
            v-model="form.code"
            label="Code"
            placeholder="请输入登录 Code"
            :rows="3"
          />

          <div v-if="!editData" class="flex gap-4">
            <label class="flex cursor-pointer items-center gap-2">
              <input
                v-model="form.platform"
                type="radio"
                value="qq"
                class="h-4 w-4"
                :style="{ accentColor: 'var(--theme-primary)' }"
              >
              <span class="text-sm" :style="{ color: 'var(--theme-text)' }">QQ 小程序</span>
            </label>
            <label class="flex cursor-pointer items-center gap-2">
              <input
                v-model="form.platform"
                type="radio"
                value="wx"
                class="h-4 w-4"
                :style="{ accentColor: 'var(--theme-primary)' }"
              >
              <span class="text-sm" :style="{ color: 'var(--theme-text)' }">微信小程序</span>
            </label>
          </div>

          <div class="flex justify-end gap-2 pt-4">
            <BaseButton variant="outline" @click="close">
              取消
            </BaseButton>
            <BaseButton variant="primary" :loading="loading" @click="submitManual">
              {{ editData ? '保存' : '添加' }}
            </BaseButton>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
