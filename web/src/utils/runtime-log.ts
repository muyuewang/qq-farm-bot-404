export type RuntimeLogLevel = 'info' | 'warn' | 'error'
export type RuntimeLogSource = 'business' | 'account' | 'system'

export interface RuntimeLogEntry {
  id: string
  ts: number
  time: string
  tag: string
  msg: string
  level: RuntimeLogLevel
  source: RuntimeLogSource
  module: string
  event: string
  meta: Record<string, any>
  action?: string
  repeatCount?: number
  lastTs?: number
}

const ERROR_ACTION_RE = /error|failed|failure|blocked|kickout|offline_delete|watchdog_stopped|ws_400/i
const WARN_ACTION_RE = /warn|offline|reconnect/i

function parseLogTimestamp(input: any) {
  const direct = Number(input?.ts ?? input?.timestamp)
  if (Number.isFinite(direct) && direct > 0)
    return direct

  const raw = String(input?.time || '')
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw)
    ? raw.replace(' ', 'T')
    : raw
  const parsed = Date.parse(normalized)
  return Number.isFinite(parsed) ? parsed : 0
}

function inferLevel(input: any): RuntimeLogLevel {
  const explicit = String(input?.level || '').toLowerCase()
  if (explicit === 'error' || explicit === 'warn' || explicit === 'info')
    return explicit
  if (String(input?.tag || '') === '错误' || ERROR_ACTION_RE.test(String(input?.action || '')))
    return 'error'
  if (input?.isWarn || String(input?.tag || '') === '警告' || WARN_ACTION_RE.test(String(input?.action || '')))
    return 'warn'
  return 'info'
}

function inferSource(input: any, isAccountLog: boolean): RuntimeLogSource {
  if (isAccountLog)
    return 'account'
  if (input?.source === 'system' || input?.meta?.module === 'system' || ['系统', '错误'].includes(String(input?.tag || '')))
    return 'system'
  return 'business'
}

export function normalizeRuntimeLog(input: any, isAccountLog = false): RuntimeLogEntry {
  const raw = input && typeof input === 'object' ? input : {}
  const ts = parseLogTimestamp(raw)
  const level = inferLevel(raw)
  const source = inferSource(raw, isAccountLog)
  const meta = raw.meta && typeof raw.meta === 'object' ? raw.meta : {}
  const action = String(raw.action || '')
  const tag = isAccountLog
    ? (level === 'error' ? '错误' : level === 'warn' ? '警告' : '系统')
    : String(raw.tag || (level === 'error' ? '错误' : '系统'))
  const msg = String(raw.reason && !String(raw.msg || '').includes(String(raw.reason))
    ? `${raw.msg || ''}（${raw.reason}）`
    : raw.msg || '')
  const fingerprint = [source, raw.accountId || raw.id || '', ts, action, tag, msg].join('|')

  return {
    ...raw,
    id: String(raw.logId || fingerprint),
    ts,
    time: String(raw.time || ''),
    tag,
    msg,
    level,
    source,
    module: String(meta.module || (source === 'account' ? 'system' : '')),
    event: String(meta.event || action),
    meta,
    ...(action ? { action } : {}),
  }
}

export function matchesRuntimeLog(log: RuntimeLogEntry, filter: {
  module?: string
  event?: string
  keyword?: string
  level?: string
}) {
  if (filter.module) {
    const isSystem = log.source === 'system' || log.source === 'account'
    if (filter.module === 'system' ? !isSystem : log.module !== filter.module)
      return false
  }
  if (filter.event && log.event !== filter.event)
    return false
  if (filter.level && log.level !== filter.level)
    return false

  const keywords = String(filter.keyword || '').trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (!keywords.length)
    return true
  const searchText = [log.tag, log.msg, log.module, log.event, log.action].filter(Boolean).join(' ').toLowerCase()
  return keywords.every(keyword => searchText.includes(keyword))
}

export function isQuietRuntimeLog(log: RuntimeLogEntry) {
  if (log.level !== 'info')
    return false
  if (log.meta?.result === 'none')
    return true
  return /暂无|无需|跳过|等待|未发现|没有可|本轮无|检查完成/.test(log.msg)
}

function repeatSignature(log: RuntimeLogEntry) {
  return [log.source, log.level, log.module, log.event, log.tag, log.msg].join('|')
}

export function compactRuntimeLogs(logs: RuntimeLogEntry[], windowMs = 2 * 60 * 1000) {
  const result: RuntimeLogEntry[] = []
  for (const log of logs) {
    const previous = result[result.length - 1]
    const previousLastTs = previous?.lastTs || previous?.ts || 0
    if (previous && repeatSignature(previous) === repeatSignature(log) && log.ts - previousLastTs <= windowMs) {
      previous.repeatCount = (previous.repeatCount || 1) + 1
      previous.lastTs = log.ts
      continue
    }
    result.push({ ...log, repeatCount: 1, lastTs: log.ts })
  }
  return result
}
