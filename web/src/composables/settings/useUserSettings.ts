import { storeToRefs } from 'pinia'
import { computed, ref, watch } from 'vue'
import api from '@/api'
import { useSettingStore } from '@/stores/setting'

type AlertType = 'primary' | 'danger'

const CHANNEL_DOCS: Record<string, string> = {
  webhook: '',
  qmsg: 'https://qmsg.zendee.cn/',
  serverchan: 'https://sct.ftqq.com/',
  pushplus: 'https://www.pushplus.plus/',
  pushplushxtrip: 'https://pushplus.hxtrip.com/',
  dingtalk: 'https://open.dingtalk.com/document/group/custom-robot-access',
  wecom: 'https://guole.fun/posts/626/',
  wecombot: 'https://developer.work.weixin.qq.com/document/path/91770',
  bark: 'https://github.com/Finb/Bark',
  gocqhttp: 'https://docs.go-cqhttp.org/api/',
  onebot: 'https://docs.go-cqhttp.org/api/',
  atri: 'https://blog.tianli0.top/',
  pushdeer: 'https://www.pushdeer.com/',
  igot: 'https://push.hellyw.com/',
  telegram: 'https://core.telegram.org/bots',
  feishu: 'https://www.feishu.cn/hc/zh-CN/articles/360024984973',
  ifttt: 'https://ifttt.com/maker_webhooks',
  discord: 'https://discord.com/developers/docs/resources/webhook#execute-webhook',
  wxpusher: 'https://wxpusher.zjiecode.com/docs/#/',
}

export function useUserSettings(showAlert: (message: string, type?: AlertType) => void) {
  const settingStore = useSettingStore()
  const { settings } = storeToRefs(settingStore)

  const offlineSaving = ref(false)
  const offlineTesting = ref(false)

  const localOffline = ref({
    channel: 'smtp',
    reloginUrlMode: 'none',
    endpoint: '',
    token: '',
    title: '',
    msg: '',
    offlineDeleteSec: 0,
    smtpHost: '',
    smtpPort: 465,
    smtpUser: '',
    smtpPass: '',
    senderName: '',
    recipientEmail: '',
    emailContent: '',
  })

  const channelOptions = [
    { label: 'SMTP 邮件', value: 'smtp' },
    { label: 'Webhook(自定义接口)', value: 'webhook' },
    { label: 'Qmsg 酱', value: 'qmsg' },
    { label: 'Server 酱', value: 'serverchan' },
    { label: 'Push Plus', value: 'pushplus' },
    { label: 'Push Plus Hxtrip', value: 'pushplushxtrip' },
    { label: '钉钉', value: 'dingtalk' },
    { label: '企业微信', value: 'wecom' },
    { label: 'Bark', value: 'bark' },
    { label: 'Go-cqhttp', value: 'gocqhttp' },
    { label: 'OneBot', value: 'onebot' },
    { label: 'Atri', value: 'atri' },
    { label: 'PushDeer', value: 'pushdeer' },
    { label: 'iGot', value: 'igot' },
    { label: 'Telegram', value: 'telegram' },
    { label: '飞书', value: 'feishu' },
    { label: 'IFTTT', value: 'ifttt' },
    { label: '企业微信群机器人', value: 'wecombot' },
    { label: 'Discord', value: 'discord' },
    { label: 'WxPusher', value: 'wxpusher' },
  ]

  const reloginUrlModeOptions = [
    { label: '不附带', value: 'none' },
    { label: 'QQ 直链', value: 'qq_link' },
    { label: '二维码链接', value: 'qr_link' },
  ]

  const currentChannelDocUrl = computed(() => {
    const key = String(localOffline.value.channel || '').trim().toLowerCase()
    return CHANNEL_DOCS[key] || ''
  })

  function openChannelDocs() {
    const url = currentChannelDocUrl.value
    if (!url)
      return
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  function syncLocalOfflineSettings() {
    if (settings.value?.offlineReminder) {
      localOffline.value = JSON.parse(JSON.stringify(settings.value.offlineReminder))
    }
  }

  watch(settings, () => {
    syncLocalOfflineSettings()
  }, { deep: true })

  async function handleSaveOffline() {
    offlineSaving.value = true
    try {
      const res = await settingStore.saveOfflineConfig(localOffline.value)

      if (res.ok) {
        showAlert('下线提醒设置已保存', 'primary')
      }
      else {
        showAlert(`保存失败: ${res.error || '未知错误'}`, 'danger')
      }
    }
    finally {
      offlineSaving.value = false
    }
  }

  async function handleTestOffline() {
    offlineTesting.value = true
    try {
      const { data } = await api.post('/api/settings/offline-reminder/test', localOffline.value)
      if (data?.ok) {
        showAlert('测试消息发送成功', 'primary')
      }
      else {
        showAlert(`测试失败: ${data?.error || '未知错误'}`, 'danger')
      }
    }
    catch (e: any) {
      const msg = e?.response?.data?.error || e?.message || '请求失败'
      showAlert(`测试失败: ${msg}`, 'danger')
    }
    finally {
      offlineTesting.value = false
    }
  }

  return {
    offlineSaving,
    offlineTesting,
    localOffline,
    channelOptions,
    reloginUrlModeOptions,
    currentChannelDocUrl,
    openChannelDocs,
    syncLocalOfflineSettings,
    handleSaveOffline,
    handleTestOffline,
  }
}
