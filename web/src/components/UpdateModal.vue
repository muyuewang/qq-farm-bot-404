<script setup lang="ts">
import { computed, ref } from 'vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import { useModalFocus } from '@/composables/useModalFocus'
import { useUpdateStore } from '@/stores/update'

/**
 * 版本更新弹窗。
 *
 * 只展示宿主机更新器写进状态文件的进度：面板不拉代码、不构建、不重启，
 * 所以这里没有任何「正在下载」之类的臆造阶段，四个步骤全部来自 status.step。
 */
const updateStore = useUpdateStore()

const surface = ref<HTMLElement | null>(null)
const status = computed(() => updateStore.status || {})
const running = computed(() => status.value.state === 'running' || !!status.value.requestPending)
const hasUpdate = computed(() => !!status.value.hasUpdate)
const succeeded = computed(() => status.value.state === 'success')
const failed = computed(() => status.value.state === 'failed')
/** 完全没有状态文件：说明宿主机没装 tools/updater，不是「已是最新」。 */
const notInstalled = computed(() => !status.value.checkedAt)

const steps = [
  { key: 'prepare', label: '准备' },
  { key: 'build', label: '构建' },
  { key: 'restart', label: '重启' },
  { key: 'health', label: '健康检查' },
]
const activeStep = computed(() => steps.findIndex(step => step.key === status.value.step))
const commits = computed(() => (status.value.commits || []).slice(0, 12))

const checkedText = computed(() => {
  const ts = Number(status.value.checkedAt) || 0
  if (!ts)
    return '尚未检查'
  const date = new Date(ts)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getMonth() + 1}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
})

function close() {
  // 更新期间不允许关掉：关了就看不到进度，也容易以为可以重复点。
  if (running.value)
    return
  updateStore.modalOpen = false
}

useModalFocus(() => updateStore.modalOpen, surface, close)
</script>

<template>
  <Teleport to="body">
    <div
      v-if="updateStore.modalOpen"
      class="fixed inset-0 z-[10050] flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm"
      @click="close"
    >
      <div
        ref="surface"
        class="max-h-[85vh] max-w-lg w-full overflow-y-auto rounded-2xl bg-white p-5 shadow-xl dark:bg-gray-800"
        role="dialog"
        aria-modal="true"
        aria-labelledby="update-dialog-title"
        tabindex="-1"
        @click.stop
      >
        <div class="flex items-start justify-between gap-3">
          <h3 id="update-dialog-title" class="text-base font-semibold">
            版本更新
          </h3>
          <span v-if="running" class="shrink-0 rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
            更新中
          </span>
        </div>

        <div class="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-gray-50 px-3 py-2 dark:bg-gray-900/40">
          <span class="text-xs text-gray-500">当前</span>
          <span class="text-sm font-medium tabular-nums">{{ status.deployedShort || '未知' }}</span>
          <span class="i-carbon-arrow-right text-xs text-gray-400" />
          <span class="text-xs text-gray-500">最新</span>
          <span class="text-sm font-medium tabular-nums" :class="{ 'text-emerald-600 dark:text-emerald-400': hasUpdate }">
            {{ status.latestShort || '未知' }}
          </span>
          <span class="ml-auto text-[11px] text-gray-400">检查于 {{ checkedText }}</span>
        </div>

        <div v-if="running" class="mt-4">
          <div class="flex flex-wrap items-center gap-2">
            <template v-for="(step, index) in steps" :key="step.key">
              <div class="flex items-center gap-1.5">
                <span
                  class="h-2 w-2 rounded-full"
                  :class="[
                    activeStep > index ? 'bg-emerald-500' : activeStep === index ? 'bg-amber-500 animate-pulse' : 'bg-gray-300 dark:bg-gray-600',
                  ]"
                />
                <span
                  class="text-xs"
                  :class="activeStep === index ? 'text-gray-800 font-medium dark:text-gray-100' : 'text-gray-500'"
                >
                  {{ step.label }}
                </span>
              </div>
              <span v-if="index < steps.length - 1" class="h-px w-6 bg-gray-200 dark:bg-gray-700" />
            </template>
          </div>
          <p class="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 leading-5 dark:bg-amber-950/40 dark:text-amber-300">
            {{ status.message || '正在更新，页面会自动重连…' }}
          </p>
        </div>

        <template v-else>
          <p v-if="succeeded" class="mt-4 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
            {{ status.message || '更新完成' }}，如页面数据未刷新请手动刷新。
          </p>
          <p v-else-if="failed" class="mt-4 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-950/40 dark:text-red-300">
            {{ status.message || '更新失败' }}
          </p>
          <template v-else-if="hasUpdate">
            <p class="mt-4 text-xs text-gray-500">
              上游有 {{ status.behind || commits.length }} 个新提交：
            </p>
            <ul class="mt-2 max-h-48 overflow-y-auto rounded-lg bg-gray-50 px-3 py-2 text-xs space-y-1 dark:bg-gray-900/40">
              <li v-for="(item, index) in commits" :key="index" class="truncate" :title="item">
                {{ item }}
              </li>
            </ul>
            <p class="mt-3 text-[11px] text-amber-700 leading-5 dark:text-amber-300">
              更新会重建容器并短暂中断服务。微信账号的登录 Code 是一次性的，更新后需要重新扫码。
            </p>
          </template>
          <p v-else-if="notInstalled" class="mt-4 text-xs text-gray-500 leading-5">
            尚未检测到宿主机更新器。如需在面板内检查和安装更新，请按 docs/updater.md 部署 tools/updater 后重试。
          </p>
          <p v-else class="mt-4 text-xs text-gray-500">
            当前已是最新版本。
          </p>
        </template>

        <div class="grid grid-cols-3 mt-5 gap-2">
          <BaseButton variant="secondary" :disabled="running" @click="close">
            关闭
          </BaseButton>
          <BaseButton variant="secondary" :loading="updateStore.checking" :disabled="running || notInstalled" @click="updateStore.check()">
            检查更新
          </BaseButton>
          <BaseButton variant="primary" :disabled="running || !hasUpdate || notInstalled" @click="updateStore.apply()">
            {{ running ? '更新中…' : '立即更新' }}
          </BaseButton>
        </div>
      </div>
    </div>
  </Teleport>
</template>
