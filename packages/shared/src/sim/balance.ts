/**
 * W3 平衡参数 —— 调参主战场。
 * 红线：良心 vs 狠活的取舍必须有真实纠结感。改这里不改逻辑。
 */
export const BAL = {
  durationS: 480, // 一局 8 分钟
  startMoney: 100,

  // 进货
  costHonest: 3, // 良心食材 ¥/串
  costShady: 1, // 科技狠活 ¥/串
  restockEveryS: 60, // 进货车周期
  restockWindowS: 12, // 决策窗口
  restockMax: 200, // 单次进货上限（ sanity 上限，实际数量由钱包余额决定：卖得多→进得多）

  // 出餐（狠活先卖：新货压柜台面）
  serviceSHonest: 2.5,
  serviceSShady: 1.5,
  queueCap: 8,
  patienceS: { student: 12, dalvy: 20, worker: 8, tourist: 15 } as Record<string, number>,

  // 定价
  priceMin: 4,
  priceMax: 12,

  // 烧心值 0~100
  /** W7 调参：2.5→1.4。2.5 时自证循环（¥25 压 45）成本吃光狠活利润，狠活没有经营空间 */
  heartburnPerShady: 1.4,
  heartburnReliefPerHonest: 1.5,
  heartburnDecayPer10S: 0.5,
  heartburnRiskAt: 70, // ≥ 此值进入危险区：口碑持续流失 + 随机自查（被动路径，非举报判定）
  /** 烧心超标期间每秒被随机抽检的概率（W7 调参：0.2→0.05，实测 0.2 时过线即秒罚，狠活没有经营空间） */
  riskFineChancePerS: 0.05,
  /** 举报/抽检判罚（W8 用户裁定·掷骰式）：力度 = 烧心值 × roll(0.25~1.25)，力度 ≥ inspectRollK 查实。
   *  等价成功率 = clamp(1.25 − K/烧心值, reportBaseChance, 1)：烧心低也有 5% 底（现场抓包），
   *  越高越稳、顶格必罚，中段曲线更陡不死板。自证清白从「绝对安全」变成「压概率」 */
  inspectRollMin: 0.25,
  inspectRollMax: 1.25,
  inspectRollK: 25,
  reportBaseChance: 0.05,

  // 口碑 0~100
  repStart: 50,
  repPerHonestSold: 0.3,
  repPerShadySold: 0.15, // 隐性损耗：口碑慢慢烂
  repDrainPerSAtRisk: 0.2, // 烧心值超标期间的持续流失
  repPerBadReview: -3,
  repPerInspectionPass: 2,
  repPerVerifiedHonest: 1,

  // 差评 / 回头客
  badReviewChanceShady: 0.25,
  badReviewChanceDalvy: 0.5, // 大爷嘴刁，概率翻倍
  loyalChanceAfterHonest: 0.35,
  loyalReturnDelayS: [8, 20] as [number, number],
  loyalQualityBonus: 0.3,

  // 顾客流
  baseSpawnPerS: 0.8,
  spawnGrowthPerS: 0.0008, // 缓升打底（决策 #18）
  surgeMult: 2.5,
  surgeDurS: 25,
  typeShare: { student: 0.3, dalvy: 0.25, worker: 0.25, tourist: 0.2 } as Record<string, number>,

  // 事件（随机事件驱动 #18）
  eventEveryS: [25, 45] as [number, number],
  fineAmount: 60,
  closeS: 10,

  // 对手摊（W5 bot 策略树 §2.3；起始口碑沿用此值）
  rivalPrice: 6,
  rivalRep: 50,

  // 主动博弈动作（W5：举报 / 自证清白 / 刷差评）
  reportCooldownS: 45, // 举报冷却（每座位独立）
  reportCleanRepCost: 3, // 举报落空（目标过检）的口碑代价：别乱报
  verifyCost: 25, // 自证清白花费
  verifyRelief: 45, // 自证清白烧心值削减
  verifyMinHeartburn: 30, // 有嫌疑（烧心值≥此值）才允许自证
  smearCost: 15, // 刷差评花费
  smearRepHit: 4, // 被刷目标口碑损失
  smearCaughtChance: 0.2, // 刷差评被抓概率
  smearCaughtRep: 10, // 被抓的口碑代价

  // bot 策略树
  botThinkEveryS: 5, // bot 思考节拍
  botNoise: 0.15, // 决策随机扰动幅度（难度旋钮：加 botNoise 即降智）
  bot: {
    honest: {
      honestShare: 0.9,
      price: 7,
      selfVerifyAt: 55,
      reportAt: 80, // 良心型很少举报
      reportChance: 0.04,
      smearLeadBy: 25, // 对手口碑遥遥领先才眼红
      smearChance: 0.05,
    },
    balanced: {
      honestShare: 0.5,
      price: 6,
      selfVerifyAt: 60,
      reportAt: 78,
      reportChance: 0.12,
      smearLeadBy: 15,
      smearChance: 0.1,
    },
    shady: {
      honestShare: 0.1,
      price: 4.5,
      selfVerifyAt: 62, // 投机型更积极自证，保住流水
      reportAt: 70, // 等对手烧心值最高时下手（明牌博弈）
      reportChance: 0.3,
      smearLeadBy: 8,
      smearChance: 0.2,
    },
  } as Record<string, {
    honestShare: number
    price: number
    selfVerifyAt: number
    reportAt: number
    reportChance: number
    smearLeadBy: number
    smearChance: number
  }>,

  // 效用权重（四型顾客 × 四因子 #17）
  weights: {
    student: { price: 0.55, quality: 0.15, queue: 0.2, risk: 0.1 },
    dalvy: { price: 0.1, quality: 0.5, queue: 0.15, risk: 0.25 },
    worker: { price: 0.2, quality: 0.2, queue: 0.5, risk: 0.1 },
    tourist: { price: 0.25, quality: 0.25, queue: 0.25, risk: 0.25 }, // 游客也会被逐项扰动
  },
  utilityLeaveThreshold: 0.35,
  utilityNoise: 0.1,

  // 结算（开放问题：营收 60% + 口碑 40% → 线性化）
  scoreRepWeight: 8, // score = 营收 + 口碑 × 8
} as const

export type Balance = typeof BAL
