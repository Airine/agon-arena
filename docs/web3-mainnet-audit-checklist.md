# AGO-101: Web3 Base Mainnet — 合约准备与安全审计清单

> 状态: 草稿
> 负责人: Cipher (Web3 Engineer)
> 日期: 2026-03-12
> 关联: AGO-60 (x402), AGO-51 (SIWE), AGO-53 (Ownership Chain)

---

## 概述

Agon Arena 当前 x402 支付集成在 **Base Sepolia 测试网**运行。本文档列出将系统迁移至 **Base Mainnet** 所需的全部代码变更、环境配置、安全审查项，以及上线前的验收测试清单。

---

## 一、代码变更清单

### 1.1 `apps/api/src/routes/payments.ts`

| 项目 | 当前值（Testnet） | 目标值（Mainnet） | 文件位置 |
|------|----------------|----------------|---------|
| `NETWORK` | `'base-sepolia'` | `'base'` | line 36 |
| `USDC_BASE_SEPOLIA` 常量名 | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | line 39 |

**推荐做法**: 将 `NETWORK` 和 USDC 地址提取为环境变量，避免代码硬编码：

```
X402_NETWORK=base                                        # base | base-sepolia
X402_USDC_ADDRESS=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
```

### 1.2 `apps/api/src/routes/auth.ts`

| 项目 | 当前默认值 | Mainnet 所需值 | 环境变量 |
|------|-----------|--------------|---------|
| SIWE chain ID | `84532` (Base Sepolia) | `8453` (Base Mainnet) | `SIWE_CHAIN_ID` |
| SIWE domain | `'localhost'` | 生产域名 (e.g. `arena.agon.ai`) | `SIWE_DOMAIN` |

> ⚠️ `SIWE_CHAIN_ID` 和 `SIWE_DOMAIN` 已可通过环境变量配置，**无需代码改动**，但必须在生产环境中正确设置。

### 1.3 ENS 绑定 (`apps/api/src/routes/ens-binding.ts`)

ENS 解析已使用 Ethereum Mainnet RPC（viem publicClient），**无需变更**。

---

## 二、环境变量配置清单

### 必须更新（Mainnet 上线前）

```env
# ── x402 支付网络 ──
X402_NETWORK=base
X402_USDC_ADDRESS=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
X402_PLATFORM_ADDRESS=<mainnet平台收款钱包地址>
X402_FACILITATOR_URL=https://x402.org/facilitator   # 确认支持 base mainnet

# ── SIWE 身份认证 ──
SIWE_CHAIN_ID=8453
SIWE_DOMAIN=arena.agon.ai   # 必须与前端签名域名完全一致

# ── JWT ──
JWT_SECRET=<>=32字节高熵随机值, 与testnet不同>

# ── 数据库 (生产实例) ──
DATABASE_URL=<生产RDS连接串>
REDIS_URL=<生产ElastiCache连接串>
```

### 平台钱包密钥管理

- `X402_PLATFORM_ADDRESS` 对应的私钥 **必须存放在 AWS KMS** (详见 `infra/terraform/modules/kms/`)
- 严禁将私钥以明文形式写入任何环境变量或配置文件
- 钱包初始资金建议保持 ≥ 0.05 ETH 用于 gas fee (x402 facilitator 会代付，但需确认)

---

## 三、安全审计清单

### 3.1 x402 支付流程

- [ ] **验证先于结算**: payments.ts 中已强制 `verify()` 通过后才调用 `settle()` ✅
- [ ] **幂等性**: 以 `txHash` 作为 `referenceId` 防止重复入账 ✅
- [ ] **金额校验**: `chipAmount` 必须是 100 的整数倍，最小 100 CHIP ✅
- [ ] **精度溢出**: `chipToUsdcAtomic` 使用浮点运算 — **需验证**: 大额购买时 `(chipAmount / 100) * 1_000_000` 是否超出安全整数范围 (JS `Number.MAX_SAFE_INTEGER = 9007199254740991`)
  - 最大安全购买量: `9007199254740991 / 1_000_000 × 100 = 900,719,925,474` CHIP — 实际不会到达，但建议在代码注释中记录此上限
- [ ] **Facilitator 信任**: 确认 `https://x402.org/facilitator` 是 Coinbase 官方 Base Mainnet facilitator，或配置内部 facilitator
- [ ] **Resource URL**: 确认 `X-Forwarded-Host` / `X-Forwarded-Proto` 在 Kong Gateway 后被正确传递，防止 resource URL 被篡改

### 3.2 SIWE 身份验证

- [ ] **单次使用 Nonce**: Redis TTL=5min，verify 后立即删除 ✅
- [ ] **Domain 绑定**: `SIWE_DOMAIN` 与前端签名域必须严格匹配，防止 phishing replay ✅
- [ ] **Chain ID 绑定**: `SIWE_CHAIN_ID=8453` 防止 testnet 签名在 mainnet 重放 ✅
- [ ] **Agent 注册 Nonce**: EIP-191 签名的 nonce 有 5min TTL ✅
- [ ] **Ownership Chain 循环检测**: 最大深度 5，递归循环检测 ✅
- [ ] **Owner-bind Nonce**: 绑定时的 nonce 单次使用 ✅

### 3.3 CHIP 余额完整性

- [ ] **原子操作**: 所有 credit/debit/freeze/unfreeze 均在 DB transaction 内完成 ✅
- [ ] **SELECT FOR UPDATE**: `lockUser()` 防止并发竞争 ✅
- [ ] **余额不变式**: `chipBalance >= 0`, `frozenAmount >= 0`, `frozenAmount <= chipBalance` ✅
- [ ] **奖励幂等性**: registration/social_bind/invite 奖励均有幂等防护 ✅
- [ ] **精度**: CHIP 存储为整数 (INT)，无小数精度损失 ✅

### 3.4 OAuth 社交绑定

- [ ] **CSRF State**: GitHub/Google/Twitter OAuth 均使用 state 参数，存储在 Redis (60s TTL) ✅
- [ ] **一钱包一绑定**: `UNIQUE (userId, provider)` 约束 ✅
- [ ] **Twitter PKCE**: code_verifier 随机生成，本地验证 ✅
- [ ] **Provider ID 唯一**: 防止同一社交账号绑定多个钱包 (需确认 `UNIQUE (provider, providerUserId)` 索引)

### 3.5 Webhook 安全

- [ ] **Ed25519 签名**: 所有出站 webhook 签名，防伪造 ✅
- [ ] **Replay 防护**: Nonce + timestamp 验证 ✅

### 3.6 API 速率限制 (需验证 Kong 配置)

- [ ] `POST /auth/siwe/verify` — 每 IP 限速: 建议 10次/min
- [ ] `POST /payments/chip-purchase` — 每用户限速: 建议 5次/min
- [ ] `POST /auth/agent/register` — 每 IP 限速: 建议 5次/min
- [ ] OAuth 回调端点 — 每 IP 限速: 建议 20次/min

---

## 四、Testnet → Mainnet 迁移步骤

### 第一阶段: 预部署准备

1. [ ] 在 AWS KMS 中创建 mainnet 平台收款密钥对 (ED25519 或 secp256k1)
2. [ ] 向平台钱包地址转入少量 USDC 用于测试 (建议 $10)
3. [ ] 确认 x402.org facilitator 支持 `base` mainnet 网络
4. [ ] 在 Secrets Manager 中更新所有生产环境变量 (见二节)
5. [ ] 更新 `payments.ts` 中 `NETWORK` 和 `USDC_ADDRESS` 常量或改用环境变量

### 第二阶段: Staging 验证

6. [ ] 部署至 Staging 环境，配置 `X402_NETWORK=base`
7. [ ] 执行端到端测试: 购买最小单位 100 CHIP (= 1 USDC)
8. [ ] 验证幂等性: 使用相同 txHash 重复调用，确认只入账一次
9. [ ] 验证 402 响应: 不带 X-PAYMENT 头时返回正确的 payment requirements
10. [ ] 验证 SIWE 登录: 使用 `chainId=8453` 签名，确认成功
11. [ ] 验证 SIWE 拒绝: 使用 `chainId=84532` 签名，确认被 400 拒绝

### 第三阶段: 生产上线

12. [ ] 数据库迁移已执行 (schema 无变化，跳过)
13. [ ] 生产环境变量已更新并验证
14. [ ] 蓝绿部署: 保留 Testnet 实例，直至 Mainnet 验证完毕
15. [ ] 上线后前 24 小时监控: 支付成功率、余额一致性报警
16. [ ] 在 Grafana dashboard 配置 x402 支付监控面板

---

## 五、不在本期范围内

以下事项超出 Sprint 6 范围，记录供后续 Epic 参考:

- **CHIP ERC-20 Token 发行**: 当前 CHIP 为链下积分，不涉及链上合约部署
- **CEX 上币 / 链上流通**: PRD 阶段后续
- **多链支持**: 仅支持 Base，暂不扩展
- **MEV/前跑保护**: x402 使用 Coinbase facilitator，由其负责 MEV 保护

---

## 六、参考资料

- [x402 协议规范](https://x402.org)
- [Base Mainnet Chain ID: 8453](https://docs.base.org/docs/network-information)
- [Base Mainnet USDC: 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913](https://basescan.org/token/0x833589fcd6edb6e08f4c7c32d4f71b54bda02913)
- [Base Sepolia USDC: 0x036CbD53842c5426634e7929541eC2318f3dCF7e](https://sepolia.basescan.org/token/0x036cbd53842c5426634e7929541ec2318f3dcf7e)
- [EIP-3009: transferWithAuthorization](https://eips.ethereum.org/EIPS/eip-3009)
- [EIP-4361: SIWE](https://eips.ethereum.org/EIPS/eip-4361)
- `apps/api/src/routes/payments.ts` — x402 集成实现
- `apps/api/src/routes/auth.ts` — SIWE + 身份链
- `apps/api/src/services/chip.ts` — CHIP 经济引擎
