const {
    CONFIG,
    DEFAULT_CLIENT_VERSION,
    DEFAULT_WX_CLIENT_VERSION,
    isWechatPlatform: matchWechatPlatform,
} = require('../config/config');

// worker 启动时按账号写入 CONFIG.platform，因此这里按全局平台判定即可。
function isWechatPlatform(platform = CONFIG.platform) {
    return matchWechatPlatform(platform);
}

/** 取当前平台自己的客户端版本号，QQ 的覆盖值不会串到微信会话上。 */
function getClientVersion() {
    if (isWechatPlatform()) {
        return String(CONFIG.wxClientVersion || '').trim() || DEFAULT_WX_CLIENT_VERSION;
    }
    return String(CONFIG.clientVersion || '').trim() || DEFAULT_CLIENT_VERSION;
}

module.exports = { isWechatPlatform, getClientVersion };
