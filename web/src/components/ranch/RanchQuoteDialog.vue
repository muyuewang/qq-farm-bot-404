<script setup lang="ts">
import type { RanchQuoteHandle } from '@/stores/ranch'
import type { RanchRequest } from '@/utils/ranch'
import { computed, ref, watch } from 'vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import { useModalFocus } from '@/composables/useModalFocus'
import { useRanchStore } from '@/stores/ranch'
import { describeQuote, itemLine } from '@/utils/ranch'

const props = defineProps<{
  show: boolean
  accountId: string | null
  request: RanchRequest | null
}>()

const emit = defineEmits<{
  close: []
  done: [result: { ok: boolean, message?: string, error?: string, action?: string }]
}>()

const ranchStore = useRanchStore()
const surface = ref<HTMLElement | null>(null)
const handle = ref<RanchQuoteHandle | null>(null)
const quoteError = ref('')

useModalFocus(() => props.show, surface, () => close())

const summary = computed(() => describeQuote(handle.value?.quote))
const loading = computed(() => ranchStore.quoting || ranchStore.acting)
const canConfirm = computed(() => !!handle.value && !loading.value)

async function loadQuote() {
  handle.value = null
  quoteError.value = ''
  if (!props.request || !props.accountId)
    return
  const result = await ranchStore.quote(props.accountId, props.request.action, props.request.input)
  if (result)
    handle.value = result
  else
    quoteError.value = ranchStore.error || '牧场报价失败'
}

function close() {
  if (loading.value)
    return
  handle.value = null
  quoteError.value = ''
  emit('close')
}

async function confirm() {
  if (!canConfirm.value || !props.accountId || !handle.value)
    return
  const action = handle.value.action
  // 后端把报价标成 skipped 时没有要执行的内容，「已知悉」只关闭弹窗，不发写请求。
  if (summary.value.skipped) {
    emit('done', { ok: true, action, message: handle.value.quote.message || '当前没有需要执行的操作' })
    close()
    return
  }
  const result = await ranchStore.execute(props.accountId, handle.value)
  emit('done', {
    ok: result.ok,
    action,
    message: result.ok ? (result.message || '操作已完成') : undefined,
    error: result.ok ? undefined : (result.error || '牧场操作失败'),
  })
  if (result.ok)
    close()
}

watch(() => [props.show, props.request] as const, ([show]) => {
  if (show)
    loadQuote()
}, { immediate: true })
</script>

<template>
  <Teleport to="body">
    <div v-if="show && request" class="fixed inset-0 z-[10050] flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm" @click="close">
      <div
        ref="surface"
        class="max-h-[85vh] max-w-md w-full overflow-y-auto rounded-2xl bg-white p-5 shadow-xl dark:bg-gray-800"
        role="dialog"
        aria-modal="true"
        tabindex="-1"
        @click.stop
      >
        <div class="flex items-start justify-between gap-3">
          <h3 class="text-base font-semibold">
            {{ request.title }}
          </h3>
          <span v-if="request.danger" class="shrink-0 rounded-md bg-red-50 px-2 py-1 text-xs text-red-600 dark:bg-red-950/40 dark:text-red-300">
            不可撤销
          </span>
        </div>
        <p v-if="request.note" class="mt-2 text-xs text-gray-500 leading-5 dark:text-gray-400">
          {{ request.note }}
        </p>

        <div v-if="ranchStore.quoting" class="mt-4 rounded-lg bg-gray-50 p-4 text-center text-sm text-gray-500 dark:bg-gray-900/40">
          正在向服务端取价，请稍候…
        </div>
        <div v-else-if="quoteError" class="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-600 dark:bg-red-950/40 dark:text-red-300">
          {{ quoteError }}
        </div>
        <div v-else-if="handle" class="mt-4 space-y-3">
          <div class="rounded-lg bg-gray-50 p-3 text-sm dark:bg-gray-900/40">
            <p class="font-medium">
              {{ handle.quote.label || request.title }}
            </p>
            <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
              {{ summary.summary }}
            </p>
          </div>
          <div v-if="summary.detail.length" class="grid grid-cols-2 gap-2 text-xs">
            <div v-for="item in summary.detail" :key="`${item.id}-${item.count}`" class="flex items-center gap-2 border border-gray-200 rounded-lg px-2 py-1.5 dark:border-gray-700">
              <img v-if="item.image" :src="item.image" :alt="item.name" class="h-6 w-6 rounded object-contain">
              <span class="truncate">{{ itemLine(item) }}</span>
            </div>
          </div>
          <p class="text-[11px] text-gray-500 leading-5 dark:text-gray-400">
            价格与奖励由服务端当场核算，确认后按这份报价执行；若期间状态变化，后端会拒绝并要求重新确认。
          </p>
          <div v-if="summary.skipped" class="rounded-lg bg-amber-50 p-3 text-xs text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
            当前没有需要执行的操作，确认后不会发起写请求。
          </div>
        </div>

        <div v-if="ranchStore.acting && handle" class="mt-3 rounded-lg bg-blue-50 p-3 text-xs text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">
          {{ ranchStore.error || '正在执行…' }}
        </div>

        <div class="grid grid-cols-2 mt-5 gap-3">
          <BaseButton variant="secondary" :disabled="loading" @click="close">
            取消
          </BaseButton>
          <BaseButton :variant="request.danger ? 'danger' : 'primary'" :loading="loading" :disabled="!canConfirm" @click="confirm">
            {{ summary.skipped ? '已知悉' : '确认执行' }}
          </BaseButton>
        </div>
      </div>
    </div>
  </Teleport>
</template>
