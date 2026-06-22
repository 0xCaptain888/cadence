# Cadence 提交前准备清单（PREREQUISITES）

> 本文是"动手前要先备齐什么"的清单：账号、密钥、钱包、领水、部署、以及上链所需的每一个环境变量从哪里来。
> **重要：MOCK 模式（默认）什么都不需要——`npm start` 直接能跑。** 下面这些只在你要做**真实测试网结算（LIVE）**和**正式提交**时才需要。
> 同样重要：以下涉及 Circle / Arc 的具体取值（RPC、USDC 合约地址、领水入口、ERC-8004 注册表地址）会随官方更新而变化，**请以 hackathon 官方页面与 Circle/Arc 官方文档的最新值为准**，本文用占位符 + 指引，不臆造地址。

---

## A. 账号与仓库

- [ ] **Lepton / Canteen 参赛账号**：确认报名状态与提交入口（https://lepton.thecanteenapp.com/）。留意截止时间与"可多次提交"。
- [ ] **GitHub 公开仓库**：把本项目推上去（README 必须在根目录）。仓库需 public，评委会直接读代码 + 打开产品。
- [ ] **Circle 开发者账号**：在 Circle 开发者控制台注册，用于拿 API Key、接入 Gateway / 可编程钱包。

---

## B. Circle 凭据

- [ ] **`CIRCLE_API_KEY`**：Circle 开发者控制台 → API Keys 创建（**用测试/沙盒环境的 key**）。
- [ ] **`CIRCLE_GATEWAY_URL`**：默认 `https://api.circle.com/v1/w3s/gateway`；若官方文档给出沙盒/测试网专用网关地址，以官方为准并覆盖。
- [ ] 通读 Circle **Gateway / 纳米支付** 与 **可编程钱包** 文档，确认：批量结算端点路径、EIP-3009 `TransferWithAuthorization` 的提交格式、测试网支持情况。（代码里 `src/core/settlement.js → settleReal()` 即对接点，按官方实际字段微调。）

---

## C. Arc 测试网

- [ ] **`CADENCE_RPC_URL`**：Arc 测试网 RPC 端点（官方文档 / hackathon 资源页获取）。
- [ ] **`CADENCE_CHAIN_ID`**：Arc 测试网 chainId（官方值）。
- [ ] **`CADENCE_USDC_ADDRESS`**：Arc 测试网上的 USDC 合约地址（官方值，**务必核对**，付款资产错了就全错）。
- [ ] **测试网领水（faucet）**：
  - 原生 gas 代币领水入口：______（填官方）
  - 测试网 USDC 领水/铸造入口：______（填官方）
- [ ] **区块浏览器**：Arc 测试网浏览器 URL：______（用于截图交易作为 traction 证据）。

---

## D. 钱包与私钥

> **安全红线：只用测试网专用钱包；私钥绝不进仓库、绝不复用任何持有真实资产的私钥；`.env` 不提交（已在 `.gitignore`）。**

- [ ] **结算 Operator 钱包**：新建一个测试网钱包作为 Agent 的结算账户。
  - 地址：______
  - `CADENCE_OPERATOR_PRIVATE_KEY`：______（仅测试网；放进本地 `.env`）
  - 领一些 gas + 测试 USDC 到该地址。
- [ ] **艺人收款测试钱包**：演示用的若干收款地址。仓库内 `data/registry.json` 已内置占位测试地址 `0x1111…0001` 到 `0x…0010`；做 LIVE 演示时，把其中几个替换成你**真实控制的测试网地址**，这样能在浏览器里看到真到账。
  - 注意：注册表里**故意留空**了几位艺人的钱包（Radiohead / Maya Lin Trio / J. Halloran / Sofia Reyes Quartet）以演示**托管**路径——保持其空缺。

---

## E. ERC-8004 身份注册表

- [ ] **`ERC8004_REGISTRY`**（部署合约时用）：ERC-8004 身份注册表地址。
  - 若 Arc 测试网已有规范部署：填官方地址。
  - 若没有：可临时部署一个实现了 `ownerOf(bytes32) → address` 的最小注册表用于演示 `claim()` 门控，并在提交说明里注明这是演示用注册表。
- [ ] 确认你的 operator/艺人地址在该注册表里对相应 `identityHash` 具备所有权，否则 `claim()` 会按设计被拒（`NotIdentityOwner`）。

---

## F. 部署 `CadenceSplitter`

> 仓库不依赖合约即可运行（MOCK）。仅在做 LIVE 时部署。

- [ ] 安装工具（如 Foundry）。
- [ ] 部署（示例）：
  ```bash
  forge create contracts/CadenceSplitter.sol:CadenceSplitter \
    --rpc-url "$CADENCE_RPC_URL" \
    --private-key "$CADENCE_OPERATOR_PRIVATE_KEY" \
    --constructor-args "$CADENCE_USDC_ADDRESS" "$ERC8004_REGISTRY" "$OPERATOR_ADDRESS"
  ```
- [ ] 记下部署地址，填入 **`CADENCE_SPLITTER_ADDRESS`**。
- [ ] 给合约注资测试网 USDC：先 `approve` 再调用合约的 `fund(amount)`（或直接转入余额）。用 `available()` 确认可用余额（= 余额 − 已托管）。

---

## G. 环境变量总表（对照 `.env.example`）

| 变量 | 何时需要 | 从哪里来 |
|---|---|---|
| `CADENCE_SETTLEMENT_MODE` | 切 LIVE 时设 `real` | 自己设 |
| `CADENCE_MONTHLY_BUDGET_USD` / `CADENCE_PER_PLAY_USD` / `CADENCE_MIN_PLAY_SECONDS` | 可选，调经济模型 | 自己设（有默认） |
| `CADENCE_MAX_PLAYS_PER_HOUR` / `CADENCE_MIN_INTERVAL_SECONDS` / `CADENCE_LOOP_WINDOW_SECONDS` | 可选，调反作弊 | 自己设（有默认） |
| `ANTHROPIC_API_KEY` / `CADENCE_LLM_MODEL` | 可选，给难 case 用模型 | Anthropic 控制台（无 key 则全确定性） |
| `CADENCE_MUSICBRAINZ` | 可选，设 `on` 走实时元数据 | 自己设（默认走内置缓存，离线） |
| `CADENCE_USDC_ADDRESS` | LIVE | Arc 官方 |
| `CADENCE_SPLITTER_ADDRESS` | LIVE | 你部署后得到 |
| `CADENCE_CHAIN_ID` | LIVE | Arc 官方 |
| `CADENCE_RPC_URL` | LIVE | Arc 官方 |
| `CADENCE_OPERATOR_PRIVATE_KEY` | LIVE | 你的测试网钱包（保密） |
| `CIRCLE_API_KEY` | LIVE | Circle 控制台 |
| `CIRCLE_GATEWAY_URL` | LIVE | 默认值或官方沙盒地址 |
| `PORT` | 可选 | 自己设（默认 3000） |

---

## H. Traction 证据清单（30% 维度）

赛程窗口内要能拿出"真实结算发生过"的证据：
- [ ] LIVE 模式下一次成功结算的**链上交易哈希** + 区块浏览器截图。
- [ ] 仪表盘 LIVE 徽章亮起 + 真实 txHash 出现在决策带里的截图/录屏。
- [ ] 至少一位"艺人测试钱包"余额真实增加的截图。
- [ ] 一次 `claim()` 从托管领出 USDC 的交易（演示 ERC-8004 门控）。
- [ ] （可选）邀请一两位真人用自托管 Subsonic/Navidrome 接入产生真实 scrobble。

---

## I. 安全与卫生

- [ ] `.env` 未被提交（已在 `.gitignore`；提交前 `git status` 再确认）。
- [ ] 私钥只在本地 `.env`，且仅测试网。
- [ ] 仓库里不留任何真实密钥（`data/registry.json` 里的都是占位测试地址）。
- [ ] LIVE 操作只在测试网；金额保持纳米级，避免意外。

---

## J. 提交前最终冒烟（建议在干净环境跑一遍）

```bash
node --version            # ≥ 18
npm start                 # 打开 http://localhost:3000，点 Run simulation 应实时刷出决策带
npm run verify            # 应输出 ✓ ALL PASSED（9 个 case + 账本不变量全过）
npm run simulate          # 终端应有逐条决策动画与账本汇总
```

- [ ] 以上三条全部通过。
- [ ] README 首屏可读、截图最新、三份文档都在仓库内。
- [ ] 视频 <3 分钟、产品优先、含一次推理链展开。

> 备注：完整 LIVE 端到端（真实签名 + Gateway 提交）需要在**你自己的机器 + 网络**上完成；本仓库默认 MOCK 已能完整演示 Agent 行为与账本逻辑。若 LIVE 某步报错，错误信息会明确指出缺哪个环境变量（见 `settlement.js` 的 `settleReal()` 守卫）。
