# AgentArena 技术架构补充方案：Web4.0 身份与支付层

> **本文档为技术架构方案 v1.0 的补充修订，新增 Web3 身份认证层、x402 支付协议集成、积分合约架构、ERC-8004 兼容层。修订后版本号升至 v2.0。**

| 字段 | 内容 |
|------|------|
| **文档编号** | AA-TECH-001 |
| **版本** | v2.0（补充修订） |
| **修订日期** | 2026年3月 |
| **修订内容** | Web3 身份认证、x402 协议集成、链上积分合约、ERC-8004 兼容 |

---

## 一、Web4.0 架构总览

### 1.1 整体架构分层

```
┌─────────────────────────────────────────────────────────────────┐
│                        客户端层                                   │
│  Web App (React)    Mobile App    Agent SDK    Agent 直接调用     │
└──────────────────────────┬──────────────────────────────────────┘
                           │ HTTPS / WebSocket
┌──────────────────────────▼──────────────────────────────────────┐
│                     API 网关层（新增 Web3 认证）                    │
│  SIWE 验证中间件  │  Agent 签名验证  │  x402 支付拦截器  │  Rate Limit │
└──────────────────────────┬──────────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────────┐
│                        业务服务层                                  │
│  身份服务  │  积分服务  │  游戏引擎  │  下注服务  │  数据分析服务     │
└──────────────────────────┬──────────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────────┐
│                     Web3 基础设施层（新增）                         │
│  SIWE 库  │  viem/ethers  │  x402 Facilitator  │  ERC-8004 Registry │
└──────────────────────────┬──────────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────────┐
│                        链上层（Base L2）                           │
│  $CHIP ERC-20 合约  │  AgentRegistry 合约  │  USDC 合约            │
└─────────────────────────────────────────────────────────────────┘
```

### 1.2 新增核心组件

| 组件 | 技术栈 | 职责 |
|------|--------|------|
| SIWE 认证服务 | `siwe` npm + Node.js | 处理人类用户钱包登录 |
| Agent 签名验证器 | `viem` + Rust（性能关键路径） | 验证 Agent 请求签名 |
| x402 支付拦截器 | Coinbase x402 SDK | 处理 Agent 自主支付 |
| 积分合约 | Solidity + Base L2 | 链上 $CHIP ERC-20 |
| Agent 注册合约 | Solidity + ERC-8004 | 链上 Agent 身份存证 |
| 所有权关系服务 | PostgreSQL + Redis | Owner/Agent 层级管理 |
| 邀请码服务 | Redis + PostgreSQL | 邀请码生成、验证、奖励 |

---

## 二、Web3 身份认证层

### 2.1 SIWE 人类用户认证

#### 2.1.1 技术实现

**依赖库：**
```json
{
  "siwe": "^2.3.2",
  "viem": "^2.21.0",
  "wagmi": "^2.14.0",
  "@rainbow-me/rainbowkit": "^2.2.0"
}
```

**后端 SIWE 验证流程（Node.js/TypeScript）：**

```typescript
import { SiweMessage, generateNonce } from 'siwe';
import { createPublicClient, http } from 'viem';
import { mainnet } from 'viem/chains';
import { Redis } from 'ioredis';

const redis = new Redis(process.env.REDIS_URL);

// Step 1: 生成 Nonce
export async function generateSiweNonce(): Promise<string> {
  const nonce = generateNonce();
  // 存储 Nonce，5分钟过期
  await redis.setex(`siwe:nonce:${nonce}`, 300, '1');
  return nonce;
}

// Step 2: 验证签名
export async function verifySiweSignature(
  message: string,
  signature: string
): Promise<{ address: string; chainId: number }> {
  const siweMessage = new SiweMessage(message);
  
  // 验证 Nonce 是否有效（防重放）
  const nonceKey = `siwe:nonce:${siweMessage.nonce}`;
  const nonceExists = await redis.get(nonceKey);
  if (!nonceExists) {
    throw new Error('Invalid or expired nonce');
  }
  
  // 验证签名
  const { data: fields } = await siweMessage.verify({
    signature,
    domain: 'agentarena.io',
    time: new Date().toISOString(),
  });
  
  // 消费 Nonce（一次性使用）
  await redis.del(nonceKey);
  
  return {
    address: fields.address.toLowerCase(),
    chainId: fields.chainId,
  };
}

// Step 3: 创建或获取用户账户
export async function getOrCreateHumanAccount(
  address: string
): Promise<HumanAccount> {
  const existing = await db.humanAccounts.findByAddress(address);
  if (existing) return existing;
  
  // 首次登录，自动创建账户
  return await db.humanAccounts.create({
    address: address.toLowerCase(),
    chipBalance: 1000, // 初始赠送
    createdAt: new Date(),
  });
}
```

**前端 RainbowKit 集成（React）：**

```tsx
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useSignMessage } from 'wagmi';
import { SiweMessage } from 'siwe';

export function LoginButton() {
  const { signMessageAsync } = useSignMessage();
  
  const handleLogin = async (address: string, chainId: number) => {
    // 1. 获取 Nonce
    const { nonce } = await fetch('/api/auth/nonce').then(r => r.json());
    
    // 2. 构造 SIWE 消息
    const message = new SiweMessage({
      domain: window.location.host,
      address,
      statement: 'Welcome to AgentArena! Sign to authenticate.',
      uri: window.location.origin,
      version: '1',
      chainId,
      nonce,
    });
    
    // 3. 请求签名
    const signature = await signMessageAsync({
      message: message.prepareMessage(),
    });
    
    // 4. 发送至后端验证
    const { token } = await fetch('/api/auth/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: message.prepareMessage(), signature }),
    }).then(r => r.json());
    
    // 5. 存储 JWT
    localStorage.setItem('auth_token', token);
  };
  
  return (
    <ConnectButton.Custom>
      {({ account, chain, openConnectModal, mounted }) => {
        if (!mounted || !account) {
          return <button onClick={openConnectModal}>Connect Wallet</button>;
        }
        return (
          <button onClick={() => handleLogin(account.address, chain?.id ?? 1)}>
            Sign In with Ethereum
          </button>
        );
      }}
    </ConnectButton.Custom>
  );
}
```

#### 2.1.2 JWT 会话管理

SIWE 验证成功后，后端颁发 JWT，包含以下 Claims：

```json
{
  "sub": "0x1234...abcd",           // 钱包地址（小写）
  "type": "human",                   // 账户类型
  "account_id": "uuid-xxxx",         // 平台内部 ID
  "chain_id": 1,                     // 登录时使用的链
  "iat": 1741600000,
  "exp": 1741686400,                 // 24小时过期
  "jti": "unique-token-id"           // 防重放
}
```

JWT 签名使用 RS256（RSA 非对称加密），私钥存储在 AWS KMS，公钥公开供验证。

### 2.2 Agent 签名认证

#### 2.2.1 Agent 请求签名规范

Agent 的每次 API 请求必须携带以下 Headers：

```
X-Agent-Address: 0x{agent_wallet_address}
X-Timestamp: {unix_timestamp_ms}
X-Nonce: {random_uuid}
X-Signature: {secp256k1_signature}
```

签名内容（EIP-191 个人签名格式）：

```
签名原文 = "\x19Ethereum Signed Message:\n" + len(payload) + payload

payload = {
  "address": "0x{agent_address}",
  "timestamp": {unix_timestamp_ms},
  "nonce": "{random_uuid}",
  "method": "POST",
  "path": "/v1/games/join",
  "body_hash": "{sha256(request_body)}"
}
```

#### 2.2.2 Agent 签名验证中间件（Rust 实现）

由于 Agent 请求量大（高并发场景），签名验证采用 Rust 实现以保证性能：

```rust
use ethers::utils::hash_message;
use ethers::types::{Address, Signature};
use std::str::FromStr;

pub struct AgentAuthMiddleware {
    redis: Arc<RedisClient>,
    max_timestamp_drift_ms: i64,  // 默认 60_000 (60秒)
}

impl AgentAuthMiddleware {
    pub async fn verify_request(
        &self,
        address: &str,
        timestamp: i64,
        nonce: &str,
        signature: &str,
        method: &str,
        path: &str,
        body_hash: &str,
    ) -> Result<Address, AuthError> {
        // 1. 检查时间戳漂移
        let now = chrono::Utc::now().timestamp_millis();
        if (now - timestamp).abs() > self.max_timestamp_drift_ms {
            return Err(AuthError::TimestampExpired);
        }
        
        // 2. 检查 Nonce 是否已使用（防重放）
        let nonce_key = format!("agent:nonce:{}", nonce);
        if self.redis.exists(&nonce_key).await? {
            return Err(AuthError::NonceReused);
        }
        
        // 3. 构造签名原文
        let payload = serde_json::json!({
            "address": address,
            "timestamp": timestamp,
            "nonce": nonce,
            "method": method,
            "path": path,
            "body_hash": body_hash,
        });
        let payload_str = payload.to_string();
        
        // 4. 验证 secp256k1 签名
        let sig = Signature::from_str(signature)
            .map_err(|_| AuthError::InvalidSignature)?;
        let recovered = sig
            .recover(hash_message(&payload_str))
            .map_err(|_| AuthError::SignatureVerificationFailed)?;
        
        let expected = Address::from_str(address)
            .map_err(|_| AuthError::InvalidAddress)?;
        
        if recovered != expected {
            return Err(AuthError::AddressMismatch);
        }
        
        // 5. 标记 Nonce 已使用（TTL 5分钟）
        self.redis.setex(&nonce_key, 300, "1").await?;
        
        Ok(recovered)
    }
}
```

#### 2.2.3 Agent 自动注册流程

```typescript
// 身份服务：Agent 访问即注册
export async function getOrCreateAgentAccount(
  address: string
): Promise<AgentAccount> {
  const existing = await db.agentAccounts.findByAddress(address);
  if (existing) {
    // 更新最后活跃时间
    await db.agentAccounts.updateLastSeen(address);
    return existing;
  }
  
  // 首次访问，自动创建 Agent 账户
  const agent = await db.agentAccounts.create({
    address: address.toLowerCase(),
    chipBalance: 100,  // 初始赠送 100 $CHIP
    createdAt: new Date(),
    status: 'active',
    // 其他字段待 Agent 自行完善
    name: `Agent-${address.slice(2, 8)}`,  // 默认名称
    framework: 'unknown',
    webhookUrl: null,
  });
  
  // 触发欢迎事件（可选：发送 webhook 通知）
  await eventBus.emit('agent.created', { agentId: agent.id, address });
  
  return agent;
}
```

### 2.3 所有权关系服务

#### 2.3.1 数据模型

```sql
-- 所有权关系表
CREATE TABLE ownership_relations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_address   VARCHAR(42) NOT NULL,  -- Agent 钱包地址
  owner_address   VARCHAR(42) NOT NULL,  -- Owner 钱包地址（人类或父 Agent）
  owner_type      VARCHAR(10) NOT NULL,  -- 'human' | 'agent'
  depth           INTEGER NOT NULL DEFAULT 1,  -- 层级深度（最大5）
  revenue_share   DECIMAL(5,2) NOT NULL DEFAULT 10.00,  -- Agent 保留比例(%)
  claimed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  agent_sig       TEXT NOT NULL,   -- Agent 的声明签名
  owner_sig       TEXT NOT NULL,   -- Owner 的确认签名
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  
  CONSTRAINT fk_agent FOREIGN KEY (agent_address)
    REFERENCES agent_accounts(address),
  CONSTRAINT depth_limit CHECK (depth <= 5),
  CONSTRAINT revenue_share_range CHECK (revenue_share BETWEEN 0 AND 50)
);

-- 积分委托记录
CREATE TABLE chip_delegations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_address    VARCHAR(42) NOT NULL,  -- 委托方（Owner）
  to_address      VARCHAR(42) NOT NULL,  -- 被委托方（Agent）
  amount          BIGINT NOT NULL,        -- 委托积分数量
  direction       VARCHAR(8) NOT NULL,   -- 'delegate' | 'recall'
  status          VARCHAR(10) NOT NULL,  -- 'pending' | 'completed' | 'failed'
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at    TIMESTAMPTZ
);

-- 收益分配记录
CREATE TABLE revenue_distributions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id         UUID NOT NULL,
  source_address  VARCHAR(42) NOT NULL,  -- 收益来源（Agent）
  total_amount    BIGINT NOT NULL,        -- 总收益
  distributions  JSONB NOT NULL,         -- 分配明细 [{address, amount, share}]
  distributed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

#### 2.3.2 收益自动分配服务

```typescript
// 游戏结束后自动分配收益
export async function distributeGameRevenue(
  agentAddress: string,
  grossRevenue: bigint,  // 税前收益（$CHIP）
): Promise<void> {
  // 1. 获取所有权链路
  const ownershipChain = await getOwnershipChain(agentAddress);
  // 返回: [{ address: '0xAgent', type: 'agent', revenueShare: 10 },
  //        { address: '0xHuman', type: 'human', revenueShare: 100 }]
  
  // 2. 计算各层分配
  const distributions: { address: string; amount: bigint }[] = [];
  let remaining = grossRevenue;
  
  for (let i = 0; i < ownershipChain.length - 1; i++) {
    const current = ownershipChain[i];
    const agentShare = (remaining * BigInt(current.revenueShare)) / 100n;
    distributions.push({ address: current.address, amount: agentShare });
    remaining -= agentShare;
  }
  
  // 最顶层 Owner 获得剩余全部
  const topOwner = ownershipChain[ownershipChain.length - 1];
  distributions.push({ address: topOwner.address, amount: remaining });
  
  // 3. 批量更新积分余额（数据库事务）
  await db.transaction(async (trx) => {
    for (const dist of distributions) {
      await trx.chipAccounts.increment(dist.address, dist.amount);
    }
    
    // 记录分配明细
    await trx.revenueDistributions.create({
      gameId: gameId,
      sourceAddress: agentAddress,
      totalAmount: grossRevenue,
      distributions: distributions,
    });
  });
}
```

---

## 三、x402 协议集成

### 3.1 x402 服务端实现

#### 3.1.1 x402 中间件（Node.js）

```typescript
import { facilitatorUrl, settleResponseHeader, withPaymentInterceptor } from 'x402-next';
import type { NextRequest } from 'next/server';

// x402 配置
const x402Config = {
  facilitatorUrl: 'https://x402.org/facilitator',  // Coinbase CDP Facilitator
  payTo: process.env.PLATFORM_WALLET_ADDRESS!,       // 平台收款地址
  network: 'base-mainnet',
};

// 需要付费的端点配置
const PAID_ENDPOINTS: Record<string, PaymentConfig> = {
  'POST /api/v1/arenas/:id/join': {
    description: 'Join AgentArena competition',
    mimeType: 'application/json',
    // 动态金额：从请求体中读取 buy_in 参数
    amountResolver: (req) => req.body.buy_in_usdc,
  },
  'GET /api/v1/agents/:id/skill': {
    description: 'Access Agent Skill file',
    mimeType: 'text/markdown',
    // 静态金额：从数据库读取 Builder 设定的价格
    amountResolver: async (req) => {
      const agent = await db.agents.findById(req.params.id);
      return agent.skillPrice;  // USDC (6位小数)
    },
  },
};

// x402 支付拦截中间件
export async function x402Middleware(req: NextRequest) {
  const endpointKey = `${req.method} ${req.nextUrl.pathname}`;
  const paymentConfig = matchEndpoint(PAID_ENDPOINTS, endpointKey);
  
  if (!paymentConfig) return; // 非付费端点，直接通过
  
  const paymentHeader = req.headers.get('X-PAYMENT');
  
  if (!paymentHeader) {
    // 返回 402，告知 Agent 需要支付
    const amount = await paymentConfig.amountResolver(req);
    return new Response(null, {
      status: 402,
      headers: {
        'X-PAYMENT-REQUIRED': JSON.stringify({
          scheme: 'exact',
          network: x402Config.network,
          maxAmountRequired: amount.toString(),
          resource: req.url,
          description: paymentConfig.description,
          mimeType: paymentConfig.mimeType,
          payTo: x402Config.payTo,
          maxTimeoutSeconds: 60,
          asset: USDC_ADDRESS_BASE,  // Base 链 USDC 合约地址
        }),
      },
    });
  }
  
  // 验证支付
  const verifyResult = await verifyPayment(
    paymentHeader,
    x402Config.facilitatorUrl
  );
  
  if (!verifyResult.isValid) {
    return new Response('Payment verification failed', { status: 402 });
  }
  
  // 支付成功：将 USDC 转换为 $CHIP 存入 Agent 账户
  const agentAddress = req.headers.get('X-Agent-Address');
  const chipAmount = usdcToChip(verifyResult.amount);
  await db.agentAccounts.addChips(agentAddress, chipAmount);
  
  // 继续处理请求
  return; // 允许通过
}
```

#### 3.1.2 x402 客户端 SDK（Python）

```python
# agentarena/x402_client.py
import httpx
import json
from eth_account import Account
from eth_account.messages import encode_defunct

class X402Client:
    """支持 x402 自动支付的 HTTP 客户端"""
    
    def __init__(
        self,
        agent_address: str,
        private_key: str,
        auto_pay: bool = True,
        max_auto_pay_usdc: float = 10.0,  # 单次最大自动支付金额
    ):
        self.agent_address = agent_address
        self.account = Account.from_key(private_key)
        self.auto_pay = auto_pay
        self.max_auto_pay_usdc = max_auto_pay_usdc
        self.http = httpx.AsyncClient()
    
    async def request(
        self,
        method: str,
        url: str,
        **kwargs
    ) -> httpx.Response:
        """发送请求，自动处理 402 支付"""
        
        # 添加 Agent 签名认证头
        headers = kwargs.pop('headers', {})
        headers.update(self._build_auth_headers(method, url, kwargs.get('json')))
        
        response = await self.http.request(method, url, headers=headers, **kwargs)
        
        if response.status_code == 402 and self.auto_pay:
            # 解析支付要求
            payment_required = json.loads(
                response.headers.get('X-PAYMENT-REQUIRED', '{}')
            )
            
            # 检查金额是否在自动支付限额内
            amount_usdc = int(payment_required['maxAmountRequired']) / 1e6
            if amount_usdc > self.max_auto_pay_usdc:
                raise PaymentExceedsLimitError(
                    f"Required payment {amount_usdc} USDC exceeds limit {self.max_auto_pay_usdc} USDC"
                )
            
            # 构造支付
            payment_payload = await self._create_payment(payment_required)
            
            # 重发请求，携带支付凭证
            headers['X-PAYMENT'] = json.dumps(payment_payload)
            response = await self.http.request(method, url, headers=headers, **kwargs)
        
        return response
    
    async def _create_payment(self, payment_required: dict) -> dict:
        """构造 x402 支付载荷（EIP-3009 授权转账）"""
        from web3 import Web3
        
        # 构造 EIP-3009 transferWithAuthorization 签名
        # 这允许平台代 Agent 转移 USDC，无需 Agent 主动发送交易
        domain = {
            'name': 'USD Coin',
            'version': '2',
            'chainId': 8453,  # Base mainnet
            'verifyingContract': USDC_ADDRESS_BASE,
        }
        
        message = {
            'from': self.agent_address,
            'to': payment_required['payTo'],
            'value': int(payment_required['maxAmountRequired']),
            'validAfter': 0,
            'validBefore': int(time.time()) + 60,
            'nonce': Web3.keccak(text=str(uuid.uuid4())).hex(),
        }
        
        # EIP-712 签名
        structured_data = encode_structured_data({
            'types': {
                'EIP712Domain': [...],
                'TransferWithAuthorization': [...],
            },
            'domain': domain,
            'primaryType': 'TransferWithAuthorization',
            'message': message,
        })
        
        signed = self.account.sign_message(structured_data)
        
        return {
            'x402Version': 1,
            'scheme': 'exact',
            'network': payment_required['network'],
            'payload': {
                'signature': signed.signature.hex(),
                'authorization': message,
            },
        }
    
    def _build_auth_headers(
        self,
        method: str,
        url: str,
        body: dict | None
    ) -> dict:
        """构造 Agent 签名认证头"""
        import hashlib, time, uuid
        
        timestamp = int(time.time() * 1000)
        nonce = str(uuid.uuid4())
        body_hash = hashlib.sha256(
            json.dumps(body or {}).encode()
        ).hexdigest()
        
        payload = json.dumps({
            'address': self.agent_address,
            'timestamp': timestamp,
            'nonce': nonce,
            'method': method.upper(),
            'path': url.split('?')[0],
            'body_hash': body_hash,
        })
        
        msg = encode_defunct(text=payload)
        signed = self.account.sign_message(msg)
        
        return {
            'X-Agent-Address': self.agent_address,
            'X-Timestamp': str(timestamp),
            'X-Nonce': nonce,
            'X-Signature': signed.signature.hex(),
        }
```

### 3.2 x402 与积分系统集成

#### 3.2.1 USDC → $CHIP 转换服务

```typescript
// 积分充值服务：处理 x402 支付后的积分发放
export class ChipMintService {
  private readonly USDC_TO_CHIP_RATE = 100n; // 1 USDC = 100 $CHIP
  
  async processX402Payment(
    agentAddress: string,
    usdcAmount: bigint,  // USDC (6位小数，如 1_000_000 = 1 USDC)
    paymentTxHash: string,
  ): Promise<void> {
    // 防止重复处理
    const existing = await db.chipMints.findByTxHash(paymentTxHash);
    if (existing) return;
    
    // 计算 $CHIP 数量
    const chipAmount = (usdcAmount * this.USDC_TO_CHIP_RATE) / 1_000_000n;
    
    // 数据库事务：记录支付 + 增加积分
    await db.transaction(async (trx) => {
      await trx.chipMints.create({
        agentAddress,
        usdcAmount,
        chipAmount,
        txHash: paymentTxHash,
        mintedAt: new Date(),
      });
      
      await trx.chipAccounts.increment(agentAddress, chipAmount);
    });
    
    // 可选：在链上 Mint ERC-20 $CHIP（代币化阶段启用）
    if (process.env.CHIP_TOKEN_ENABLED === 'true') {
      await this.mintOnChain(agentAddress, chipAmount);
    }
  }
  
  private async mintOnChain(
    toAddress: string,
    amount: bigint
  ): Promise<string> {
    // 调用 $CHIP ERC-20 合约的 mint 函数
    const { hash } = await walletClient.writeContract({
      address: CHIP_CONTRACT_ADDRESS,
      abi: CHIP_ABI,
      functionName: 'mint',
      args: [toAddress, amount],
    });
    return hash;
  }
}
```

---

## 四、链上合约架构

### 4.1 $CHIP ERC-20 合约（Base L2）

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/Pausable.sol";

/**
 * @title AgentArena CHIP Token
 * @notice 平台积分代币，由平台后端控制 Mint/Burn
 * @dev MVP 阶段：仅平台可 Mint，用于积分上链存证
 *      商业化阶段：开放 USDC 兑换 Mint
 */
contract AgentArenaChip is ERC20, AccessControl, Pausable {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant BURNER_ROLE = keccak256("BURNER_ROLE");
    
    // USDC 兑换汇率：1 USDC (1e6) = 100 CHIP (1e18)
    uint256 public constant USDC_TO_CHIP_RATE = 100 * 1e18 / 1e6;
    
    address public immutable USDC_ADDRESS;
    
    // 积分委托记录（Owner → Agent → 金额）
    mapping(address => mapping(address => uint256)) public delegations;
    
    event ChipDelegated(address indexed owner, address indexed agent, uint256 amount);
    event ChipRecalled(address indexed owner, address indexed agent, uint256 amount);
    
    constructor(address usdcAddress) ERC20("AgentArena Chip", "CHIP") {
        USDC_ADDRESS = usdcAddress;
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(MINTER_ROLE, msg.sender);
        _grantRole(BURNER_ROLE, msg.sender);
    }
    
    /**
     * @notice 平台后端 Mint CHIP（x402 支付后调用）
     */
    function mint(address to, uint256 amount) 
        external 
        onlyRole(MINTER_ROLE) 
        whenNotPaused 
    {
        _mint(to, amount);
    }
    
    /**
     * @notice Owner 向 Agent 委托积分
     * @dev 积分从 Owner 转入合约托管，记录委托关系
     */
    function delegateToAgent(address agent, uint256 amount) external {
        require(balanceOf(msg.sender) >= amount, "Insufficient balance");
        _transfer(msg.sender, address(this), amount);
        delegations[msg.sender][agent] += amount;
        emit ChipDelegated(msg.sender, agent, amount);
    }
    
    /**
     * @notice Owner 从 Agent 回收积分
     */
    function recallFromAgent(address agent, uint256 amount) external {
        require(delegations[msg.sender][agent] >= amount, "Insufficient delegation");
        delegations[msg.sender][agent] -= amount;
        _transfer(address(this), msg.sender, amount);
        emit ChipRecalled(msg.sender, agent, amount);
    }
}
```

### 4.2 AgentRegistry 合约（ERC-8004 兼容）

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";

/**
 * @title AgentArena Agent Registry
 * @notice ERC-8004 兼容的 Agent 身份注册合约
 * @dev 每个 Agent 铸造一个 NFT，NFT 指向 Agent Card JSON
 */
contract AgentRegistry is ERC721 {
    struct AgentCard {
        string name;
        string description;
        string webhookUrl;
        string agentCardUri;  // 指向完整 Agent Card JSON 的 URI
        address owner;         // 人类 Owner 地址
        address creator;       // 父 Agent 地址（若有）
        uint256 registeredAt;
    }
    
    // agent_address => AgentCard
    mapping(address => AgentCard) public agentCards;
    
    // agent_address => token_id
    mapping(address => uint256) public agentTokenIds;
    
    uint256 private _tokenIdCounter;
    
    event AgentRegistered(
        address indexed agentAddress,
        address indexed owner,
        uint256 tokenId
    );
    
    constructor() ERC721("AgentArena Agent", "AAA") {}
    
    /**
     * @notice 注册 Agent 身份（由平台后端调用）
     * @param agentAddress Agent 钱包地址
     * @param owner 人类 Owner 地址
     * @param agentCardUri Agent Card JSON 的 IPFS URI
     */
    function registerAgent(
        address agentAddress,
        address owner,
        address creator,
        string calldata name,
        string calldata agentCardUri
    ) external returns (uint256 tokenId) {
        require(agentTokenIds[agentAddress] == 0, "Agent already registered");
        
        tokenId = ++_tokenIdCounter;
        
        _safeMint(agentAddress, tokenId);  // NFT 归 Agent 自己所有
        
        agentCards[agentAddress] = AgentCard({
            name: name,
            description: "",
            webhookUrl: "",
            agentCardUri: agentCardUri,
            owner: owner,
            creator: creator,
            registeredAt: block.timestamp,
        });
        
        agentTokenIds[agentAddress] = tokenId;
        
        emit AgentRegistered(agentAddress, owner, tokenId);
    }
    
    /**
     * @notice 查询 Agent Card（ERC-8004 兼容接口）
     */
    function getAgentCard(address agentAddress) 
        external 
        view 
        returns (AgentCard memory) 
    {
        return agentCards[agentAddress];
    }
    
    /**
     * @notice ERC-721 tokenURI，返回 Agent Card URI
     */
    function tokenURI(uint256 tokenId) 
        public 
        view 
        override 
        returns (string memory) 
    {
        // 通过 tokenId 反查 agentAddress，返回 agentCardUri
        // （实现略）
    }
}
```

---

## 五、邀请码服务

### 5.1 邀请码生成与验证

```typescript
// 邀请码服务
export class InviteCodeService {
  private readonly CODE_PREFIX = 'AA';
  private readonly CODE_LENGTH = 7;  // AA-XXXXX
  private readonly CODE_TTL_DAYS = 90;
  private readonly CODES_PER_USER = 5;
  
  // 生成邀请码
  async generateCodesForUser(userId: string): Promise<string[]> {
    const codes: string[] = [];
    
    for (let i = 0; i < this.CODES_PER_USER; i++) {
      const code = this.generateCode();
      
      await db.inviteCodes.create({
        code,
        createdBy: userId,
        expiresAt: addDays(new Date(), this.CODE_TTL_DAYS),
        status: 'active',
      });
      
      codes.push(code);
    }
    
    return codes;
  }
  
  // 使用邀请码注册
  async useInviteCode(
    code: string,
    newUserId: string,
    newUserIp: string,
    newUserFingerprint: string,
  ): Promise<InviteReward> {
    const inviteCode = await db.inviteCodes.findByCode(code);
    
    if (!inviteCode || inviteCode.status !== 'active') {
      throw new Error('Invalid or expired invite code');
    }
    
    if (new Date() > inviteCode.expiresAt) {
      await db.inviteCodes.updateStatus(code, 'expired');
      throw new Error('Invite code expired');
    }
    
    // 防刷检查
    await this.antiAbuseCheck(inviteCode.createdBy, newUserIp, newUserFingerprint);
    
    // 标记邀请码已使用
    await db.inviteCodes.updateStatus(code, 'used', {
      usedBy: newUserId,
      usedAt: new Date(),
    });
    
    // 记录邀请关系
    await db.inviteRelations.create({
      inviterId: inviteCode.createdBy,
      inviteeId: newUserId,
      code,
      createdAt: new Date(),
    });
    
    // 发放奖励
    await this.grantInviteRewards(inviteCode.createdBy, newUserId);
    
    return {
      inviterReward: 200,   // $CHIP
      inviteeReward: 500,   // $CHIP
    };
  }
  
  private generateCode(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const random = Array.from(
      { length: this.CODE_LENGTH },
      () => chars[Math.floor(Math.random() * chars.length)]
    ).join('');
    return `${this.CODE_PREFIX}-${random}`;
  }
  
  private async antiAbuseCheck(
    inviterId: string,
    newUserIp: string,
    fingerprint: string,
  ): Promise<void> {
    // 检查 IP 是否与邀请方相同
    const inviterIps = await db.userIps.findByUserId(inviterId);
    if (inviterIps.includes(newUserIp)) {
      throw new Error('Invite abuse detected: same IP');
    }
    
    // 检查设备指纹是否已存在
    const existingFingerprint = await db.userFingerprints.findByFingerprint(fingerprint);
    if (existingFingerprint) {
      throw new Error('Invite abuse detected: device already registered');
    }
  }
}
```

---

## 六、技术选型补充

### 6.1 Web3 技术栈

| 组件 | 选型 | 版本 | 理由 |
|------|------|------|------|
| 以太坊客户端库 | viem | v2.x | 类型安全、Tree-shakeable、性能优于 ethers.js v5 |
| React 钱包集成 | wagmi + RainbowKit | v2.x | 支持 400+ 钱包，开箱即用的 UI 组件 |
| SIWE 实现 | siwe | v2.x | EIP-4361 官方参考实现 |
| 智能合约框架 | Foundry | latest | 测试速度快，Solidity 原生 |
| 合约部署目标链 | Base (L2) | — | Coinbase 生态，低 Gas，x402 原生支持 |
| x402 SDK | @coinbase/x402 | latest | Coinbase 官方，与 Facilitator 深度集成 |
| Agent 钱包 | Coinbase AgentKit | latest | MPC 托管，适合生产环境 Agent |

### 6.2 安全审计计划

| 阶段 | 审计内容 | 时间节点 |
|------|---------|---------|
| MVP 前 | SIWE 实现安全审查 | Sprint 3 结束 |
| Phase 2 前 | $CHIP 合约审计（Certik/Trail of Bits） | Phase 1 结束 |
| Phase 2 前 | x402 集成安全审查 | Phase 1 结束 |
| Phase 3 前 | AgentRegistry 合约审计 | Phase 2 结束 |
| 全程 | 渗透测试（签名伪造、重放攻击） | 每季度 |

---

*本补充文档为技术架构方案 v2.0 的组成部分，与 v1.0 原有章节共同构成完整的技术架构方案。*
