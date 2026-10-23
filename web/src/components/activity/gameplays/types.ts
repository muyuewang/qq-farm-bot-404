import type { ActivityDirectoryItemDto, ActivityGameplayKey, ActivityTabKey } from '@/stores/activity-center'

export interface ActivityGameplayModule {
  key: ActivityGameplayKey
  defaultTab: ActivityTabKey
  tabs: readonly ActivityTabKey[]
}

export interface ResolvedActivityGameplay {
  module: ActivityGameplayModule
  entryTab: ActivityTabKey
  activity: ActivityDirectoryItemDto
}
