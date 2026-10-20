<script setup lang="ts">
import type { CaptureConfig, SystemConfig } from '@/composables/useAdminSystemConfig'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSwitch from '@/components/ui/BaseSwitch.vue'

interface OptionItem {
  label: string
  value: string
}

const props = withDefaults(defineProps<{
  section: 'system' | 'capture' | 'qq-login'
  defaultSystemConfig: SystemConfig
  platformOptions: OptionItem[]
  osOptions: OptionItem[]
  systemConfigSaving: boolean
  captureConfigSaving: boolean
  captureConfigTesting: boolean
  napcatLoginSaving?: boolean
  showHeading?: boolean
  showSave?: boolean
}>(), {
  showHeading: true,
  showSave: true,
  napcatLoginSaving: false,
})

defineEmits<{
  resetSystem: []
  saveSystem: []
  testCapture: []
  saveCapture: []
  saveNapcatLogin: []
}>()

const localSystemConfig = defineModel<SystemConfig>('localSystemConfig', { required: true })
const localCaptureConfig = defineModel<CaptureConfig>('localCaptureConfig', { required: true })
</script>

<template>
  <div class="space-y-4">
    <h3 v-if="showHeading" class="text-lg text-gray-900 font-bold dark:text-gray-100">
      {{ props.section === 'system' ? '系统配置' : '抓包服务' }}
    </h3>

    <div v-if="props.section === 'system'" class="rounded-2xl bg-gray-50 px-4 py-3 text-sm text-gray-600 dark:bg-gray-900/40 dark:text-gray-300">
      修改后会直接影响全局连接参数与微信登录行为，保存前建议再次核对目标环境。
    </div>

    <div class="space-y-4">
      <div v-if="props.section === 'system'" class="border border-gray-200 rounded-lg bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
        <h4 class="mb-3 flex items-center gap-2 text-base text-gray-900 font-bold dark:text-gray-100">
          <div class="i-carbon-settings" />
          系统配置
        </h4>

        <div class="grid gap-3 md:grid-cols-3">
          <div class="rounded-2xl bg-gray-50 px-4 py-3 text-sm text-gray-700 dark:bg-gray-900/40 dark:text-gray-200">
            <div class="text-xs text-gray-500 dark:text-gray-400">
              当前平台
            </div>
            <div class="mt-1 font-semibold">
              {{ platformOptions.find(option => option.value === localSystemConfig.platform)?.label || '未设置' }}
            </div>
          </div>
          <div class="rounded-2xl bg-gray-50 px-4 py-3 text-sm text-gray-700 dark:bg-gray-900/40 dark:text-gray-200">
            <div class="text-xs text-gray-500 dark:text-gray-400">
              当前系统
            </div>
            <div class="mt-1 font-semibold">
              {{ localSystemConfig.os }}
            </div>
          </div>
          <div class="rounded-2xl bg-gray-50 px-4 py-3 text-sm text-gray-700 dark:bg-gray-900/40 dark:text-gray-200">
            <div class="text-xs text-gray-500 dark:text-gray-400">
              默认版本
            </div>
            <div class="mt-1 font-semibold">
              QQ {{ defaultSystemConfig.clientVersion }}
            </div>
            <div class="font-semibold">
              微信 {{ defaultSystemConfig.wxClientVersion }}
            </div>
          </div>
        </div>

        <div class="mb-3 rounded-2xl bg-gray-50 px-4 py-3 text-xs text-gray-500 dark:bg-gray-900/40 dark:text-gray-400">
          服务器地址与客户端版本通常需要成对调整，建议先在测试环境验证，再同步到生产使用。
        </div>

        <div class="mb-3 rounded-2xl bg-amber-50 px-4 py-3 text-xs text-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
          保存后会立刻更新全局连接参数，已在运行的账号要在下次登录才会用上新的版本号。若服务器地址、平台或系统版本不匹配，可能导致后续账号连接异常。
        </div>

        <div class="grid grid-cols-2 gap-3 text-sm">
          <BaseInput
            v-model="localSystemConfig.serverUrl"
            label="服务器地址"
            type="text"
            placeholder="wss://..."
            class="col-span-2"
          />
          <BaseInput
            v-model="localSystemConfig.clientVersion"
            label="QQ 客户端版本"
            type="text"
            :placeholder="defaultSystemConfig.clientVersion"
          />
          <BaseInput
            v-model="localSystemConfig.wxClientVersion"
            label="微信客户端版本"
            type="text"
            :placeholder="defaultSystemConfig.wxClientVersion"
          />
          <div class="flex flex-col gap-1.5">
            <label class="text-sm text-gray-700 font-medium dark:text-gray-300">平台</label>
            <div class="flex gap-2">
              <button
                v-for="option in platformOptions"
                :key="option.value"
                class="rounded-lg px-3 py-1.5 text-sm transition-all"
                :class="localSystemConfig.platform === option.value
                  ? 'text-white shadow-sm'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'"
                :style="localSystemConfig.platform === option.value ? { backgroundColor: 'var(--theme-primary)' } : {}"
                @click="localSystemConfig.platform = option.value"
              >
                {{ option.label }}
              </button>
            </div>
          </div>
          <div class="flex flex-col gap-1.5">
            <label class="text-sm text-gray-700 font-medium dark:text-gray-300">系统</label>
            <div class="flex gap-2">
              <button
                v-for="option in osOptions"
                :key="option.value"
                class="rounded-lg px-3 py-1.5 text-sm transition-all"
                :class="localSystemConfig.os === option.value
                  ? 'text-white shadow-sm'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'"
                :style="localSystemConfig.os === option.value ? { backgroundColor: 'var(--theme-primary)' } : {}"
                @click="localSystemConfig.os = option.value"
              >
                {{ option.label }}
              </button>
            </div>
          </div>
        </div>

        <div class="mt-3 flex justify-end gap-2">
          <BaseButton
            variant="secondary"
            size="sm"
            :loading="systemConfigSaving"
            @click="$emit('resetSystem')"
          >
            重置
          </BaseButton>
          <BaseButton
            v-if="showSave"
            variant="primary"
            size="sm"
            :loading="systemConfigSaving"
            @click="$emit('saveSystem')"
          >
            保存
          </BaseButton>
        </div>
      </div>

      <div v-if="props.section === 'capture'" class="border border-gray-200 rounded-lg bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
        <h4 class="mb-3 flex items-center gap-2 text-base text-gray-900 font-bold dark:text-gray-100">
          <div class="i-carbon-data-connected" />
          Code/GID 抓取服务
        </h4>

        <div class="grid mb-3 gap-3 md:grid-cols-3">
          <div class="rounded-lg bg-gray-50 px-4 py-3 text-sm text-gray-700 dark:bg-gray-900/40 dark:text-gray-200">
            <div class="text-xs text-gray-500 dark:text-gray-400">
              添加账号入口
            </div>
            <div class="mt-1 font-semibold">
              {{ localCaptureConfig.enabled && localCaptureConfig.running !== false ? '已开放' : '已关闭' }}
            </div>
          </div>
          <div class="rounded-lg bg-gray-50 px-4 py-3 text-sm text-gray-700 dark:bg-gray-900/40 dark:text-gray-200">
            <div class="text-xs text-gray-500 dark:text-gray-400">
              API Token
            </div>
            <div class="mt-1 font-semibold">
              {{ localCaptureConfig.embedded ? '嵌入模式' : (localCaptureConfig.apiToken || localCaptureConfig.tokenConfigured ? '已配置' : '未配置') }}
            </div>
          </div>
          <div class="rounded-lg bg-gray-50 px-4 py-3 text-sm text-gray-700 dark:bg-gray-900/40 dark:text-gray-200">
            <div class="text-xs text-gray-500 dark:text-gray-400">
              QQ 好友 GID
            </div>
            <div class="mt-1 font-semibold">
              {{ localCaptureConfig.autoImportQqGids ? '自动导入' : '不导入' }}
            </div>
          </div>
        </div>

        <div class="grid grid-cols-2 gap-3 text-sm">
          <div class="col-span-2">
            <BaseSwitch
              v-model="localCaptureConfig.enabled"
              label="允许使用抓包登录添加账号"
            />
            <div v-if="localCaptureConfig.embedded" class="mt-1 text-xs opacity-70" style="color: var(--theme-text);">
              默认开启并随应用启动嵌入服务；关闭后停止服务，手机 Wi-Fi 代理端口固定为 18000
            </div>
          </div>
          <template v-if="!localCaptureConfig.embedded">
            <BaseInput
              v-model="localCaptureConfig.apiBase"
              label="抓包服务地址"
              type="text"
              placeholder="http://127.0.0.1:8450"
              class="col-span-2"
            />
            <BaseInput
              v-model="localCaptureConfig.apiToken"
              label="API Token"
              type="password"
              :placeholder="localCaptureConfig.tokenConfigured ? '已配置，留空保持不变' : '请输入抓包服务 API Token'"
              class="col-span-2"
            />
          </template>
          <div class="col-span-2">
            <BaseSwitch
              v-model="localCaptureConfig.autoImportQqGids"
              label="QQ 抓取完成后自动导入好友 GID"
            />
          </div>
        </div>

        <div class="mt-3 flex flex-wrap justify-end gap-2">
          <BaseButton
            variant="secondary"
            size="sm"
            :loading="captureConfigTesting"
            :disabled="localCaptureConfig.embedded && localCaptureConfig.running === false"
            @click="$emit('testCapture')"
          >
            <span class="i-carbon-connection-signal" />
            测试连接
          </BaseButton>
          <BaseButton
            v-if="showSave"
            variant="primary"
            size="sm"
            :loading="captureConfigSaving"
            @click="$emit('saveCapture')"
          >
            保存
          </BaseButton>
        </div>
      </div>

      <div v-if="props.section === 'qq-login'" class="border border-gray-200 rounded-lg bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
        <h4 class="mb-3 flex items-center gap-2 text-base text-gray-900 font-bold dark:text-gray-100">
          <div class="i-carbon-qr-code" />
          QQ 扫码登录
        </h4>

        <div class="grid mb-3 gap-3 md:grid-cols-2">
          <div class="rounded-lg bg-gray-50 px-4 py-3 text-sm text-gray-700 dark:bg-gray-900/40 dark:text-gray-200">
            <div class="text-xs text-gray-500 dark:text-gray-400">
              QQ 扫码登录入口
            </div>
            <div class="mt-1 font-semibold">
              {{ localSystemConfig.napcatLoginEnabled ? '已开启' : '已关闭' }}
            </div>
          </div>
          <div class="rounded-lg bg-gray-50 px-4 py-3 text-sm text-gray-700 dark:bg-gray-900/40 dark:text-gray-200">
            <div class="text-xs text-gray-500 dark:text-gray-400">
              NapCat 容器
            </div>
            <div class="mt-1 font-semibold">
              需要单独部署
            </div>
          </div>
        </div>

        <div class="rounded-2xl bg-blue-50 px-4 py-3 text-xs text-blue-800 dark:bg-blue-900/20 dark:text-blue-200 mb-3">
          开启后，用户可在「新增账号 → QQ 扫码」中扫描二维码完成登录。需要先部署 NapCat 容器。
        </div>

        <div class="grid grid-cols-1 gap-3 text-sm">
          <div>
            <BaseSwitch
              v-model="localSystemConfig.napcatLoginEnabled"
              label="允许使用 QQ 扫码登录添加账号"
            />
          </div>
        </div>

        <div class="mt-3 flex justify-end gap-2">
          <BaseButton
            v-if="showSave"
            variant="primary"
            size="sm"
            :loading="napcatLoginSaving"
            @click="$emit('saveNapcatLogin')"
          >
            保存
          </BaseButton>
        </div>
      </div>
    </div>
  </div>
</template>
