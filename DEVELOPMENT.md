# Cadence 开发蓝图（DEVELOPMENT）

> 本文是 Cadence 参赛 **Lepton Agents Hackathon**（主办 Canteen，合作方 Circle + Arc，主题 nanopayments）冲击 **Grand Prize（$10k）** 的完整开发与策略文档。
> 读者对象：你自己（参赛者）。README 面向评委，本文面向"如何把这件事做对、做满分"。

---

## 0. 一句话定位

**Cadence 是一个为自托管音乐（Navidrome / Subsonic）服务的"自主版税结算 Agent"：它判断每一次播放该把钱付给谁、怎么分、以及到底该不该付，然后在 Arc 上用 USDC 纳米支付即时结算。**

核心洞察一句话：**归属元数据本身就是结算逻辑（attribution metadata *is* settlement logic）。** 只要能回答"这首歌是谁、以什么角色参与、这次播放是不是真的"，就能自动把钱付给正确的人。整个系统都为这句话服务。

---

## 1. 为什么是这个方向（蓝海选择）

主办方 Canteen 在《Distribution Bootstrap for Payments Founders》里把话说得很直白：**支付创业最难的不是技术，是分发**。最好的打法是把支付层"挂"到已经存在的开源创作者社区上。他们列出的 8 条 "Requests for Payments Founders" 里，**音乐排在最前**：第 1 条是 Subsonic 的 scrobble 支付边车，第 2 条是 MusicBrainz 付款人注册表。

由此得出的判断：
- **蓝海**：自托管音乐（Navidrome / Subsonic）上的版税结算，几乎没有可见竞品。
- **红海（要避开）**：Agent 市场、按爬取付费的"过路费"、API 路由计费——人人都在做。
- **命名**：希腊字母/币种命名已经烂大街，改用音乐语义的 **Cadence（终止式/节奏）**。

我们正面命中主办方"最想要的那条"，并且用一个评委一眼就能看懂的真实场景（音乐人收到钱）来承载。

---

## 2. 评分维度与拿分策略

评审是**异步**的：没有 demo day，评委直接读 GitHub 仓库 + 打开你的产品点一点。所以一切都要"为一个不认识你、自己点进来的评委"而建。

| 维度 | 权重 | Cadence 如何拿满 |
|---|---|---|
| **Agentic Sophistication（自主性）** | 30% | 不是"AI 味的自动化"，而是**真判断**：每次播放都要决策 who / how / whether，并产出可展开的推理链。把决策做在**比竞品更难的长尾 case** 上（PD 古典、Various Artists、remix 血统、托管、洗单），并诚实地对不确定的 case 选择"托管 + 标记复核"。 |
| **Traction（真实使用）** | 30% | 赛程窗口内有**真实测试网 USDC 流动**、创作者被付到钱。产品零安装即可跑，降低任何人试用的门槛；LIVE 模式可在 Arc 测试网真实结算。 |
| **Circle 工具用量** | 20% | 深度而非点缀：Gateway/纳米支付（EIP-3009 批量）、Agent/可编程钱包、x402（402 握手）、ERC-8004（身份门控领取）、USDC on Arc。见 §7。 |
| **Innovation（创新）** | 20% | 用户中心化版税模型（自己的钱只分给自己听的人）+ "归属即结算" + 可移植结算核心（音乐→直播→转发）。 |

奖项结构：Grand $40k（1st $10k×1，2nd $7.5k×2，3rd $5k×3），Standout $7.5k，Feedback $500，彩蛋 $2k。**允许多次提交**——先交一版占位，再迭代。

---

## 3. 三大加分手筋（已内建进代码与文档）

这三点是把"完成度"拉到"获奖级"的杠杆。每一条都已经落到具体实现。

### 手筋一：显式 Agency（让自主性"可见"）
- 仪表盘的签名元素是 **Decision Tape（决策带）**：每一行是一次自主裁决，点开即见完整推理链 `[meta] [fraud] [payee] [wallet] [budget] [settle] [review]`。
- 关键差异：我们在**比别人更难的 case** 上展示推理，并且**主动暴露不确定性**——低置信度的 case 会被路由到托管并标 `needsReview`。一个诚实的 Agent 会说"我不确定"，Cadence 把钱托管起来并明说。
- 落地文件：`src/core/reasoner.js`（每个分支都 append 到 `reasoning[]`）、`public/app.js`（可展开 trace 渲染）。

### 手筋二：3 秒信任（让评委一点就懂）
- **零安装、零密钥、零钱包**即可跑：`npm start` → 打开 localhost → 点 "Run simulation"。
- 实时仪表盘在几秒内就把"钱真的流向了音乐人"演示出来：已付 / 托管 / 拒付三色账本 + sparkline + Top earners。
- MOCK 模式不是假的：它跑**完整流水线和真实账本数学**，只把最后一步的链上交易换成确定性合成哈希。所以 `npm run verify` 能在**完全离线**下断言端到端正确。
- 落地文件：`server.mjs`（零依赖 http）、`public/*`（无框架、无构建、无浏览器存储）。

### 手筋三：可移植结算核心（"一次构建，三处分发"）
- 结算核心**不知道"歌"是什么**：它吃一个标准化事件，吐一个决策。唯一与音乐耦合的文件是 `musicbrainz.js`。
- 换掉它和来源适配器，同一引擎就能给任何"可归属"的东西结算：**Owncast 直播**（按分钟付主播与嘉宾）、**Mastodon/ActivityPub 转发**（付原作者）。两个适配器已作为**带类型的桩**存在（`src/core/adapters/`），实现同一 `normalize(raw) → CadenceEvent` 契约。
- 落地文件：`src/core/adapters/{subsonic,owncast,mastodon}.js`、`docs/architecture.md`。

---

## 4. 系统架构（六步流水线 + 可移植核心）

每次播放都走 `src/core/index.js` 的 `processPlay(event)`，由六个独立可测的小步骤组成，产出一个带完整审计轨迹的 `Decision`。

```
adapters →  resolveMetadata → assessFraud → resolvePayees → mapWallets → allocate → settle  → Decision
            这是什么          这次真不真     谁/怎么分        付到哪      付多少      移动USDC
                              ╰ skip/wash/bot → 拒付                     ╰ MOCK 合成哈希 / LIVE EIP-3009 批量
```

1. **resolveMetadata**（`musicbrainz.js`）：把媒体 id / 松散标题解析成 `{title, artist, credits[], releaseType, isLive, isRemix, …}`。离线用内置缓存，可选切到 MusicBrainz 实时 API；含 token 重叠模糊匹配（解决 typo case）。**← 唯一与音乐耦合处。**
2. **assessFraud**（`antifraud.js`）：返回 `ok | skip | wash | bot` + 风险分 + 可读证据。<30s 为 skip；一小时 >20 次为洗单；replay-bot 客户端指纹为机器人。被拒的播放会被记录但不付钱。
3. **resolvePayees**（`reasoner.js`）：**大脑**。给出付款人集合、份额与置信度。确定性分支处理"有正确答案"的 case（PD 古典→演奏者；Various Artists→还原真实艺人；remix→拆血统；未知→托管 + 标复核）。有 key 时可把"真正模糊"的 case 升级给模型（强制严格 JSON），任何错误都回退确定性路径，所以 Agent 永不卡死。
4. **mapWallets**（`registry.js`）：从付款人注册表给每个 payee 附钱包，并算稳定的 ERC-8004 `identityHash = sha256(mbid | name)`。无钱包者标 `routedToEscrow`。
5. **allocate**（`budget.js`）：从**这个听众自己的月度池**里取一笔微额，按剩余额度封顶。这是核心经济学：你为自己的收听付费，且只分给你真正听过的艺人。
6. **settle**（`settlement.js`）：**可移植结算核心**。MOCK 出确定性合成 tx 哈希并更新内存账本（含托管）；LIVE 给每个被付艺人签 EIP-3009 `TransferWithAuthorization`，并把整批提交到 Arc 上的 Circle Gateway，被托管份额记账待领。两种模式函数签名与产出的 `Decision` **完全一致**，只有最后一步不同。

`verdict` 仅在**所有** payee 都被托管时才是 `escrowed`；混合批次是 `settled` 并注明部分被托管。

数据模型（Decision）、各文件职责、为什么"可移植"是真命题——详见 `docs/architecture.md`。

---

## 5. 货币模型与参数

- 每听众月度预算 `CADENCE_MONTHLY_BUDGET_USD` 默认 **$5.00**。
- 每次有效播放 `CADENCE_PER_PLAY_USD` 默认 **$0.002**，并被该听众剩余额度封顶。
- 跳过下限 `CADENCE_MIN_PLAY_SECONDS` = **30s**。
- 角色权重（归一化到 1）：performer **.50**、writer **.30**（在多个词曲作者间再分）、producer **.12**、featured **.08**。
- 反作弊阈值：每曲每小时最多 **20** 次（超出即洗单，风险 +0.5）；最小间隔 **5s**（更短为机关枪式）；环形窗口 **3600s**。

全部可由环境变量覆盖，默认值已写进 `.env.example`，无 `.env` 也能直接跑。

---

## 6. 九个硬 case（大脑的验收标准）

这九个在 `scripts/verify-core.mjs` 里是**断言**，要么过，要么构建就是错的。

1. Glenn Gould 演奏巴赫《哥德堡变奏曲》→ 作曲属公有领域 → **100% 付演奏者** → settled。
2. Radiohead 现场盗录 → 低置信 + 无钱包 → **托管** + needsReview。
3. "Various Artists" 合辑曲 → 还原 Dua Lipa + 词曲 + 制作人 → **settled**，没有"Various Artists"这个付款人。
4. 某小厂牌曲的 Remix → 50/50 拆血统；remixer 被付，原作一侧**部分托管** → verdict **settled**。
5. `"beatles hey jude"`（typo、无 id）→ 模糊匹配到 The Beatles → **settled**。
6. 某用户一小时内重播 24 次 → **洗单**，放过早期真实播放后**拒付**多余部分。
7. 12 秒播放 → **拒付**（skip）。
8. 长尾艺人有身份但无钱包 → **托管**全部 payee + ERC-8004 身份哈希。
9. 干净的四词条曲 → 角色加权**四方分账** → settled。

> 调试经验已沉淀：曾因"同名多角色 payee"用 name 做键回填金额导致金额错配，已改为**按下标位置**回填（`settle()` 本就 1:1 同序生成 splits）。这类教训写进注释，避免回归。

---

## 7. Circle 工具栈使用映射（20% 维度）

深度使用，不是贴标签：
- **USDC on Arc**：结算资产，纳米支付级金额。
- **Circle Gateway / 纳米支付**：LIVE 下把被付艺人打包成一批 EIP-3009 `TransferWithAuthorization` 提交 Gateway。（`src/core/settlement.js` 的 `settleReal()`）
- **Agent / 可编程钱包**：结算 operator 代 Agent 签名提交；艺人从注册表用自己的钱包收款。
- **x402**：`/api/royalty-data` 与 `/api/claim` 实现 HTTP 402 握手——先回带 `accepts[]` 的报价挑战，凭 `X-PAYMENT` 放行。（`server.mjs`）
- **ERC-8004 身份**：无钱包艺人的托管按稳定身份哈希记账；`CadenceSplitter.claim()` 仅放行给"按 ERC-8004 注册表控制该身份的地址"。（`contracts/CadenceSplitter.sol`）

LIVE 全链路已接好且由环境变量门控。仓库默认 MOCK 让评委即点即用；按 `.env.example` 填好 key 并设 `CADENCE_SETTLEMENT_MODE=real` 即可在测试网结算（步骤见 PREREQUISITES.md）。

---

## 8. 技术选型理由

- **零依赖 + 双模（MOCK/LIVE）**：异步评审奖励"第一次点击就坚不可摧"。零安装、零密钥即可完整演示；`viem` 仅作为 optionalDependency 在 LIVE 动态导入。
- **纯 ESM JS 核心 + 内置 http 服务 + 无框架前端**：没有构建步骤、没有 node_modules 也能 `node server.mjs` 起来。降低评委环境出错概率。
- **前端无浏览器存储**：所有状态在内存与服务端，避免 sandbox 限制。
- **可移植核心**：把"音乐"隔离到单一文件，使"一次构建三处分发"成为可验证的真命题，而非口号。

---

## 9. 8 天冲刺计划（窗口 6/15–6/29）

> 今天约 6/21，约剩 8 天。核心已跑通（`npm run verify` 26/26）。

- **D1（今天）**：完成全部剩余文件（server、仪表盘、脚本、合约、文档三件套）；本地起服务 curl 全端点；导入图查漏 ≥2 次；打包 zip。**← 当前**
- **D2**：建仓库推 GitHub；在干净环境（仅 Node 18+）复测 `npm start` / `npm run verify` / `npm run simulate`；修一切首次点击问题。
- **D3**：准备 Arc 测试网 LIVE：申请测试网 USDC、部署 `CadenceSplitter`、填 `.env`、跑一次真实结算并截图/录屏。
- **D4**：把真实测试网交易接进仪表盘展示（LIVE 徽章 + 真实 txHash 链接）。
- **D5**：录 <3 分钟视频（脚本见 §11）；打磨 README 首屏与截图。
- **D6**：第一次正式提交（占位 + 现有完成度）。
- **D7**：迭代——按自查清单补齐细节，扩 seed 真实播放量，强化 Top earners/escrow 演示。
- **D8**：终版提交；最后一次全链路冒烟；提交前再看一眼"自查清单"。

---

## 10. 提交清单（Definition of Done）

- [ ] 公开 **GitHub 仓库**，README 首屏 3 秒讲清"是什么 + 为何不同 + 怎么跑"。
- [ ] 干净环境 `npm start` 一次成功；`npm run verify` 全绿；`npm run simulate` 有动画。
- [ ] **<3 分钟视频**：先放产品（点 Run simulation 展示决策带），再点开一条推理链，再讲货币模型与 Circle 用量，最后讲可移植性。
- [ ] 赛程窗口内**真实测试网 USDC 结算**记录（截图/交易哈希/录屏）。
- [ ] Circle 五件套在代码里可指认（Gateway / 钱包 / x402 / ERC-8004 / USDC）。
- [ ] 三份文档齐全：README（英）、DEVELOPMENT（中）、PREREQUISITES（中），且同时存在于仓库内。
- [ ] 合约可读可审计（solc 0.8.24+ 可编译），并说明非演示必需。
- [ ] 找一找彩蛋（$2k）。

---

## 11. 视频脚本（<3 分钟）

1. **0:00–0:20 钩子**：一句话问题——"你的订阅费被倒进一个全球大池子，大部分流向头部 1%。" 切到 Cadence 首屏。
2. **0:20–1:10 现场**：点 "Run simulation"，决策带实时刷出；强调三色账本同时在涨（已付/托管/拒付）。
3. **1:10–1:50 展示自主性**：点开一条难 case（如 Various Artists 或 remix），逐行读推理链；再点开一条被托管 + needsReview 的，强调"它会说我不确定"。
4. **1:50–2:20 货币与 Circle**：讲"你只为自己听的人付费"，指出 USDC on Arc + Gateway 批量 + x402 + ERC-8004 托管领取。
5. **2:20–2:50 可移植**：一句"同一个结算核心，换个适配器就能付直播主播、付转发原作者——一次构建，三处分发。"
6. **2:50–3:00 收尾**：repo 地址 + 一行价值主张。

---

## 12. 从 MOCK 切到 LIVE（速查）

1. 按 `.env.example` 复制为 `.env`，设 `CADENCE_SETTLEMENT_MODE=real`。
2. 填 `CADENCE_RPC_URL`、`CADENCE_CHAIN_ID`、`CADENCE_USDC_ADDRESS`、`CADENCE_OPERATOR_PRIVATE_KEY`、`CIRCLE_API_KEY`（必要时 `CIRCLE_GATEWAY_URL`）。
3. 部署 `contracts/CadenceSplitter.sol`，设 `CADENCE_SPLITTER_ADDRESS`，向合约注资测试网 USDC。
4. `npm i`（让 optional 的 `viem` 落地），`npm start`，跑一次结算，核对链上交易与账本一致。

> 详细准备（钱包、领水、key、账户）见 **PREREQUISITES.md**。
