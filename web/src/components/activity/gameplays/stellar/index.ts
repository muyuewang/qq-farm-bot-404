import type { ActivityGameplayModule } from '../types'

export { default as ConstellationTab } from '../../ConstellationTab.vue'
export { default as SolarTermsTab } from '../../SolarTermsTab.vue'
export { default as StarSandExchangeDialog } from '../../StarSandExchangeDialog.vue'
export { default as StarSandShopTab } from '../../StarSandShopTab.vue'
export { default as TravelPassTab } from '../../TravelPassTab.vue'

export const stellarGameplay = {
  key: 'stellar',
  defaultTab: 'travel',
  tabs: ['travel', 'constellation', 'shop', 'solar'],
} as const satisfies ActivityGameplayModule
