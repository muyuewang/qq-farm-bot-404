export interface ManualLoginInput {
  code: string
  gatewayUrl: string
  clientVersion: string
  platform: 'qq' | 'wx' | ''
}

export function parseManualLoginInput(input: string): ManualLoginInput {
  const value = String(input || '').trim()
  const fallback: ManualLoginInput = { code: value, gatewayUrl: '', clientVersion: '', platform: '' }
  if (!/^wss?:\/\//i.test(value))
    return fallback
  try {
    const url = new URL(value)
    if (url.protocol !== 'wss:' || url.hostname !== 'gate-obt.nqf.qq.com' || url.pathname !== '/prod/ws')
      return { ...fallback, code: '' }
    const platform = url.searchParams.get('platform')
    return {
      code: url.searchParams.get('code')?.trim() || '',
      gatewayUrl: url.toString(),
      clientVersion: url.searchParams.get('ver')?.trim() || '',
      platform: platform === 'qq' || platform === 'wx' ? platform : '',
    }
  }
  catch {
    return { ...fallback, code: '' }
  }
}
