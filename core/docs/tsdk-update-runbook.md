# TSDK/WASM 标准更新手册

本文用于把 QQ 农场官方包中的新版 `tsdk.wasm` 更新到 Node.js 宿主。目标是让后续
维护者可以重复执行、比较差异、验证结果和安全回退，而不是直接覆盖二进制文件。

当前基线及运行时调用约定见 [tsdk-ace-runtime.md](./tsdk-ace-runtime.md)。

## 适用范围和原则

- 仅分析自己设备上由 QQ 客户端正常下载和展开的官方运行文件。
- 全程复制源文件后分析，不直接修改 QQ 容器中的缓存。
- WASM 和同目录 `game.js` 必须来自同一个包目录，不能跨版本拼接。
- 新文件先使用版本化名称加入项目；旧版至少保留到在线验收完成。
- SHA-256 相同表示没有二进制更新，不重复升级。
- imports、exports、数据段或初始化参数任一变化，都视为需要适配，不能仅改哈希。
- HAR、日志和 `game.js` 可能含账号标识或 Token，不提交到仓库。

## 1. 在 macOS 定位官方展开目录

1. 正常启动 Mac QQ 和 QQ 农场，等待首页及好友列表加载完成。
2. 退出农场窗口，使缓存文件停止变化。
3. 在终端定义只读源目录：

```bash
QQ_MINIAPP_SRC="$HOME/Library/Containers/com.tencent.qqexminiprogram/Data/Library/Application Support/QQEX/miniapp/temps/miniapp_src"
```

4. 查找农场 AppID `1112386029` 的候选版本：

```bash
find "$QQ_MINIAPP_SRC" -maxdepth 1 -type d -name '1112386029_3_*' -print
```

5. 按 `tsdk/tsdk.wasm` 的修改时间选择最新目录，不要只看目录名哈希：

```bash
find "$QQ_MINIAPP_SRC" -path '*/1112386029_3_*/tsdk/tsdk.wasm' \
  -exec stat -f '%m %Sm %z %N' -t '%Y-%m-%d %H:%M:%S' {} \; | sort -nr
```

候选目录至少应包含：

```text
game.js
tsdk/tsdk.wasm
```

若没有展开目录，再考虑从对应 `.tqapkg` 复制后解包；不要默认使用微信
`.wxapkg` 工具。Mac QQ 正常运行时通常已经生成 `miniapp_src`，无需二次解包。

## 2. 固化源文件

先在仓库外或临时目录创建快照，避免 QQ 自动更新导致分析过程中两个文件版本不一致：

```bash
TSDK_SOURCE="/完整路径/1112386029_3_xxx"
TSDK_SNAPSHOT="$(mktemp -d)"
cp "$TSDK_SOURCE/tsdk/tsdk.wasm" "$TSDK_SNAPSHOT/tsdk.wasm"
cp "$TSDK_SOURCE/game.js" "$TSDK_SNAPSHOT/game.js"
```

记录来源目录、获取日期和 SHA-256：

```bash
shasum -a 256 "$TSDK_SNAPSHOT/tsdk.wasm"
stat -f '%z bytes, %Sm' -t '%Y-%m-%d %H:%M:%S' "$TSDK_SNAPSHOT/tsdk.wasm"
```

## 3. 自动检查结构和兼容性

在 `core` 目录执行：

```bash
npm run inspect:tsdk -- \
  --wasm "$TSDK_SNAPSHOT/tsdk.wasm" \
  --game-js "$TSDK_SNAPSHOT/game.js" \
  --baseline src/utils/tsdk-v3.9.0.1790160550.wasm
```

需要保存机器可读结果时追加 `--json`：

```bash
npm run --silent inspect:tsdk -- \
  --wasm "$TSDK_SNAPSHOT/tsdk.wasm" \
  --game-js "$TSDK_SNAPSHOT/game.js" \
  --baseline src/utils/tsdk-v3.9.0.1790160550.wasm \
  --json
```

使用 `--json` 重定向到文件时必须保留 `--silent`，否则 npm 的脚本启动横幅也会写入
标准输出，文件将不是合法 JSON。

脚本输出：

- 文件大小和 SHA-256；
- imports 模块、名称和类型；
- exports 名称和类型；
- 所有 active data segments 的地址和长度；
- `decrypt_all_data` 中高频常量候选，用于识别解密密钥及函数表地址；
- `game.js` 中的 TSDK 版本候选和关键加载标记；
- 与当前基线的 imports、exports、数据段结构比较。

exports 兼容性按公开名称和类型判断；WASM 内部函数索引允许随编译结果变化，不单独
视为宿主 ABI 破坏。JSON 输出仍保留索引，便于进一步反汇编定位。

脚本只做静态读取，不实例化或执行候选 WASM。

## 4. 人工复核配套 `game.js`

自动检查通过后仍需核对官方宿主行为：

```bash
rg -n -S \
  'tsdk/tsdk\.wasm|SdkInitEx|AnoUserLogin|AceManager|decrypt_all_data|1112386029|3167' \
  "$TSDK_SNAPSHOT/game.js"
```

至少确认：

| 项目 | 当前基线 |
| --- | --- |
| WASM 路径 | `tsdk/tsdk.wasm` |
| TSDK 初始化 | `SdkInitEx(3167, 0)` |
| 用户绑定 | `AnoUserLogin(0, openId)` |
| 小游戏 AppID | `1112386029` |
| 网关 Token | `AceManager.randomStr()` 语义 |
| imports | `a.a` 至 `a.v`，共 22 个函数 |
| 运行时表 | 与 `OFFICIAL_RUNTIME_TABLE` 相同 |

压缩混淆后的属性名可以变化；判断依据应是调用语义、参数、字节内容和执行顺序。

## 5. 差异分级

| 结果 | 处理 |
| --- | --- |
| SHA-256 相同 | 无需更新 |
| 仅版本、哈希和代码体变化，结构相同 | 更新版本化 WASM、版本、哈希并测试 |
| 数据段变化 | 更新 `MERGED_DATA_SEGMENTS`，从 WASM data section 获取，不猜地址 |
| 解密高频常量变化 | 反汇编确认 `MERGED_DATA_KEY`，不可沿用旧值 |
| imports 变化 | 更新 `createImports()`，逐项确认参数和返回值 |
| exports 变化 | 更新 `OFFICIAL_EXPORTS` 和 `REQUIRED_EXPORTS` |
| 运行时表变化 | 从同版本 `game.js` 提取并更新 |
| 初始化或生命周期变化 | 同步修改 `TsdkRuntime`、`AceService` 及测试 |

如果结构不兼容，应停止替换默认文件；先保留旧版运行路径，完成适配和离线测试。

## 6. 更新项目

假设检查出的版本为 `vX.Y.Z.BUILD`：

```bash
cp "$TSDK_SNAPSHOT/tsdk.wasm" "src/utils/tsdk-vX.Y.Z.wasm"
```

在 `src/utils/tsdk-runtime.js` 更新：

```text
OFFICIAL_VERSION
OFFICIAL_SHA256
默认 wasmPath
MERGED_DATA_SEGMENTS（仅当检查结果变化）
MERGED_DATA_KEY（仅当反汇编确认变化）
OFFICIAL_RUNTIME_TABLE（仅当配套 JS 确认变化）
imports/exports 映射（仅当结构变化）
```

同时更新：

```text
docs/tsdk-ace-runtime.md
progress.md
test/tsdk-runtime.test.js（接口或行为变化时）
```

不要覆盖 `tsdk-legacy.wasm`，不要在完成验收前删除上一个可运行的版本化 WASM。

## 7. 离线验证门槛

在 `core` 目录执行：

```bash
node --check src/utils/tsdk-runtime.js
npx eslint src/utils/tsdk-runtime.js test/tsdk-runtime.test.js test/gateway-token.test.js
node --test test/tsdk-runtime.test.js test/gateway-token.test.js
npm test
```

必须验证：

- SHA-256 和必要导出校验；
- WASM 初始化和 `getResult()`；
- 加解密往返；
- Token 非空且连续调用不同；
- ACE heartbeat 产生二进制数据；
- 多账号实例隔离；
- 错误版本被拒绝；
- destroy 后禁止继续调用。

任何一项失败都不能切换默认 WASM。

## 8. 在线验收

离线测试通过不代表服务端接受。使用专用测试账号分两阶段验证：

1. 连续运行至少 5 分钟，覆盖登录、自己农场、好友列表和一次好友操作。
2. 连续运行至少 30 分钟，覆盖 ACE 上报、TSDK heartbeat、重连和多次好友操作。

检查日志中：

- 没有 WASM 初始化、内存越界或 checksum mismatch；
- `AntiData` 请求持续成功且服务器响应被回灌；
- WebSocket 无异常重连循环；
- Enter、AllLands、Farming 及好友操作持续有效；
- 停止账号或重连后旧 ACE 定时器已销毁。

在线验收结果应写入 `progress.md`，包括测试日期、时长、覆盖操作和失败现象。

## 9. 回退

若在线出现服务端拒绝或运行时异常：

1. 将 `OFFICIAL_VERSION`、`OFFICIAL_SHA256` 和默认 `wasmPath` 恢复到上一个版本。
2. 若宿主映射也有修改，一并恢复匹配版本的 imports、exports、数据段和运行时表。
3. 重跑完整离线测试。
4. 重新构建并重启部署，不要让新旧宿主参数交叉使用。

版本化文件的目的就是保证回退时无需重新寻找旧二进制。

## 发布检查清单

- [ ] WASM 与 `game.js` 来自同一官方展开目录
- [ ] 记录版本、来源日期、大小和 SHA-256
- [ ] 执行 `inspect:tsdk` 并保存差异结论
- [ ] 复核初始化参数、运行时表、Token 和生命周期
- [ ] 使用版本化文件名加入新 WASM
- [ ] 更新运行时代码、调用约定和维护记录
- [ ] 定向测试通过
- [ ] 完整后端测试通过
- [ ] 5 分钟在线验收通过
- [ ] 30 分钟在线验收通过
- [ ] 保留上一可运行版本用于回退
