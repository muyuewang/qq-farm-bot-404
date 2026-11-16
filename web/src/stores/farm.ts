import { defineStore } from 'pinia'
import { ref } from 'vue'
import api from '@/api'
import { useAccountStore } from '@/stores/account'

export interface Land {
  id: number
  plantName?: string
  phaseName?: string
  phase?: number
  imagePhase?: number
  seedImage?: string
  plantImage?: string
  status: string
  matureInSec: number
  phaseStartTime?: number
  phaseEndTime?: number
  needWater?: boolean
  needWeed?: boolean
  needBug?: boolean
  [key: string]: any
}

export const useFarmStore = defineStore('farm', () => {
  const lands = ref<Land[]>([])
  const seeds = ref<any[]>([])
  const summary = ref<any>({})
  const weather = ref<any>(null)
  const loading = ref(false)
  const dogSkillGiftPendingCount = ref(0)
  const dogSkillGiftLoading = ref(false)
  const dogSkillGiftError = ref('')

  function clearFarmData() {
    lands.value = []
    seeds.value = []
    summary.value = {}
    weather.value = null
    dogSkillGiftPendingCount.value = 0
    dogSkillGiftError.value = ''
  }

  function isCurrentAccount(accountId: string) {
    const accountStore = useAccountStore()
    const currentId = String((accountStore.currentAccountId as { value?: string })?.value ?? accountStore.currentAccountId ?? '')
    return currentId === String(accountId)
  }

  async function fetchLands(accountId: string) {
    if (!accountId)
      return
    const requestedId = String(accountId)
    loading.value = true
    try {
      const { data } = await api.get('/api/lands', {
        headers: { 'x-account-id': accountId },
      })
      if (!isCurrentAccount(requestedId))
        return
      if (data && data.ok) {
        lands.value = data.data.lands || []
        summary.value = data.data.summary || {}
        weather.value = data.data.weather || null
      }
    }
    finally {
      loading.value = false
    }
  }

  async function fetchSeeds(accountId: string) {
    if (!accountId)
      return
    const requestedId = String(accountId)
    const { data } = await api.get('/api/seeds', {
      headers: { 'x-account-id': accountId },
    })
    if (!isCurrentAccount(requestedId))
      return
    if (data && data.ok)
      seeds.value = data.data || []
  }

  async function fetchDogSkillGiftStatus(accountId: string) {
    if (!accountId)
      return
    dogSkillGiftLoading.value = true
    dogSkillGiftError.value = ''
    try {
      const { data } = await api.get('/api/dog/skill-gifts', {
        headers: { 'x-account-id': accountId },
      })
      if (isCurrentAccount(accountId) && data?.ok)
        dogSkillGiftPendingCount.value = Math.max(0, Number(data.data?.pendingCount) || 0)
    }
    catch (error: any) {
      if (isCurrentAccount(accountId))
        dogSkillGiftError.value = String(error?.response?.data?.error || error?.message || '礼包状态读取失败')
    }
    finally {
      dogSkillGiftLoading.value = false
    }
  }

  async function claimDogSkillGifts(accountId: string) {
    if (!accountId)
      return null
    dogSkillGiftLoading.value = true
    dogSkillGiftError.value = ''
    try {
      const { data } = await api.post('/api/dog/skill-gifts/claim', {}, {
        headers: { 'x-account-id': accountId },
      })
      if (!data?.ok)
        throw new Error(data?.error || '礼包拾取失败')
      if (isCurrentAccount(accountId))
        dogSkillGiftPendingCount.value = Math.max(0, Number(data.data?.pending) || 0)
      return data.data
    }
    catch (error: any) {
      if (isCurrentAccount(accountId))
        dogSkillGiftError.value = String(error?.response?.data?.error || error?.message || '礼包拾取失败')
      return null
    }
    finally {
      dogSkillGiftLoading.value = false
    }
  }

  async function operate(accountId: string, opType: string) {
    if (!accountId)
      return
    await api.post('/api/farm/operate', { opType }, {
      headers: { 'x-account-id': accountId },
    })
    await fetchLands(accountId)
  }

  async function fertilizeLand(accountId: string, landId: number) {
    if (!accountId)
      return
    // 上游接口要求显式化肥类型；页面确认文案一直是“有机肥料催熟”。
    const { data } = await api.post('/api/farm/fertilize', { landId, fertilizerType: 'organic' }, {
      headers: { 'x-account-id': accountId },
    })
    await fetchLands(accountId)
    return data
  }

  // 上游后端只保留了 services/farm/api.ts 的 removePlant，未再接出 HTTP/IPC 路由，
  // 这里不猜测替代操作，直接把不可用状态抛给调用方展示。
  const landRemovalSupported = false

  async function removePlant(accountId: string, landId: number) {
    void landId
    if (!accountId)
      return
    throw new Error('当前后端版本未提供铲除单个作物的接口')
  }

  async function removeAllPlants(accountId: string) {
    if (!accountId)
      return
    throw new Error('当前后端版本未提供一键铲除作物的接口')
  }

  return {
    lands,
    summary,
    weather,
    seeds,
    loading,
    dogSkillGiftPendingCount,
    dogSkillGiftLoading,
    dogSkillGiftError,
    clearFarmData,
    fetchLands,
    fetchSeeds,
    fetchDogSkillGiftStatus,
    claimDogSkillGifts,
    operate,
    fertilizeLand,
    removePlant,
    removeAllPlants,
    landRemovalSupported,
  }
})
