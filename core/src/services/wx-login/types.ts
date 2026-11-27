export {};

/** 扫码成功后可持久化的微信长凭据；不是一次性农场 Code。 */
export interface WxCredentialSnapshot {
  openid: string;
  loginBuffer: string;
  refreshToken: string;
  accessToken: string;
  loginType: string;
  expiresAt: number;
  expiresIn: number;
  observedAt: number;
}

export interface WxCredentialCheckpoint extends WxCredentialSnapshot {
  /** refresh token / access token 是否已发生轮换。 */
  rotated: boolean;
}

export interface WxCredentialRefreshResult extends WxCredentialSnapshot {
  rotated: boolean;
}

export interface WxCredentialRefreshOptions {
  shouldContinue?: () => boolean;
  onCredentialsRefreshed?: (checkpoint: WxCredentialCheckpoint) => Promise<void> | void;
}

export interface WxCredentialRecord extends WxCredentialSnapshot {
  fingerprint: string;
  blocked: boolean;
  blockedFingerprint: string;
  lastSuccessAt: number;
  updatedAt: number;
}
