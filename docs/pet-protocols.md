# 个人页宠物协议

个人 → 宠物页面上的每个动作都是一次 `gamepb.dogpb.DogService` RPC。本文结论来自
2026-09-14 的抓包复核（目录由解码脚本参数传入，
`pnpm -C core exec tsx ../tools/decode-latest-protocols.js <capture-dir> --all`）。

## 图鉴项的状态位

`GetDogInfoReply.dogs[]` 是 `DogInfo`，其中 `status`（字段 4）对所有图鉴项都返回 1，
`level`（字段 5）对所有项都返回 100，两者都不能用来判断玩家状态。真正的状态位是：

| 字段 | 含义 | 依据 |
| --- | --- | --- |
| `field_6` | 背包里有同 ID 的宠物卡时置 1，代表“可激活” | 激活前 `GetDogInfo` 只有 `field_6`，同一时刻 `ItemService.Bag` 里存在 `90031`（uid 3069）。 |
| `owned` | 已激活（可上场）的宠物置 1 | `ActivateDog` 之后 `field_6` 消失、`owned` 出现；`DeployDog` 只接受带 `owned` 的宠物。 |
| `field_10` | 疑似“新获得未查看”，激活后出现、`ViewDog` 后消失 | 语义未完全证明，当前不参与业务判断。 |

宠物本体是 `type = 8` 的道具（`ItemInfo.json`），所以“拥有卡片”和“已获得宠物”是两件事：
卡片只是激活材料，激活时会被服务端消耗。

## 激活

`ActivateDogRequest { dog_id = 1 }` / `ActivateDogReply { dog = 1 }`，回包字段 1 是激活
后的 `DogInfo`。抓包样本（ws_00148 / ws_00149，比熊犬 90031）：

```
请求 body: 08afbf05
回包 body: 0a1c 08afbf05 1209e6af94e7868ae78aac 188827 2001 2864 3001 3801 5001
           ^dog     id=90031  name=比熊犬        price  st  lv  f6  owned f10
```

激活成功后服务端紧接着推送 `ItemNotify`：宠物卡（`90031`，uid 3069）`delta = -1`，
证明卡片被消耗。`core/src/services/pets.ts` 的 `activateDog()` 在发请求前用
`field_6` 或背包卡片计算出的 `activatable` 做校验，发请求后再拉一次快照确认 `owned`。

## 上场与收回

- `DeployDogRequest { dog_id = 1 }` / `DeployDogReply { dog_id = 1 }`，只能对已激活的
  宠物调用；成功后 `GetDogInfoReply.current_dog_id` 变为该宠物 ID，并推送
  `DogSkinChangeNotify`。
- `WithdrawDogRequest {}`（真实请求体为空）/ `WithdrawDogReply { dog_id = 1 }`；收回后
  `current_dog_id` 缺失。

## 狗粮

- `AddFoodRequest { item_id = 1, count = 2 }` 是宠物页狗盆的“确定”，回包的
  `protect_time` 是使用后的剩余秒数。走的是 `DogService` 而不是 `ItemService.Use`。
- `GetDogInfoReply.items[].status`（字段 3）是状态位不是库存，三种狗粮都可能返回 1；
  真实库存必须读 `ItemService.Bag`。

## 守护记录

`GetProtectLogsRequest { field_1 = 1, count = 2, field_3 = 3 }`，真实点击固定发送
`{ 0, 100, 0 }`；字段 1/3 的语义尚未证明，当前不解释成分页或筛选。
