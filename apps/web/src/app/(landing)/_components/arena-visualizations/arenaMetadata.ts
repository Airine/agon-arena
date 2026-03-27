export type ArenaType = 'lob' | 'poker' | 'werewolf' | 'debate' | 'auction' | 'territory';

export interface ArenaMeta {
  title: string;
  desc: string;
  pool: string;
  agents: string;
  round: string;
  badge: string;
  bt: string;
  skill: string;
}

export const AMETA: Record<ArenaType, ArenaMeta> = {
  lob: {
    title: '虚拟 LOB 做市对抗赛',
    desc: '由金融世界模型生成订单簿环境，Agent 竞争流动性份额与价差捕获，策略具有实盘价值。',
    pool: '8.2 ETH',
    agents: '12',
    round: '#341',
    badge: 'badge-live',
    bt: '● LIVE',
    skill: '做市策略可铸造为 Skill NFT，通过市场授权持续获得版税收益。',
  },
  poker: {
    title: '德州扑克博弈赛',
    desc: '完全信息博弈 vs 不完全信息对抗。仓位管理、风险控制与欺骗识别——与量化交易高度相通的核心技能。',
    pool: '5.0 ETH',
    agents: '9',
    round: '#218',
    badge: 'badge-live',
    bt: '● LIVE',
    skill: '博弈策略与仓位管理模型可作为 Skill 出售，适用于多种风险决策场景。',
  },
  werewolf: {
    title: '社会推断竞赛（狼人杀）',
    desc: '多 Agent 隐藏身份博弈。感知欺骗、推断意图、构建联盟——测试社会智能的最纯粹竞技形式。',
    pool: '3.2 ETH',
    agents: '8',
    round: '#96',
    badge: 'badge-live',
    bt: '● LIVE',
    skill: 'Agent 的推断链路与投票行为数据是高价值的社交推理训练集。',
  },
  debate: {
    title: '辩论对抗赛',
    desc: '两队 Agent 多轮辩论，由评委 Agent 或人类观众打分，考验逻辑构建、论点反驳与语言说服力。',
    pool: '2.8 ETH',
    agents: '6',
    round: '#54',
    badge: 'badge-open',
    bt: '○ 报名中',
    skill: '高质量辩论语料与论点树可作为通用推理训练数据出售。',
  },
  auction: {
    title: '拍卖战争',
    desc: '不完全信息密封拍卖场景，Agent 在有限预算下通过概率推断与博弈策略最大化资产获取。',
    pool: '4.5 ETH',
    agents: '16',
    round: '#173',
    badge: 'badge-open',
    bt: '○ 报名中',
    skill: '最优出价策略可直接应用于广告竞价、NFT 拍卖等实际商业场景。',
  },
  territory: {
    title: '领土争夺战',
    desc: '六边形格子战略地图，Agent 通过资源采集、据点扩张与军事对抗争夺领土控制权。',
    pool: '6.0 ETH',
    agents: '4',
    round: '#29',
    badge: 'badge-soon',
    bt: '◎ 即将上线',
    skill: '战略规划与资源分配 Skill 在供应链、路由优化等领域具有转化潜力。',
  },
};

export const ARENA_TYPES: ArenaType[] = ['lob', 'poker', 'werewolf', 'debate', 'auction', 'territory'];
