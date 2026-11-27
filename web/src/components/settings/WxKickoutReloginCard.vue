<script setup lang="ts">
import { computed } from 'vue'
import type { WxKickoutReloginConfig, WxKickoutReloginStatus } from '@/composables/settings/useWxKickoutRelogin'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSwitch from '@/components/ui/BaseSwitch.vue'

const props = defineProps<{
  saving: boolean
  status: WxKickoutReloginStatus | null
  error?: string | null
}>()

const emit = defineEmits<{
  save: []
}>()

const config = defineModel<WxKickoutReloginConfig>('config', { required: true })

function toLocalInput(iso: string) {
  const ts = Date.parse(iso)
  if (!Number.isFinite(ts))
    return ''
  const date = new Date(ts)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

const validUntilInput = computed({
  get: () => toLocalInput(config.value.validUntil),
  set: (value: string) => {
    if (!value) {
      config.value.validUntil = ''
      return
    }
    const ts = Date.parse(value)
    config.value.validUntil = Number.isFinite(ts) ? new Date(ts).toISOString() : ''
  },
})

const nextRunText = computed(() => {
  const ts = Number(props.status?.nextRunAt) || 0
  return ts ? ` · 下次 ${new Date(ts).toLocaleString()}` : ''
})

const statusLabel = computed(() => {
  if (props.error)
    return '自动连回状态读取失败'
  if (props.status?.blocked)
    return '微信授权已失效，请重新扫码'
  if (props.status?.enabled === false)
    return '自动连回已关闭'
  if (!props.status)
    return '状态读取中'
  if (!props.status.bound || !props.status.credentialReady)
    return '当前账号尚未保存可复用凭据，重新扫码一次即可'
  if (props.status.pending)
    return `已排程自动连回${nextRunText.value}`
  return '自动连回已就绪'
})

const statusTone = computed(() => {
  if (props.error || props.status?.blocked)
    return 'text-red-700 bg-red-50 dark:bg-red-900/30 dark:text-red-300'
  if (!props.status || props.status?.enabled === false)
    return 'text-gray-500 bg-gray-100 dark:bg-gray-700 dark:text-gray-300'
  if (!props.status.bound || !props.status.credentialReady)
    return 'text-amber-700 bg-amber-50 dark:bg-amber-900/30 dark:text-amber-300'
  return 'text-green-700 bg-green-50 dark:bg-green-900/30 dark:text-green-300'
})

function extendValidUntil(hours: number) {
  config.value.validUntil = new Date(Date.now() + hours * 60 * 60_000).toISOString()
}
</script>

<template>
  <div class="border border-gray-200 rounded-lg bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
    <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
      <h4 class="flex items-center gap-2 text-base text-gray-900 font-bold dark:text-gray-100">
        <div class="i-carbon-renew" />
        微信被踢自动连回
      </h4>
      <span class="rounded-full px-2 py-1 text-xs font-medium" :class="statusTone">
        {{ statusLabel }}
      </span>
    </div>

    <div class="space-y-3">
      <p v-if="error" class="text-xs text-red-600 dark:text-red-400">
        {{ error }}
      </p>
      <div class="flex flex-wrap items-center gap-3">
        <BaseSwitch v-model="config.enabled" label="启用" />
        <p class="text-xs text-gray-500 dark:text-gray-400">
          全局开关，状态按当前账号显示，仅微信账号生效。被踢或登录态失效后按退避重新换取全新 Code，不重放旧 Code；普通网络断线仍保持原策略。
        </p>
      </div>

      <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
        <BaseInput
          v-model.number="config.delayMinutes"
          label="重登延迟 (分钟)"
          type="number"
          min="0"
          max="4320"
          placeholder="0=默认规则"
        />
        <BaseInput
          v-model.number="config.dailyLimit"
          label="每日自动连回次数"
          type="number"
          min="0"
          max="999"
          placeholder="0=不限"
        />
      </div>

      <div class="flex flex-wrap items-end gap-2">
        <label class="flex flex-col gap-1">
          <span class="text-xs text-gray-500 dark:text-gray-400">自定义延迟有效期至</span>
          <input
            v-model="validUntilInput"
            type="datetime-local"
            class="w-52 border border-gray-200 rounded bg-white px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white"
          >
        </label>
        <BaseButton variant="secondary" size="sm" @click="extendValidUntil(6)">
          +6 小时
        </BaseButton>
        <BaseButton variant="secondary" size="sm" @click="extendValidUntil(24)">
          +24 小时
        </BaseButton>
        <BaseButton variant="text" size="sm" @click="config.validUntil = ''">
          不限期
        </BaseButton>
      </div>

      <p class="text-xs text-gray-500 dark:text-gray-400">
        延迟为 0 时使用 5 分钟 → 30 分钟 → 1 小时 → 3 小时的递增退避；每日上限默认 5 次，按 UTC 日切（北京时间 08:00 重置），填 0 表示不限次数。微信授权明确失效后必须重新扫码。
      </p>

      <div class="flex justify-end">
        <BaseButton size="sm" :loading="saving" :disabled="saving" @click="emit('save')">
          保存自动连回设置
        </BaseButton>
      </div>
    </div>
  </div>
</template>
