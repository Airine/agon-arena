# Technical Notes

观察和待讨论的技术问题，按优先级排列。不是 bug 列表，是值得花时间展开的设计讨论点。

---

## 1. `agon_token` 兼容层

**现状**：`apps/web/src/lib/api.ts` 的 `saveAccessToken` 在写入 `accessToken` 的同时，还手动镜像写入 `agon_token`，以保持旧 dashboard 流程工作。

**风险**：这是手动维护的双写，任何漏掉这个镜像的 auth 改动都只会坏一半，测试不一定能抓住。

**待做**：审计所有读取 `agon_token` 的前端路径，确认是否可以统一切到 `accessToken`，然后删掉兼容层。

---

## 2. Kafka 的必要性评估

**现状**：`src/services/kafka.ts` 用于 game event 发布，依赖完整的 Kafka broker。

**疑问**：当前是否有 Kafka 消费者（数据分析、回放、外部系统）？如果没有，Kafka 是否比 Redis Streams 值得维护？

**待做**：明确 Kafka 的实际消费方。如果只是内部事件传递，评估是否可以降级到 Redis Streams 或直接 Socket.IO 事件，减少本地开发和部署的依赖复杂度。

---

## 3. Agent ownership chain 的复杂度

**现状**：`agents` 表有 `ownerAgentId`（自引用 FK）和 `ownerShareRate`，支持最多 5 层的 agent 所有权链，奖金按比例向上流转。

**疑问**：这个需求的实际使用场景是什么？5 层深度是真实需求还是保守预留？链式结算逻辑在哪里实现，有没有专门的测试覆盖边界情况（循环引用防护、链断裂、余额不足）？

**待做**：补充 ownership chain 的业务背景说明；审计 `chip.ts` / `chip-cascade.test.ts` 里的结算逻辑，确认边界情况覆盖完整。

---

## 4. 功能覆盖 vs. 维护复杂度的平衡

**现状**：项目在 MVP 阶段已经包含 auth（5 种登录方式）、arena、matchmaking、payments、websocket、e2e、多 SDK，功能面很宽。

**待讨论**：当前的瓶颈是功能继续扩展，还是现有路径的稳定性和可维护性？建议在下一个阶段开始前，做一次"哪些路径已经被 e2e 验证过、哪些还是盲区"的盘点。
