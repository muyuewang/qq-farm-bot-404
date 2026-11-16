import { defineStore } from 'pinia'
import { ref } from 'vue'

class ProtocolNetworkError extends Error {}

export const useWxLoginStore = defineStore('wx-login', () => {
  // 扫码登录状态
  const isLoading = ref(false)
  const qrCode = ref<string | null>(null)
  const qrCreatedAt = ref(0)
  const uuid = ref('')
  const wxid = ref('')
  const status = ref<'idle' | 'qr_loading' | 'qr_ready' | 'scanning' | 'confirming' | 'code_loading' | 'success' | 'error'>('idle')
  const statusMessage = ref('')
  const errorMessage = ref('')

  // 重置登录状态
  function resetState() {
    qrCode.value = null
    qrCreatedAt.value = 0
    uuid.value = ''
    wxid.value = ''
    status.value = 'idle'
    statusMessage.value = ''
    errorMessage.value = ''
  }

  function buildProtocolHeaders() {
    return {
      'Content-Type': 'application/json',
      'x-admin-token': localStorage.getItem('admin_token') || '',
    }
  }

  async function requestProtocol(body: Record<string, any>) {
    let response: Response
    try {
      response = await fetch('/api/wx-login/protocol', {
        method: 'POST',
        headers: buildProtocolHeaders(),
        body: JSON.stringify(body),
      })
    }
    catch (error: any) {
      throw new ProtocolNetworkError(error.message)
    }
    if (!response.ok)
      throw new Error(`HTTP ${response.status}`)
    try {
      return await response.json()
    }
    catch (error: any) {
      if (error instanceof TypeError || error?.name === 'AbortError')
        throw new ProtocolNetworkError(error.message)
      throw error
    }
  }

  // 获取二维码
  async function getQRCode(): Promise<boolean> {
    isLoading.value = true
    status.value = 'qr_loading'
    statusMessage.value = '正在获取二维码...'
    errorMessage.value = ''

    try {
      const result = await requestProtocol({ action: 'getqr' })
      let data: any
      if (result.code === 0 && result.data) {
        data = {
          Success: true,
          Data: {
            Uuid: result.data.Uuid || result.data.uuid,
            QrBase64: result.data.QrBase64 || result.data.qrBase64,
          },
        }
      }
      else if (result.Success !== undefined) {
        data = result
      }
      else {
        data = { Success: false, Message: result.msg || '获取二维码失败' }
      }

      if (data.Success && data.Data) {
        uuid.value = data.Data.Uuid
        qrCode.value = data.Data.QrBase64 || data.Data.qrBase64 || ''
        qrCreatedAt.value = Date.now()
        status.value = 'qr_ready'
        statusMessage.value = '请使用微信扫码登录'
        return true
      }
      else {
        status.value = 'error'
        qrCreatedAt.value = 0
        errorMessage.value = data.Message || '获取二维码失败'
        return false
      }
    }
    catch (e: any) {
      status.value = 'error'
      qrCreatedAt.value = 0
      errorMessage.value = `请求失败: ${e.message}`
      return false
    }
    finally {
      isLoading.value = false
    }
  }

  // 检查登录状态
  async function checkLogin(): Promise<{ success: boolean, wxid?: string, nickname?: string, avatar?: string }> {
    if (!uuid.value) {
      return { success: false }
    }

    const checkedUuid = uuid.value
    const previousStatus = status.value === 'confirming' ? 'confirming' : 'qr_ready'
    errorMessage.value = ''
    status.value = 'scanning'
    statusMessage.value = '正在检查登录状态...'

    try {
      const result = await requestProtocol({
        action: 'checkqr',
        uuid: checkedUuid,
      })
      if (uuid.value !== checkedUuid)
        return { success: false }
      let data: any
      // 尝试从不同字段获取wxid
      const resultData = result.data || result.Data || {}
      const resultWxid = resultData.wxid || resultData.Wxid || resultData.userName || resultData.UserName || ''
      const resultNickname = resultData.nickname || resultData.Nickname || resultData.nickName || resultData.NickName || '微信用户'
      const resultAvatar = resultData.avatar || resultData.Avatar || resultData.avatarUrl || resultData.AvatarUrl || resultData.headImgUrl || resultData.HeadImgUrl || ''

      if (result.code === 0 && resultWxid) {
        // 真正登录成功（有wxid）
        data = {
          Success: true,
          Data: {
            acctSectResp: {
              userName: resultWxid,
              nickName: resultNickname,
              avatar: resultAvatar,
            },
          },
        }
      }
      else if (result.code === -1 || result.code === -2 || (result.code === 0 && !resultWxid)) {
        // 等待扫码或等待确认，不是错误
        data = {
          Success: true,
          Data: {
            status: result.code === -2 ? 1 : 0,
          },
        }
      }
      else if (result.Success !== undefined) {
        data = result
      }
      else {
        data = { Success: false, Message: result.msg || '登录检查失败' }
      }

      const acctResp = data?.Data?.acctSectResp || data?.Data?.AcctSectResp
      const userName = acctResp?.userName || acctResp?.UserName
      const nickName = acctResp?.nickName || acctResp?.NickName || '微信用户'
      const avatar = acctResp?.avatar || acctResp?.Avatar || acctResp?.avatarUrl || acctResp?.AvatarUrl || acctResp?.headImgUrl || acctResp?.HeadImgUrl || ''
      const qrStatus = data?.Data?.status

      if (data.Success && userName) {
        wxid.value = userName
        status.value = 'success'
        statusMessage.value = `登录成功！欢迎 ${nickName}`
        return { success: true, wxid: userName, nickname: nickName, avatar }
      }
      else if (data.Success && (qrStatus === 1 || qrStatus === 0)) {
        status.value = qrStatus === 1 ? 'confirming' : 'qr_ready'
        statusMessage.value = qrStatus === 1 ? '已扫码，请在手机确认登录' : '等待扫码中'
        return { success: false }
      }
      else {
        status.value = 'error'
        errorMessage.value = data.Message || '登录检查失败'
        return { success: false }
      }
    }
    catch (e: any) {
      if (uuid.value !== checkedUuid)
        return { success: false }
      if (e instanceof ProtocolNetworkError) {
        status.value = previousStatus
        statusMessage.value = '连接暂时中断，正在重试登录检查...'
        return { success: false }
      }
      status.value = 'error'
      errorMessage.value = `请求失败: ${e.message}`
      return { success: false }
    }
  }

  // 获取QQ农场Code
  async function getFarmCode(wxidParam?: string): Promise<{ success: boolean, code?: string }> {
    const targetWxid = wxidParam || wxid.value
    if (!targetWxid) {
      return { success: false }
    }

    isLoading.value = true
    status.value = 'code_loading'
    statusMessage.value = '正在获取QQ农场Code...'
    errorMessage.value = ''

    try {
      const result = await requestProtocol({
        action: 'jslogin',
        wxid: targetWxid,
        sessionId: uuid.value,
      })
      let data: any
      const resultData = result.data || result.Data || {}
      if (result.code === 0 && resultData) {
        data = {
          Success: true,
          Data: {
            code: resultData.code || resultData.Code,
          },
        }
      }
      else if (result.Success !== undefined) {
        data = result
      }
      else {
        data = { Success: false, Message: result.msg || '获取Code失败' }
      }

      if (data.Success && data.Data && data.Data.code) {
        status.value = 'success'
        statusMessage.value = '已获取QQ农场Code'
        return { success: true, code: data.Data.code }
      }
      else {
        const errMsg = data.Data?.jsapiBaseresponse?.errmsg || data.Message || '获取Code失败'
        status.value = 'error'
        errorMessage.value = errMsg
        return { success: false }
      }
    }
    catch (e: any) {
      status.value = 'error'
      errorMessage.value = `请求失败: ${e.message}`
      return { success: false }
    }
    finally {
      isLoading.value = false
    }
  }

  return {
    isLoading,
    qrCode,
    qrCreatedAt,
    uuid,
    wxid,
    status,
    statusMessage,
    errorMessage,
    resetState,
    getQRCode,
    checkLogin,
    getFarmCode,
  }
})
