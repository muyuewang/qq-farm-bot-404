import type { CareerHarvestSteal } from '@/components/CareerHarvestSteal.vue'
import type {
  FriendInteractionBatchDto,
  FriendInteractionEffectDto,
  FriendInteractionItemDto,
} from '@/stores/friend'
import { defineStore } from 'pinia'
import { ref } from 'vue'
import api, { getApiErrorMessage, normalizeApiErrorMessage } from '@/api'

export type FertilizerType = 'normal' | 'organic'

export interface Land {
  id: number
  plantName?: string
  phaseName?: string
  seedImage?: string
  status: string
  matureInSec: number
  needWater?: boolean
  needWeed?: boolean
  needBug?: boolean
  leftInorcFertTimes?: number | null
  [key: string]: any
}

export interface FertilizeLandResult {
  landId: number
  fertilizerType: FertilizerType
  fertilizerRemainingSec: number
  updatedLand?: Land | null
}

export interface FertilizeAllResult {
  fertilizerType: FertilizerType
  requestedCount: number
  successCount: number
  skippedCount: number
  fertilizerConsumedSec: number | null
  fertilizerRemainingSec: number | null
  updatedLands: Land[]
}

function userFacingFertilizeError(raw: unknown, fallback = '施肥失败') {
  return getApiErrorMessage(raw, fallback)
}

// UseReply.land 是刚成功操作后的权威快照，短期内不允许被随后的 AllLands 旧快照覆盖。
const FARM_LAND_OVERLAY_TTL_MS = 60 * 1000

export const useFarmStore = defineStore('farm', () => {
  const lands = ref<Land[]>([])
  const seeds = ref<any[]>([])
  const summary = ref<any>({})
  const socialEvents = ref<any[]>([])
  const career = ref<CareerHarvestSteal | null>(null)
  const loading = ref(false)
  const loaded = ref(false)
  const error = ref('')
  const interactionItems = ref<FriendInteractionItemDto[]>([])
  const interactionItemsLoading = ref(false)
  const interactionItemsError = ref('')
  const interactionUsePending = ref(false)
  const interactionUseError = ref('')
  const interactionItemsAccountId = ref('')
  const interactionUsedLandIds = ref<Record<string, string[]>>({})
  const fertilizePending = ref(false)
  const fertilizeError = ref('')
  let landRequestSequence = 0
  let fertilizeRequestSequence = 0
  let interactionItemsRequestSequence = 0
  let landOverlay: { lands: any[], effects: FriendInteractionEffectDto[], updatedAt: number } | null = null

  function normalizeLandId(value: unknown) {
    const text = String(value ?? '').trim()
    return /^\d+$/.test(text) && text !== '0' ? text : ''
  }

  function mergeLandUpdateList(landsInput: any[], updatesInput: any[]) {
    const current = Array.isArray(landsInput) ? landsInput : []
    const updates = Array.isArray(updatesInput) ? updatesInput.filter(Boolean) : []
    if (updates.length === 0)
      return current

    const byId = new Map(current.map(land => [normalizeLandId(land?.id), land]))
    for (const update of updates) {
      const updateId = normalizeLandId(update?.id)
      if (!updateId)
        continue
      const existing = byId.get(updateId)
      if (!existing)
        continue
      byId.set(updateId, { ...existing, ...update, id: existing.id })
    }
    return current.map(land => byId.get(normalizeLandId(land?.id)) || land)
  }

  function applyLandOverlay(landsInput: any[]) {
    if (landOverlay && Date.now() - landOverlay.updatedAt > FARM_LAND_OVERLAY_TTL_MS)
      landOverlay = null
    if (!landOverlay)
      return Array.isArray(landsInput) ? landsInput : []

    let merged = mergeLandUpdateList(landsInput, landOverlay.lands)
    const effects = landOverlay.effects
    if (effects.length === 0)
      return merged

    merged = merged.map((land: any) => {
      const landId = normalizeLandId(land?.id)
      const occupiedIds = new Set([
        landId,
        ...(Array.isArray(land?.occupiedLandIds) ? land.occupiedLandIds.map(normalizeLandId) : []),
        normalizeLandId(land?.masterLandId),
      ].filter(Boolean))
      const visibleEffects = effects.filter(effect => occupiedIds.has(normalizeLandId(effect?.landId)))
      if (visibleEffects.length === 0)
        return land
      const existing = Array.isArray(land?.interactionEffects) ? land.interactionEffects : []
      const seen = new Set(existing.map((effect: any) => `${effect?.itemId}:${effect?.landId}:${effect?.usedAt || ''}`))
      const mergedEffects = [...existing]
      for (const effect of visibleEffects) {
        const key = `${effect.itemId}:${effect.landId}:${effect.usedAt || ''}`
        if (!seen.has(key)) {
          seen.add(key)
          mergedEffects.push(effect)
        }
      }
      return { ...land, interactionEffects: mergedEffects }
    })
    return merged
  }

  function recordLandUpdates(updatedLandsInput: any[], effectsInput: FriendInteractionEffectDto[] = []) {
    const updatedLands = Array.isArray(updatedLandsInput) ? updatedLandsInput.filter(Boolean) : []
    const effects = Array.isArray(effectsInput) ? effectsInput.filter(effect => !!effect?.confirmed) : []
    if (updatedLands.length === 0 && effects.length === 0)
      return
    landOverlay = {
      lands: mergeLandUpdateList(landOverlay?.lands || [], updatedLands),
      effects: [...(landOverlay?.effects || []), ...effects],
      updatedAt: Date.now(),
    }
    lands.value = applyLandOverlay(mergeLandUpdateList(lands.value, updatedLands))
  }

  async function fetchLands(accountId: string) {
    if (!accountId)
      return false
    const sequence = ++landRequestSequence
    loading.value = true
    loaded.value = false
    error.value = ''
    try {
      const { data } = await api.get('/api/lands', {
        headers: { 'x-account-id': accountId },
        skipErrorToast: true,
      } as any)
      if (sequence !== landRequestSequence)
        return false
      if (data && data.ok) {
        lands.value = applyLandOverlay(data.data.lands || [])
        summary.value = data.data.summary || {}
        socialEvents.value = Array.isArray(data.data.socialEvents) ? data.data.socialEvents : []
        career.value = data.data.career || null
        return true
      }
      career.value = null
      socialEvents.value = []
      error.value = getApiErrorMessage(data, '无法读取土地数据')
      return false
    }
    catch (cause: any) {
      if (sequence !== landRequestSequence)
        return false
      career.value = null
      socialEvents.value = []
      error.value = getApiErrorMessage(cause, '无法读取土地数据，请稍后重试')
      return false
    }
    finally {
      if (sequence === landRequestSequence) {
        loaded.value = true
        loading.value = false
      }
    }
  }

  function resetLandState() {
    landRequestSequence++
    fertilizeRequestSequence++
    lands.value = []
    summary.value = {}
    socialEvents.value = []
    career.value = null
    loading.value = false
    loaded.value = false
    error.value = ''
    landOverlay = null
    fertilizePending.value = false
    fertilizeError.value = ''
    resetInteractionState()
  }

  function interactionUsageKey(accountId: string, itemId: unknown) {
    return `${String(accountId || '')}:${String(itemId || '')}`
  }

  function getInteractionUsedLandIds(accountId: string, itemId: unknown) {
    return interactionUsedLandIds.value[interactionUsageKey(accountId, itemId)] || []
  }

  function resetInteractionState() {
    interactionItemsRequestSequence++
    interactionItems.value = []
    interactionItemsLoading.value = false
    interactionItemsError.value = ''
    interactionUseError.value = ''
    interactionItemsAccountId.value = ''
    interactionUsedLandIds.value = {}
  }

  /** 读取背包中可对自己农场使用的特殊互动道具（服务端已按白名单过滤）。 */
  async function fetchInteractionItems(accountId: string) {
    const requestedAccountId = String(accountId || '').trim()
    if (!requestedAccountId)
      return false
    const sequence = ++interactionItemsRequestSequence
    if (interactionItemsAccountId.value !== requestedAccountId) {
      interactionItems.value = []
      interactionItemsAccountId.value = requestedAccountId
    }
    interactionItemsLoading.value = true
    interactionItemsError.value = ''
    try {
      const res = await api.get('/api/farm/interaction-items', {
        headers: { 'x-account-id': requestedAccountId },
        skipErrorToast: true,
      } as any)
      if (sequence !== interactionItemsRequestSequence)
        return false
      if (!res.data?.ok) {
        interactionItems.value = []
        interactionItemsError.value = getApiErrorMessage(res.data, '无法读取可用的互动道具')
        return false
      }
      interactionItems.value = Array.isArray(res.data?.data?.items) ? res.data.data.items : []
      return true
    }
    catch (cause: any) {
      if (sequence !== interactionItemsRequestSequence)
        return false
      interactionItems.value = []
      interactionItemsError.value = getApiErrorMessage(cause, '无法读取可用的互动道具')
      return false
    }
    finally {
      if (sequence === interactionItemsRequestSequence)
        interactionItemsLoading.value = false
    }
  }

  async function useInteractionItemBatch(accountId: string, itemId: string, landIds: string[]) {
    if (!accountId || !itemId || !Array.isArray(landIds) || landIds.length === 0)
      return false
    if (interactionUsePending.value)
      return false
    interactionUsePending.value = true
    interactionUseError.value = ''
    try {
      const res = await api.post('/api/farm/interaction-items/use-batch', {
        itemId,
        landIds,
      }, {
        headers: { 'x-account-id': accountId },
        skipErrorToast: true,
      } as any)
      if (!res.data?.ok) {
        interactionUseError.value = getApiErrorMessage(res.data, '互动道具使用失败')
        return false
      }
      const result = res.data.data as FriendInteractionBatchDto
      if (result && typeof result.message === 'string')
        result.message = normalizeApiErrorMessage(result.message)
      for (const item of result?.results || []) {
        if (item && typeof item.message === 'string')
          item.message = normalizeApiErrorMessage(item.message)
      }
      if (Array.isArray(result?.items))
        interactionItems.value = result.items
      const key = interactionUsageKey(accountId, result.itemId)
      const used = new Set(interactionUsedLandIds.value[key] || [])
      for (const landId of result.usedLandIds || [])
        used.add(String(landId))
      interactionUsedLandIds.value = {
        ...interactionUsedLandIds.value,
        [key]: [...used].sort((left, right) => Number(left) - Number(right)),
      }
      recordLandUpdates(result?.updatedLands || [], result?.interactionEffects || [])
      return result
    }
    catch (cause: any) {
      interactionUseError.value = getApiErrorMessage(cause, '互动道具使用失败')
      return false
    }
    finally {
      interactionUsePending.value = false
    }
  }

  async function fetchSeeds(accountId: string) {
    if (!accountId)
      return
    const { data } = await api.get('/api/seeds', {
      headers: { 'x-account-id': accountId },
    })
    if (data && data.ok)
      seeds.value = data.data || []
  }

  async function fertilizeLand(accountId: string, landId: number, fertilizerType: FertilizerType) {
    if (!accountId || !landId || fertilizePending.value)
      return false
    fertilizePending.value = true
    const sequence = ++fertilizeRequestSequence
    fertilizeError.value = ''
    try {
      const res = await api.post('/api/farm/fertilize', {
        landId,
        fertilizerType,
      }, {
        headers: { 'x-account-id': accountId },
        skipErrorToast: true,
      } as any)
      if (sequence !== fertilizeRequestSequence)
        return false
      if (!res.data?.ok) {
        fertilizeError.value = userFacingFertilizeError(res.data)
        return false
      }
      const result = res.data.data as FertilizeLandResult
      if (result?.updatedLand)
        recordLandUpdates([result.updatedLand])
      else
        await fetchLands(accountId)
      return result
    }
    catch (cause: any) {
      if (sequence !== fertilizeRequestSequence)
        return false
      fertilizeError.value = userFacingFertilizeError(cause)
      return false
    }
    finally {
      if (sequence === fertilizeRequestSequence)
        fertilizePending.value = false
    }
  }

  async function fertilizeAll(accountId: string, fertilizerType: FertilizerType, landIds?: number[]) {
    if (!accountId || fertilizePending.value)
      return false
    const sequence = ++fertilizeRequestSequence
    fertilizePending.value = true
    fertilizeError.value = ''
    try {
      const res = await api.post('/api/farm/fertilize-all', landIds ? { fertilizerType, landIds } : { fertilizerType }, {
        headers: { 'x-account-id': accountId },
        skipErrorToast: true,
      } as any)
      if (sequence !== fertilizeRequestSequence)
        return false
      if (!res.data?.ok) {
        fertilizeError.value = userFacingFertilizeError(res.data)
        return false
      }
      const result = res.data.data as FertilizeAllResult
      recordLandUpdates(result.updatedLands || [])
      return result
    }
    catch (cause: any) {
      if (sequence !== fertilizeRequestSequence)
        return false
      fertilizeError.value = userFacingFertilizeError(cause)
      return false
    }
    finally {
      if (sequence === fertilizeRequestSequence)
        fertilizePending.value = false
    }
  }

  async function operate(accountId: string, opType: string, landId: number | null = null) {
    if (!accountId)
      return false
    const res = await api.post('/api/farm/operate', { opType, landId }, {
      headers: { 'x-account-id': accountId },
    })
    if (!res.data?.ok) {
      throw new Error(getApiErrorMessage(res.data, '农场操作失败'))
    }
    landOverlay = null
    await fetchLands(accountId)
    const result = res.data?.data || { hadWork: false, actions: [] }
    if (result && typeof result.message === 'string')
      result.message = normalizeApiErrorMessage(result.message)
    return result
  }

  return {
    lands,
    summary,
    socialEvents,
    career,
    seeds,
    loading,
    loaded,
    error,
    interactionItems,
    interactionItemsLoading,
    interactionItemsError,
    interactionUsePending,
    interactionUseError,
    fertilizePending,
    fertilizeError,
    fetchLands,
    resetLandState,
    fetchSeeds,
    operate,
    fetchInteractionItems,
    useInteractionItemBatch,
    getInteractionUsedLandIds,
    resetInteractionState,
    fertilizeLand,
    fertilizeAll,
  }
})
