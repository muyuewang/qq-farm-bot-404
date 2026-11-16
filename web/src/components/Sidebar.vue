<script setup lang="ts">
import { useDateFormat, useIntervalFn, useNow } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import api from '@/api'

import { menuRoutes } from '@/router/menu'
import { useAccountStore } from '@/stores/account'
import { useAppStore } from '@/stores/app'
import { useShopStore } from '@/stores/shop'
import { useStatusStore } from '@/stores/status'
import { useUserStore } from '@/stores/user'

const accountStore = useAccountStore()
const statusStore = useStatusStore()
const appStore = useAppStore()
const userStore = useUserStore()
const shopStore = useShopStore()
const route = useRoute()
const router = useRouter()
const { currentAccount, currentAccountId } = storeToRefs(accountStore)
const { status, realtimeConnected } = storeToRefs(statusStore)
const { mysteryOffer, mysteryOfferAccountId } = storeToRefs(shopStore)
const { loginPageConfig, sidebarOpen } = storeToRefs(appStore)

const wsErrorNotifiedAt = ref<Record<string, number>>({})

const systemConnected = ref(true)
const serverUptimeBase = ref(0)
const lastPingTime = ref(Date.now())
const now = useNow()
const formattedTime = useDateFormat(now, 'YYYY-MM-DD HH:mm:ss')

async function checkConnection() {
  try {
    const res = await api.get('/api/ping')
    systemConnected.value = true
    if (res.data.ok && res.data.data) {
      if (res.data.data.uptime) {
        serverUptimeBase.value = res.data.data.uptime
        lastPingTime.value = Date.now()
      }
    }
    const accountRef = currentAccount.value?.id || currentAccount.value?.uin
    if (accountRef) {
      statusStore.connectRealtime(String(accountRef))
    }
  }
  catch {
    systemConnected.value = false
  }
}

async function refreshStatusFallback() {
  if (realtimeConnected.value)
    return

  const accountRef = currentAccount.value?.id || currentAccount.value?.uin
  if (accountRef) {
    await statusStore.fetchStatus(String(accountRef))
  }
}

onMounted(() => {
  appStore.fetchLoginPageConfig()
  accountStore.fetchAccounts()
  checkConnection()
  // 获取当前用户信息
  userStore.fetchUserInfo()
})

onBeforeUnmount(() => {
  statusStore.disconnectRealtime()
})

useIntervalFn(checkConnection, 30000)
useIntervalFn(() => {
  refreshStatusFallback()
  accountStore.fetchAccounts()
}, 10000)

watch(() => currentAccount.value?.id || currentAccount.value?.uin || '', () => {
  const accountRef = currentAccount.value?.id || currentAccount.value?.uin
  statusStore.connectRealtime(String(accountRef || ''))
  refreshStatusFallback()
}, { immediate: true })

watch(() => status.value?.wsError, (wsError: any) => {
  if (!wsError || Number(wsError.code) !== 400 || !currentAccount.value)
    return

  const errAt = Number(wsError.at) || 0
  const accId = String(currentAccount.value.id || currentAccount.value.uin || '')
  const lastNotified = wsErrorNotifiedAt.value[accId] || 0
  if (errAt <= lastNotified)
    return

  wsErrorNotifiedAt.value[accId] = errAt
  router.push('/settings')
}, { deep: true })

const uptime = computed(() => {
  const diff = Math.floor(serverUptimeBase.value + (now.value.getTime() - lastPingTime.value) / 1000)
  const h = Math.floor(diff / 3600)
  const m = Math.floor((diff % 3600) / 60)
  const s = diff % 60
  return `${h}h ${m}m ${s}s`
})

const connectionStatus = computed(() => {
  if (!systemConnected.value) {
    return {
      text: '系统离线',
      color: 'bg-red-500',
      pulse: false,
    }
  }

  if (!currentAccount.value?.id) {
    return {
      text: '请添加账号',
      color: 'bg-gray-400',
      pulse: false,
    }
  }

  const isConnected = status.value?.connection?.connected
  if (isConnected) {
    return {
      text: '运行中',
      color: 'bg-green-500',
      pulse: true,
    }
  }

  return {
    text: '未连接',
    color: 'bg-gray-400', // Or red? Old version uses gray/offline class which is gray usually
    pulse: false,
  }
})

// 根据用户角色过滤导航菜单
const navItems = computed(() => {
  const isAdmin = userStore.isAdmin
  return menuRoutes
    .filter(item => item.showInNav !== false && (!item.adminOnly || isAdmin))
    .map(item => ({
      path: item.path ? `/${item.path}` : '/',
      label: item.label,
      icon: item.icon,
    }))
})

const hasActiveMysteryOffer = computed(() => {
  const offer = mysteryOffer.value
  if (!currentAccountId.value || mysteryOfferAccountId.value !== String(currentAccountId.value))
    return false
  if (!offer?.active || offer.purchased)
    return false
  const endTime = Number(offer.endTime || 0)
  const endMs = endTime > 10_000_000_000 ? endTime : endTime * 1000
  return !endMs || endMs > Date.now()
})

const version = __APP_VERSION__

watch(
  () => route.path,
  () => {
    // Close sidebar on route change (mobile only)
    if (window.innerWidth < 1024)
      appStore.closeSidebar()
  },
)

const showThemeDropdown = ref(false)
</script>

<template>
  <aside
    class="fixed inset-y-0 left-0 z-50 h-full w-72 flex flex-col border-r border-gray-200/60 p-3 transition-transform duration-300 lg:static lg:translate-x-0 dark:border-gray-700/60"
    :class="sidebarOpen ? 'translate-x-0' : '-translate-x-full'"
    :style="{ background: 'color-mix(in srgb, var(--surface-1) 90%, transparent)', color: 'var(--theme-text)' }"
  >
    <!-- Brand -->
    <div class="relative h-16 flex flex-none items-center justify-between px-2">
      <div class="min-w-0 flex items-center gap-3">
        <div class="h-11 w-11 flex flex-none items-center justify-center overflow-hidden rounded-full shadow-sm ring-1 ring-gray-200 dark:ring-gray-700">
          <img
            src="/icon.png"
            :alt="`${loginPageConfig.title || 'QQ农场智能助手'}图标`"
            class="h-full w-full scale-150 object-cover"
          >
        </div>
        <div class="min-w-0">
          <div class="truncate text-[15px] font-bold tracking-tight" style="color: var(--theme-text);">
            {{ loginPageConfig.title || 'QQ农场智能助手' }}
          </div>
          <div class="truncate text-xs font-mono opacity-70" style="color: var(--theme-text);">
            QQ FARM ASSISTANT
          </div>
        </div>
      </div>
      <!-- Mobile Close Button -->
      <button
        aria-label="关闭导航"
        class="h-11 w-11 flex flex-none items-center justify-center rounded-lg text-gray-500 transition lg:hidden hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
        @click="appStore.closeSidebar"
      >
        <div class="i-carbon-close text-xl" />
      </button>
    </div>

    <!-- 渐变分隔线 -->
    <div class="mx-2 mb-3 h-px flex-none" style="background: linear-gradient(90deg, color-mix(in srgb, var(--theme-primary) 45%, transparent), transparent);" />

    <!-- Navigation -->
    <nav class="custom-scrollbar flex-1 overflow-y-auto px-1 py-1 space-y-1">
      <router-link
        v-for="item in navItems"
        :key="item.path"
        :to="item.path"
        :active-class="item.path === '/' ? '' : 'router-link-active'"
        :exact-active-class="item.path === '/' ? 'router-link-active' : 'router-link-exact-active'"
        class="nav-item group relative flex items-center gap-3 rounded-xl px-2 py-1.5 transition-colors duration-200"
      >
        <span class="nav-icon h-9 w-9 flex flex-none items-center justify-center rounded-lg text-[22px] transition-colors duration-200">
          <div :class="[item.icon]" />
        </span>
        <span class="min-w-0 flex-1 truncate text-sm font-medium">{{ item.label }}</span>
        <span
          v-if="item.path === '/shop' && hasActiveMysteryOffer"
          class="h-2 w-2 shrink-0 rounded-full bg-red-500 shadow-[0_0_0_3px_rgba(239,68,68,0.15)]"
          title="神秘商人已出现"
        />
      </router-link>
    </nav>

    <!-- Footer Status -->
    <div class="relative mt-4 flex-none rounded-xl px-3 py-2.5" style="background: color-mix(in srgb, var(--surface-2) 80%, transparent);">
      <div class="flex items-center justify-between text-xs">
        <div class="flex items-center gap-1.5 font-medium" style="color: var(--theme-text);">
          <span class="h-2 w-2 rounded-full" :class="[connectionStatus.color, { 'animate-pulse': connectionStatus.pulse }]" />
          <span>{{ connectionStatus.text }}</span>
        </div>
        <span class="font-mono opacity-60" style="color: var(--theme-text);">{{ uptime }}</span>
      </div>

      <div class="mt-2 flex items-center justify-between border-t pt-2 text-xs opacity-80" style="border-color: color-mix(in srgb, var(--theme-text) 10%, transparent); color: var(--theme-text);">
        <span class="font-mono">{{ formattedTime }}</span>
        <!-- 主题调色盘按钮 -->
        <button
          class="h-7 w-7 flex items-center justify-center rounded-lg transition-colors hover:bg-gray-200/60 dark:hover:bg-gray-700/60"
          title="主题设置"
          @click="showThemeDropdown = !showThemeDropdown"
        >
          <div class="i-carbon-color-palette text-sm" :style="{ color: 'var(--theme-primary)' }" />
        </button>
      </div>

      <div class="mt-1 flex items-center justify-between text-xs font-mono opacity-70" style="color: var(--theme-text);">
        <span>v{{ version }}</span>
        <a
          href="https://github.com/xxxscarlxrd404/qq-farm-bot"
          target="_blank"
          rel="noopener noreferrer"
          class="transition-opacity hover:opacity-70"
          title="打开 GitHub 项目主页"
        >xxxscarlxrd404</a>
      </div>

      <!-- 主题选择弹出面板 -->
      <div
        v-show="showThemeDropdown"
        class="glass-panel absolute bottom-full left-0 right-0 z-50 grid grid-cols-4 mb-2 gap-1.5 rounded-lg p-2"
      >
        <button
          v-for="(t, theme) in appStore.themes"
          :key="theme"
          class="group relative flex flex-col items-center justify-center gap-1 rounded-lg p-2 transition-colors"
          :class="{
            'ring-2 ring-offset-1': appStore.currentTheme === theme,
          }"
          :style="{
            'background': t.gradient,
            '--tw-ring-color': t.primary,
            '--tw-ring-offset-color': 'var(--theme-bg)',
          }"
          :title="t.name"
          @click="appStore.applyTheme(theme as any); showThemeDropdown = false"
        >
          <div :class="t.icon" class="text-base text-white" />
          <span class="text-xs text-white font-medium leading-tight">{{ t.name }}</span>
          <div
            v-if="appStore.currentTheme === theme"
            class="absolute right-1 top-1 h-3 w-3 flex items-center justify-center rounded-full bg-white shadow"
          >
            <div class="i-carbon-checkmark text-xs" :style="{ color: t.primary }" />
          </div>
        </button>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.custom-scrollbar::-webkit-scrollbar {
  width: 4px;
}
.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}
.custom-scrollbar::-webkit-scrollbar-thumb {
  background-color: rgba(156, 163, 175, 0.3);
  border-radius: 2px;
}
.custom-scrollbar:hover::-webkit-scrollbar-thumb {
  background-color: rgba(156, 163, 175, 0.5);
}

/* ===== 导航菜单项 ===== */

/* 默认态 */
.nav-item {
  opacity: 0.82;
}
.nav-item:hover {
  background: var(--surface-2);
  opacity: 1;
}

/* 图标容器 */
.nav-item .nav-icon {
  color: color-mix(in srgb, var(--theme-text) 58%, transparent);
}
.nav-item:hover .nav-icon {
  background: color-mix(in srgb, var(--theme-text) 7%, transparent);
  color: var(--theme-text);
}

/* 选中态：渐变图标胶囊 + 左侧指示条 */
.router-link-active.nav-item,
.router-link-exact-active.nav-item {
  background: color-mix(in srgb, var(--theme-primary) 9%, transparent) !important;
  color: var(--theme-primary) !important;
  opacity: 1;
}

.router-link-active .nav-icon,
.router-link-exact-active .nav-icon {
  background: var(--theme-gradient) !important;
  color: #fff !important;
  box-shadow: 0 4px 12px color-mix(in srgb, var(--theme-primary) 28%, transparent);
}

.router-link-active::before,
.router-link-exact-active::before {
  content: '';
  position: absolute;
  top: 50%;
  left: -4px;
  width: 3px;
  height: 56%;
  transform: translateY(-50%);
  border-radius: 0 4px 4px 0;
  background: var(--theme-gradient);
}
</style>
