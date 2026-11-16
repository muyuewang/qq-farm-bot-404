import { defineStore } from 'pinia'
import { ref } from 'vue'
import api from '@/api'
import { useAccountStore } from './account'

export interface PlantBlacklistItem {
  seedId: number
  name: string
}

export const usePlantBlacklistStore = defineStore('plant-blacklist', () => {
  const blacklist = ref<number[]>([])
  const loading = ref(false)
  let fetchRequestId = 0

  function clearBlacklistData() {
    blacklist.value = []
    loading.value = false
  }

  function isCurrentAccount(accountId: string) {
    const accountStore = useAccountStore()
    const currentId = String((accountStore.currentAccountId as { value?: string })?.value ?? accountStore.currentAccountId ?? '')
    return currentId === String(accountId)
  }

  async function fetchBlacklist() {
    const accountStore = useAccountStore()
    const accountId = accountStore.currentAccountId
    if (!accountId)
      return
    const requestedId = String(accountId)
    const requestId = ++fetchRequestId
    loading.value = true
    try {
      const res = await api.get('/api/plant-blacklist', {
        headers: { 'x-account-id': accountId },
      })
      if (requestId !== fetchRequestId || !isCurrentAccount(requestedId))
        return
      if (res.data.ok) {
        blacklist.value = res.data.data || []
      }
    }
    catch { /* ignore */ }
    finally {
      if (requestId === fetchRequestId)
        loading.value = false
    }
  }

  async function addToBlacklist(seedId: number) {
    const accountStore = useAccountStore()
    const accountId = accountStore.currentAccountId
    if (!accountId)
      return
    const requestedId = String(accountId)
    const res = await api.post('/api/plant-blacklist', { seedId }, {
      headers: { 'x-account-id': accountId },
    })
    if (isCurrentAccount(requestedId) && res.data.ok) {
      blacklist.value = res.data.data || []
    }
  }

  async function removeFromBlacklist(seedId: number) {
    const accountStore = useAccountStore()
    const accountId = accountStore.currentAccountId
    if (!accountId)
      return
    const requestedId = String(accountId)
    const res = await api.delete(`/api/plant-blacklist/${seedId}`, {
      headers: { 'x-account-id': accountId },
    })
    if (isCurrentAccount(requestedId) && res.data.ok) {
      blacklist.value = res.data.data || []
    }
  }

  async function toggleBlacklist(seedId: number) {
    if (blacklist.value.includes(seedId)) {
      await removeFromBlacklist(seedId)
    }
    else {
      await addToBlacklist(seedId)
    }
  }

  function isBlacklisted(seedId: number) {
    return blacklist.value.includes(seedId)
  }

  async function addAllToBlacklist(seedIds: number[]) {
    const accountStore = useAccountStore()
    const accountId = accountStore.currentAccountId
    if (!accountId)
      return
    const requestedId = String(accountId)
    const res = await api.post('/api/plant-blacklist/batch', { seedIds }, {
      headers: { 'x-account-id': accountId },
    })
    if (isCurrentAccount(requestedId) && res.data.ok) {
      blacklist.value = res.data.data || []
    }
  }

  async function clearBlacklist() {
    const accountStore = useAccountStore()
    const accountId = accountStore.currentAccountId
    if (!accountId)
      return
    const requestedId = String(accountId)
    const res = await api.delete('/api/plant-blacklist', {
      headers: { 'x-account-id': accountId },
    })
    if (isCurrentAccount(requestedId) && res.data.ok) {
      blacklist.value = []
    }
  }

  return {
    blacklist,
    loading,
    clearBlacklistData,
    fetchBlacklist,
    addToBlacklist,
    removeFromBlacklist,
    toggleBlacklist,
    isBlacklisted,
    addAllToBlacklist,
    clearBlacklist,
  }
})
