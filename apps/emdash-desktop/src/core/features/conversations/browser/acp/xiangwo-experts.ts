// [XG-CUSTOM] 项我 @ 专家补全清单（从 suagent_registry.py 生成，改专家后重跑 _gen_xiangwo_experts_ts.py）
// 大包（主 bot）+ 小包（子代理，parent 归属）+ 通用角色（项我小仓）

export type XiangwoMentionItem = { id: string; name: string; bot: string };

// 9 个主 bot（项我主窗可 @）
export const XIANGWO_BOTS: XiangwoMentionItem[] = [
  { id: 'sxsj', name: '尚享设计主理人', bot: 'sxsj' },
  { id: 'babado', name: 'BABADO 主理人', bot: 'babado' },
  { id: 'dayi', name: '大翼航天主理人', bot: 'dayi' },
  { id: 'shangcha', name: '上茶主理人', bot: 'shangcha' },
  { id: 'shuobo', name: '硕博主理人', bot: 'shuobo' },
  { id: 'yunyou', name: '云悠上茶主理人', bot: 'yunyou' },
  { id: 'chief-engineer', name: '总工程师', bot: 'chief-engineer' },
  { id: 'ceo', name: 'CEO', bot: 'ceo' },
  { id: 'caiwuzongguan', name: '财务总管', bot: 'caiwuzongguan' },
];

// 46 个子代理（bot 窗 @ 只列本 bot 的，parent 归属）
export const XIANGWO_SUBAGENTS: XiangwoMentionItem[] = [
  { id: 'sxsj_planning', name: '品牌策略规划师', bot: 'sxsj' },
  { id: 'design-brand-guardian', name: '品牌视觉守卫', bot: 'sxsj' },
  { id: 'sxsj-brand-strategist', name: '品牌战略师', bot: 'sxsj' },
  { id: 'sxsj_creative', name: '视觉创意师', bot: 'sxsj' },
  { id: 'design-visual-storyteller', name: '视觉叙事师', bot: 'sxsj' },
  { id: 'sxsj_design', name: '设计执行师', bot: 'sxsj' },
  { id: 'design-image-prompt-engineer', name: '生图提示工程', bot: 'sxsj' },
  { id: 'sxsj_review', name: '审核师', bot: 'sxsj' },
  { id: 'design-whimsy-injector', name: '趣味注入师', bot: 'sxsj' },
  { id: 'marketing-ecommerce-operator', name: '跨境电商运营专家', bot: 'babado' },
  { id: 'babado-brand-strategist', name: 'BABADO品牌战略师', bot: 'babado' },
  { id: 'marketing-social-media-manager', name: '社交媒体运营专家', bot: 'babado' },
  { id: 'babado-data-analyst', name: 'BABADO数据分析师', bot: 'babado' },
  { id: 'marketing-brand-content-creator', name: '品牌内容创作者', bot: 'babado' },
  { id: 'babado-user-research', name: 'BABADO用户研究员', bot: 'babado' },
  { id: 'babado-channel-manager', name: 'BABADO渠道经理', bot: 'babado' },
  { id: 'industrial-design-engineer', name: '工业设计工程师', bot: 'dayi' },
  { id: 'flight-safety-analyst', name: '飞行安全分析师', bot: 'dayi' },
  { id: 'dayi-brand-strategist', name: '大翼品牌战略师', bot: 'dayi' },
  { id: 'military-civil-compliance', name: '军民融合合规专家', bot: 'dayi' },
  { id: 'technical-documentation-writer', name: '技术文档撰写专家', bot: 'dayi' },
  { id: 'structural-engineering', name: '结构工程师', bot: 'dayi' },
  { id: 'b2b-marketing-specialist', name: 'B2B营销专家', bot: 'dayi' },
  { id: 'dayi-aftermarket-service', name: '大翼售后专家', bot: 'dayi' },
  { id: 'tea-brand-strategist', name: '上茶品牌战略师', bot: 'shangcha' },
  { id: 'tea-packaging-designer', name: '茶叶包装设计师', bot: 'shangcha' },
  { id: 'tea-culture-content', name: '茶文化内容创作者', bot: 'shangcha' },
  { id: 'shangcha-supply-chain', name: '上茶供应链专家', bot: 'shangcha' },
  { id: 'shangcha-store-experience', name: '上茶门店体验设计师', bot: 'shangcha' },
  { id: 'shangcha-customer-relation', name: '上茶客户关系专家', bot: 'shangcha' },
  { id: 'shangcha-ecommerce-operator', name: '上茶电商运营专家', bot: 'shangcha' },
  { id: 'quality-control-standard', name: '质量控制标准专家', bot: 'shuobo' },
  { id: 'environmental-compliance', name: '环保合规专家', bot: 'shuobo' },
  { id: 'shuobo-brand-strategist', name: '硕博品牌战略师', bot: 'shuobo' },
  { id: 'material-appraisal-engineer', name: '材料鉴定工程师', bot: 'shuobo' },
  { id: 'cost-accounting-analyst', name: '成本核算分析师', bot: 'shuobo' },
  { id: 'b2b-industrial-sales', name: 'B2B工业销售专家', bot: 'shuobo' },
  { id: 'investment-channel-manager', name: '投资渠道经理', bot: 'shuobo' },
  { id: 'course-curriculum-designer', name: '课程设计师', bot: 'yunyou' },
  { id: 'yunyou-tea-consultant', name: '云游茶顾问', bot: 'yunyou' },
  { id: 'yunyou-brand-strategist', name: '云游品牌战略师', bot: 'yunyou' },
  { id: 'cultural-content-writer', name: '文化内容创作者', bot: 'yunyou' },
  { id: 'event-experience-planner', name: '活动体验策划师', bot: 'yunyou' },
  { id: 'yunyou-student-experience', name: '学员体验设计师', bot: 'yunyou' },
  { id: 'yunyou-new-media-operator', name: '云游新媒体运营', bot: 'yunyou' },
  { id: 'yunyou-space-designer', name: '云游空间设计师', bot: 'yunyou' },
];

// 6 个通用角色（项我小仓）
export const XIANGWO_ROLES: XiangwoMentionItem[] = [
  { id: 'scout', name: '侦察员', bot: '' },
  { id: 'researcher', name: '研究员', bot: '' },
  { id: 'worker', name: '执行员', bot: '' },
  { id: 'reviewer', name: '审查员', bot: '' },
  { id: 'oracle', name: '顾问', bot: '' },
  { id: 'delegate', name: '委托员', bot: '' },
];
