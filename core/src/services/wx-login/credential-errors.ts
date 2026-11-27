export {};

/**
 * 微信凭据错误分类。判定规则与 evolution 项目一致：只有明确授权失效才要求重新扫码，
 * 网络波动、结构异常码（如 -1）仍按可重试失败处理。
 */
function isDefinitiveWxCredentialError(raw: unknown): boolean {
  const message = String(raw || '').toLowerCase();
  if (/\b40188\b/.test(message)) return true;
  if (message.includes('授权范围') && (message.includes('失效') || message.includes('无效') || message.includes('重新扫码'))) return true;
  if (/code=-101\b/.test(message) && message.includes('credential response rejected')) return true;
  if (message.includes('40030') || message.includes('42007')) return true;
  if (/refresh[ _-]?token/.test(message) && (message.includes('-109') || message.includes('empty token'))) return true;
  return /(?:invalid|expired)\s+(?:refresh[ _-]*)?(?:token|credential)\b/.test(message)
    || /(?:refresh[ _-]*)?(?:token|credential)\s+(?:is\s+)?(?:expired|invalid)\b/.test(message)
    || /凭证已?(?:过期|失效)/.test(message);
}

/** 换 Code 失败时，是否值得先滚动长凭据再重试一次。 */
function shouldRefreshForCodeError(raw: unknown): boolean {
  const message = String(raw || '').toLowerCase();
  return message.includes('manualauth rejected')
    || message.includes('invalid scope')
    || message.includes('授权范围')
    || message.includes('40188')
    || message.includes('40030')
    || message.includes('42007')
    || message.includes('credential expired')
    || message.includes('凭证已失效');
}

/** 日志只保留阶段/数字状态；上游回包可能回显 token 或 login buffer。 */
function credentialResponseError(stage: string, data: any): Error & { wxStage: string; wxCode: number | null } {
  const source = data && typeof data === 'object' ? data : {};
  const rawCode = source.code;
  const code = (typeof rawCode === 'number' || (typeof rawCode === 'string' && /^-?\d+$/.test(rawCode)))
    && Number.isSafeInteger(Number(rawCode)) ? Number(rawCode) : null;
  const reason = code === 40188 ? 'invalid scope' : 'credential response rejected';
  const error = new Error(`WeChat ${stage} failed: code=${code ?? 'unknown'} ${reason}`) as Error & { wxStage: string; wxCode: number | null };
  error.wxStage = stage;
  error.wxCode = code;
  return error;
}

/** 统一脱敏并截断，避免把凭据原文写进账号日志或系统日志。 */
function sanitizeWxCredentialError(raw: unknown): string {
  let message = String((raw as any)?.message ?? raw ?? '').slice(0, 300);
  message = message.replace(/((?:access[_-]?token|refresh[_-]?token|login[_-]?buffer|token)\s*[=:]\s*)[^,\s;]+/gi, '$1[REDACTED]');
  message = message.replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]');
  if (message.includes('ManualAuth rejected')) return '微信登录凭证已失效，请在面板重新扫码登录';
  if (message.includes('40188') && message.toLowerCase().includes('invalid scope')) return '微信授权范围已失效，需要重新扫码授权';
  if (message.includes('socket read timeout') || message.includes('Unable to establish') || message.includes('invalid HTTP response')) {
    return '无法连接微信服务器（网络波动），请稍后重试';
  }
  return message || '未知的微信凭据错误';
}

module.exports = {
  isDefinitiveWxCredentialError,
  shouldRefreshForCodeError,
  credentialResponseError,
  sanitizeWxCredentialError,
};
