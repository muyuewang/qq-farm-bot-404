import { defineStore } from 'pinia'
import { ref } from 'vue'
import api from '@/api'

export interface PetDog { id: number, name: string, image: string, desc: string, level: number, rarity: number, owned: boolean, activatable: boolean, deployed: boolean }
export interface PetFood { id: number, name: string, image: string, count: number, days: number, duration: number }

const DAY_SECONDS = 86400

export const usePetStore = defineStore('pet', () => {
  const overview = ref({ dogs: [] as PetDog[], foods: [] as PetFood[], deployedId: 0, foodSeconds: 0, protectSeconds: 2592000 })
  const logs = ref<any[]>([])
  const loading = ref(false)
  const mutating = ref(false)

  const headers = (accountId: string) => ({ 'x-account-id': accountId })

  // 上游 pets 快照使用 activeDogId / protectDuration / maxProtectDuration，
  // 页面沿用旧字段名，转换集中在这里。
  function mapOverview(payload: any) {
    return {
      dogs: (Array.isArray(payload?.dogs) ? payload.dogs : []).map((dog: any) => ({
        ...dog,
        deployed: dog.active === true,
      })),
      foods: (Array.isArray(payload?.foods) ? payload.foods : []).map((food: any) => ({
        ...food,
        days: Math.max(0, Math.round((Number(food?.duration) || 0) / DAY_SECONDS)),
      })),
      deployedId: Number(payload?.activeDogId) || 0,
      foodSeconds: Number(payload?.protectDuration) || 0,
      protectSeconds: Number(payload?.maxProtectDuration) || 0,
    }
  }

  async function fetchOverview(accountId: string) {
    if (!accountId)
      return
    loading.value = true
    try {
      const { data } = await api.get('/api/pets', { headers: headers(accountId), timeout: 60000 })
      if (!data?.ok)
        throw new Error(data?.error || '获取宠物信息失败')
      overview.value = mapOverview(data.data)
    }
    finally { loading.value = false }
  }
  async function fetchLogs(accountId: string) {
    const { data } = await api.get('/api/pets/protect-logs', { headers: headers(accountId), timeout: 60000 })
    logs.value = Array.isArray(data?.data?.logs) ? data.data.logs : []
  }
  async function mutate(accountId: string, path: string, body = {}) {
    mutating.value = true
    try {
      const { data } = await api.post(path, body, { headers: headers(accountId), timeout: 60000 })
      if (!data?.ok)
        throw new Error(data?.errorMessage || data?.error || '操作失败')
      await fetchOverview(accountId)
      return data
    }
    finally { mutating.value = false }
  }
  const activate = (accountId: string, dogId: number) => mutate(accountId, '/api/pets/activate', { dogId })
  const deploy = (accountId: string, dogId: number) => mutate(accountId, '/api/pets/deploy', { dogId })
  const withdraw = (accountId: string) => mutate(accountId, '/api/pets/withdraw')
  // 上游 food/use 的入参名是 itemId，旧页面仍按 foodId 传参。
  const feed = (accountId: string, foodId: number, count: number) =>
    mutate(accountId, '/api/pets/food/use', { itemId: foodId, count })
  return {
    overview,
    logs,
    loading,
    mutating,
    fetchOverview,
    fetchLogs,
    activate,
    deploy,
    withdraw,
    feed,
  }
})
