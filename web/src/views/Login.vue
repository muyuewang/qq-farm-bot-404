<script setup lang="ts">
import { useStorage } from '@vueuse/core'
import { computed, onBeforeUnmount, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import api from '@/api'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import { useAppStore } from '@/stores/app'

const route = useRoute()
const router = useRouter()
const appStore = useAppStore()
const tokenRef = useStorage('admin_token', '')

const username = ref('admin')
const password = ref('')
const submitting = ref(false)
const errorMessage = ref('')
// 后端在 423/429 时返回 remainingMs；用它把解锁倒计时显示出来，倒计时结束前禁止再次提交。
const blockedUntil = ref(0)
const now = ref(Date.now())
let countdown: ReturnType<typeof setInterval>

const brandTitle = computed(() => appStore.loginPageConfig.title || 'QQ农场智能助手')
const blockedRemaining = computed(() => Math.max(0, blockedUntil.value - now.value))
const blockedText = computed(() => {
  const seconds = Math.ceil(blockedRemaining.value / 1000)
  if (seconds <= 0)
    return ''
  if (seconds >= 60)
    return `${Math.ceil(seconds / 60)} 分钟`
  return `${seconds} 秒`
})
const canSubmit = computed(() => !submitting.value && blockedRemaining.value <= 0 && !!password.value)

countdown = setInterval(() => now.value = Date.now(), 1000)

const showPasswordForm = ref(false)
const newPassword = ref('')
const confirmPassword = ref('')
const changingPassword = ref(false)
const changeMessage = ref('')
const passwordMismatch = computed(() => !!confirmPassword.value && newPassword.value !== confirmPassword.value)
const canChangePassword = computed(() => !!newPassword.value && newPassword.value === confirmPassword.value && !changingPassword.value)

function failureMessage(error: any) {
  const payload = error?.response?.data
  const remainingMs = Number(payload?.remainingMs) || 0
  if (payload?.errorType === 'locked')
    return `连续登录失败次数过多，账号已锁定，请在 ${Math.max(1, Math.ceil(remainingMs / 60000))} 分钟后重试`
  if (payload?.errorType === 'rate_limit')
    return `登录尝试过于频繁，请在 ${Math.max(1, Math.ceil(remainingMs / 1000))} 秒后重试`
  return String(payload?.error || error?.message || '登录失败，请稍后重试')
}

async function submit() {
  if (!canSubmit.value)
    return
  submitting.value = true
  errorMessage.value = ''
  try {
    const { data } = await api.post('/api/login', { username: username.value.trim(), password: password.value }, { skipErrorToast: true } as any)
    if (!data?.ok || !data?.data?.token)
      throw Object.assign(new Error(String(data?.error || '登录失败')), { response: { data } })
    tokenRef.value = data.data.token
    showPasswordForm.value = data.data.mustChangePassword === true
    if (!showPasswordForm.value)
      await goHome()
  }
  catch (error: any) {
    const payload = error?.response?.data
    const remainingMs = Number(payload?.remainingMs) || 0
    if (payload?.errorType === 'locked' || payload?.errorType === 'rate_limit')
      blockedUntil.value = Date.now() + remainingMs
    errorMessage.value = failureMessage(error)
  }
  finally {
    submitting.value = false
  }
}

async function changePassword() {
  if (!canChangePassword.value)
    return
  changingPassword.value = true
  changeMessage.value = ''
  try {
    const { data } = await api.post('/api/user/change-password', { oldPassword: password.value, newPassword: newPassword.value }, { skipErrorToast: true } as any)
    if (!data?.ok)
      throw new Error(String(data?.error || '密码修改失败'))
    // 后端修改成功后会吊销全部 token，必须重新登录。
    tokenRef.value = ''
    password.value = ''
    newPassword.value = ''
    confirmPassword.value = ''
    showPasswordForm.value = false
    changeMessage.value = '密码已修改，请使用新密码重新登录'
  }
  catch (error: any) {
    changeMessage.value = String(error?.response?.data?.error || error?.message || '密码修改失败')
  }
  finally {
    changingPassword.value = false
  }
}

async function goHome() {
  const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/'
  await router.replace(redirect.startsWith('/') ? redirect : '/')
}

onBeforeUnmount(() => clearInterval(countdown))
</script>

<template>
  <div class="login-root h-full w-full overflow-auto" :style="{ color: 'var(--theme-text)' }">
    <div class="mx-auto flex min-h-full max-w-md flex-col justify-center gap-6 px-5 py-10">
      <header class="flex flex-col items-center gap-3 text-center">
        <div class="h-14 w-14 flex items-center justify-center overflow-hidden rounded-2xl ring-1 ring-white/40 shadow-sm">
          <img src="/icon.png" :alt="`${brandTitle}图标`" class="h-full w-full object-cover">
        </div>
        <h1 class="text-xl font-bold sm:text-2xl">
          {{ brandTitle }}
        </h1>
        <p class="text-sm" :style="{ color: 'var(--muted-text)' }">
          登录后可继续管理农场账号与自动化任务
        </p>
      </header>

      <section class="ui-card-elevated rounded-2xl p-5 sm:p-6">
        <form class="flex flex-col gap-4" @submit.prevent="submit">
          <BaseInput
            v-model="username"
            label="用户名"
            autocomplete="username"
            placeholder="admin"
            :disabled="submitting"
          />
          <BaseInput
            v-model="password"
            type="password"
            label="密码"
            autocomplete="current-password"
            placeholder="请输入密码"
            :disabled="submitting"
          />

          <p v-if="errorMessage" role="alert" class="text-sm text-red-600 dark:text-red-400">
            {{ errorMessage }}<template v-if="blockedRemaining > 0">（剩余 {{ blockedText }}）</template>
          </p>
          <p v-else-if="changeMessage" class="text-sm text-green-700 dark:text-green-400">
            {{ changeMessage }}
          </p>

          <BaseButton type="submit" :loading="submitting" :disabled="!canSubmit" block>
            登录
          </BaseButton>
          <button
            v-if="!showPasswordForm"
            type="button"
            class="text-sm"
            :style="{ color: 'var(--theme-primary)' }"
            @click="showPasswordForm = true; changeMessage = ''"
          >
            修改密码
          </button>
        </form>

        <form v-if="showPasswordForm" class="mt-5 flex flex-col gap-4 border-t border-gray-100 pt-5 dark:border-gray-700" @submit.prevent="changePassword">
          <p class="text-sm font-medium">
            修改登录密码
          </p>
          <p v-if="!changeMessage" class="-mt-2 text-xs" :style="{ color: 'var(--muted-text)' }">
            首次登录默认仍是出厂密码，建议先修改；修改成功后需要用新密码重新登录。
          </p>
          <BaseInput
            v-model="newPassword"
            type="password"
            label="新密码"
            autocomplete="new-password"
            :disabled="changingPassword"
          />
          <BaseInput
            v-model="confirmPassword"
            type="password"
            label="确认新密码"
            autocomplete="new-password"
            :error="passwordMismatch ? '两次输入的密码不一致' : ''"
            :disabled="changingPassword"
          />
          <div class="flex gap-3">
            <BaseButton type="submit" variant="success" :loading="changingPassword" :disabled="!canChangePassword" class="flex-1">
              保存新密码
            </BaseButton>
            <BaseButton variant="ghost" type="button" :disabled="changingPassword" @click="showPasswordForm = false">
              收起
            </BaseButton>
          </div>
        </form>
      </section>
    </div>
  </div>
</template>

<style scoped>
.login-root {
  background: var(--app-bg);
}
</style>
