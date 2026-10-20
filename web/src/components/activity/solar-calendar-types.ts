export interface SolarReward { id: number, count: number, name: string, image: string }

export interface SolarCalendarEvent {
  id: number
  name: string
  description: string
  startTime: number
  endTime: number
  status: number
  directClaimed: boolean
  quizClaimed: boolean
  quizWrongToday: boolean
  wrongOptions: number[]
  question: string
  options: string[]
  errorTips: string
  rules: string[]
  answerIndex: number | null
  rewards: SolarReward[]
  questionRewards: SolarReward[]
  canClaim: boolean
  canAnswer: boolean
}

export interface SolarCalendarSeason {
  id: number
  name: string
  year: string
  description: string
  eventIds: number[]
  litCount: number
  totalCount: number
  claimed: boolean
  canClaim: boolean
  rewards: SolarReward[]
}

export interface SolarCalendar {
  serverTime: number
  defaultEventId: number
  events: SolarCalendarEvent[]
  seasons: SolarCalendarSeason[]
}

export function formatSolarTime(value?: number) {
  const raw = Number(value || 0)
  if (!raw)
    return '-'
  const date = new Date(raw > 1000000000000 ? raw : raw * 1000)
  if (Number.isNaN(date.getTime()))
    return '-'
  return date.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })
}

export function solarRewardSummary(items?: SolarReward[]) {
  return items?.length ? items.map(item => `${item.name}x${item.count}`).join(' / ') : '无'
}

export function solarStatusLabel(event: SolarCalendarEvent) {
  if (event.status === 2)
    return '开放中'
  if (event.status === 1)
    return '未开始'
  return '已结束'
}
