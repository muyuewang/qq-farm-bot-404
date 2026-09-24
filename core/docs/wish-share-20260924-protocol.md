# 秋祈良愿、快乐不独享协议恢复（2026-09-24）

## 来源与边界

- HAR：`秋祈良愿、快乐不独享.har`，2026-09-24 09:13—09:16（北京时间），204 帧；本报告不保存原始 HAR、账号凭据或分享密钥。
- 最新完整客户端：`1112386029_3_6c5822fdebd22777ef4f6bdf929ecb01`，`tsdk/tsdk.wasm` 修改时间 2026-09-24 09:13:44.828（UTC+8），大小 161081 字节。
- 在隔离 Node VM 中仅恢复了官方 `assets/main/index.07c56.js` 注册的 `chunks:///_virtual/activitypb.ts`；没有启动游戏，也没有对真实账号发送请求。
- HAR 的服务端响应是可解的 protobuf；五条 `Operate` 请求体经客户端传输变换，不可直接按 protobuf 解码。请求体证据标记为 `encrypted-undecoded-capture`（`decoded: false`），下列请求 hex 是 **official-encoder-reconstruction**，不是原始抓包明文。

## 活动与时间

| 活动 | 组 ID | 子活动 ID | 客户端 uid | 官方时间窗（UTC+8） | 活动体 |
| --- | ---: | ---: | --- | --- | --- |
| 秋祈良愿 | 2026092400 | 2026092401 | `WishSignMainUI` | 09-24 00:00:00 至 10-07 23:59:59 | `ActivityData.wish_sign = 119` |
| 快乐不独享 | 2026092500 | 2026092501 | `HappySharePanel` | 09-24 00:00:00 至 10-12 23:59:59 | `ActivityData.share_reward = 120` |

## 操作与编码

字段号与 wire type 通过官方生成消息的 `create`/`encode` 非默认 sentinel 探测，并由回复标签交叉验证（`official-generated-code`、`official-encoder-probe`、`historical-plaintext-capture`）。

| 操作 | 官方 `OperateType` | `cmd` | 请求字段与子字段 | 回复字段 | 编码重构 |
| --- | --- | ---: | --- | --- | --- |
| 祈愿（选择感情） | `WISH_SIGN_DRAW` | 51 | `wish_sign_draw=151`，`choose_id=1`，值 2 | `wish_sign_draw=151` | `08f1ee8ec6071033ba09020802` |
| 领取祈愿奖励 | `WISH_SIGN_CLAIM` | 52 | `wish_sign_claim=152`，`choose_id=1`，值 2 | `wish_sign_claim=152` | `08f1ee8ec6071034c209020802` |
| 每日领取 | `SHARE_REWARD_CLAIM_DAILY` | 73 | 仅活动 ID、命令（请求体长度 8） | `share_reward_claim_daily=157` | `08d5ef8ec6071049` |
| 分享快乐包 | `SHARE_REWARD_SHARE` | 69 | 仅活动 ID、命令（请求体长度 8） | `share_reward_share=153` | `08d5ef8ec6071045` |
| 领取全部可领奖档 | `SHARE_REWARD_CLAIM_MILESTONES` | 70 | 仅活动 ID、命令（请求体长度 8） | `share_reward_claim_milestones=154` | `08d5ef8ec6071046` |

五次明文响应的网关 `error_code` 均为 0。抓包序列号：祈愿 48、领取 51；每日领取 67、分享 69、档位领奖 78。`WishSignDrawRsp` 为 `text_id=1, day_id=2, rewards=3`；`WishSignClaimRsp.awards=1`。选择后的 `WishSignPending` 为 `choose_id=1, text_id=2, day_id=3, rewards=4`。状态体为 `remaining_count=1, activity_day=2, pending=3`。

`ShareRewardSummary` 为 `score_item_id=1, current_score=2, daily=3, my_pool=4, milestones=5, daily_reward=6, first_share_reward=7, red_dots=8`。`daily` 的 `claimed_count=1, first_share_awarded=2, daily_reward_claimed=3, claim_limit=4`；档位的 `tier_id=1, threshold=2, rewards=3, state=4`。抓包从 0 → 5 → 10 快乐值，第 1 档 `state` 从 1 → 2 → 3；这支持“未达成 / 可领取 / 已领取”的解释，不代表其他状态枚举已全部观测。

分享返回的 `ShareRewardArk` 含 `share_key`、`share_open_id` 等敏感信息，不能写日志或在活动状态接口下发；本地只归一化本次增加的快乐值。HAR 还出现 `ShareService.CheckCanShare`、`ReportShare`，但无法仅凭本次样本证明浏览器可以等价地完成 QQ 原生分享。好友点击快乐包及 `SHARE_REWARD_RESOLVE=72` 不在本次抓包操作范围内。

## 放烟花与物品

放烟花不是 `ActivityService.Operate`：HAR 中有两次 `ItemService.Use`，响应 `used_items` 都为 `{id:6001, count:1, uid:958}`，其间还有土地 `Farming` 请求。物品 `6001` 在官方 `ItemInfo` 中为「烟花·玉兔望月」，使用时必须携带背包 UID；仓库现有 `useItem` 会从背包查 UID。缺少独立的点燃烟花协议/位置参数，不实现自动点燃。

官方 `ActivityWishSignChoose` 列出 1—6：财运、感情、前程、生活、农耕、人际。奖励表 14 天中包含种子 26030（月下美人）和 20435（山丹丹）；官方 `Plant` 表的 `size` 都为空（按单格处理），果实 ID 分别为 46030、40435。抓包当日祈愿结果为烟花 6001 ×20。所有物品名称以项目静态配置或官方配置表为准，不使用运行时 CDN。

活动只读页的每日奖励池来自当前客户端 `delayRes/ActivityWishSignReward` 的 14 条静态表，存于 `core/src/gameConfig/WishSignRewards.json`；“明日奖励”仅按服务端 `activity_day + 1` 取表中对应项，超过第 14 日不展示。`祈愿池` 的六种方向来自 `ActivityWishSignChoose`，不是可点击操作。烟花库存只在个人背包显示，背包一次使用一枚；图片使用 `extraRes` 官方资源，入库的来源与摘要见 `web/public/activity/wish-sign/assets.json`。

## 验证与未覆盖项

- `test/wish-share-activity.test.js` 固化五条官方编码重构，固定明文响应状态，并测开始/结束边界。
- 未对真实账号进行额外操作或验收；HAR 中的动作成功不构成对新增项目操作的真实账号验证。
- 官方分享 Ark 的 QQ 原生转发、好友领取快乐包、烟花点燃和全部失败码尚无可验证的本地流程；不能把 `ReportShare` 当作真正完成了用户分享。
