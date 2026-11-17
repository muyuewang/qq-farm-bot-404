import { useStorage } from '@vueuse/core'
import { defineStore } from 'pinia'
import { computed } from 'vue'
import api from '@/api'

interface AdminUser {
  username: 'admin'
  role: 'admin'
  card: null
  accountLimit: number
  avatar?: string
}

export const useUserStore = defineStore('user', () => {
  const token = useStorage('admin_token', '')
  const userInfo = useStorage<AdminUser | null>('user_info', null)
  const isLoggedIn = computed(() => !!token.value)
  const isAdmin = computed(() => true)
  const isSuperAdmin = computed(() => false)
  const username = computed(() => 'admin')
  const avatar = computed(() => userInfo.value?.avatar || '')
  const accountLimit = computed(() => Number.MAX_SAFE_INTEGER)
  const isExpired = computed(() => false)

  async function fetchUserInfo() {
    try {
      const { data } = await api.get('/api/user/me')
      if (data?.ok) {
        userInfo.value = {
          username: 'admin',
          role: 'admin',
          card: null,
          accountLimit: Number.MAX_SAFE_INTEGER,
          avatar: data.data.avatar,
        }
      }
      return data
    }
    catch {
      return { ok: false }
    }
  }

  /** 退出登录：通知后端使当前 token 失效，再清空本地凭证并回到登录页。 */
  async function logout() {
    try {
      await api.post('/api/logout')
    }
    catch {
      // 网络异常也要清掉本地凭证，否则用户会被卡在已失效会话里。
    }
    finally {
      token.value = ''
      userInfo.value = null
    }
  }

  return {
    token,
    userInfo,
    isLoggedIn,
    isAdmin,
    isSuperAdmin,
    username,
    avatar,
    accountLimit,
    isExpired,
    fetchUserInfo,
    logout,
  }
})
