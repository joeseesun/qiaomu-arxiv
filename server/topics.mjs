// 精选主题策展：每个主题映射到一个 arXiv API 查询。
// query 直接进 search_query 参数，sort 决定默认排序。
export const topics = [
  {
    id: "llm-agents",
    name: "LLM 智能体",
    tagline: "会规划、会用工具、会协作的大模型",
    query: 'cat:cs.AI AND (all:"LLM agent" OR all:"language model agent")',
    sort: "submittedDate"
  },
  {
    id: "reasoning",
    name: "推理与思维链",
    tagline: "从 CoT 到慢思考，模型如何学会推理",
    query: 'cat:cs.CL AND (all:"chain-of-thought" OR all:reasoning)',
    sort: "submittedDate"
  },
  {
    id: "diffusion",
    name: "扩散模型",
    tagline: "图像、视频、音频生成的核心引擎",
    query: '(cat:cs.CV OR cat:cs.LG) AND all:"diffusion model"',
    sort: "submittedDate"
  },
  {
    id: "video-generation",
    name: "视频生成",
    tagline: "世界模型与长视频合成的前沿",
    query: '(cat:cs.CV OR cat:cs.AI) AND (all:"video generation" OR all:"world model")',
    sort: "submittedDate"
  },
  {
    id: "multimodal",
    name: "多模态大模型",
    tagline: "看图、听声、理解世界的统一模型",
    query: 'cat:cs.CL AND (all:multimodal OR all:"vision-language")',
    sort: "submittedDate"
  },
  {
    id: "rag",
    name: "检索增强生成",
    tagline: "让模型查资料再回答",
    query: 'cat:cs.IR OR (cat:cs.CL AND all:"retrieval-augmented")',
    sort: "submittedDate"
  },
  {
    id: "efficient-ml",
    name: "高效推理与压缩",
    tagline: "量化、蒸馏、稀疏化，把大模型变小",
    query: 'cat:cs.LG AND (all:quantization OR all:distillation OR all:"model compression")',
    sort: "submittedDate"
  },
  {
    id: "robotics",
    name: "具身智能与机器人",
    tagline: "让模型长出手脚",
    query: 'cat:cs.RO AND (all:"foundation model" OR all:"vision-language-action" OR all:embodied)',
    sort: "submittedDate"
  },
  {
    id: "ai-safety",
    name: "AI 安全与对齐",
    tagline: "可解释性、红队与人类价值对齐",
    query: '(cat:cs.AI OR cat:cs.CL) AND (all:alignment OR all:"AI safety" OR all:interpretability)',
    sort: "submittedDate"
  },
  {
    id: "ai-for-science",
    name: "AI for Science",
    tagline: "蛋白质、材料、气候里的深度学习",
    query: '(cat:q-bio.BM OR cat:physics.chem-ph OR cat:cs.LG) AND (all:"protein" OR all:"molecular" OR all:"scientific discovery")',
    sort: "submittedDate"
  },
  {
    id: "code-gen",
    name: "代码生成",
    tagline: "AI 程序员的能力边界",
    query: 'cat:cs.SE OR (cat:cs.CL AND (all:"code generation" OR all:"code LLM"))',
    sort: "submittedDate"
  },
  {
    id: "long-context",
    name: "长上下文",
    tagline: "百万 token 的记忆与注意力新架构",
    query: 'cat:cs.CL AND (all:"long context" OR all:"long-context" OR all:"state space model" OR all:Mamba)',
    sort: "submittedDate"
  }
];

// 每日精选候选池：从这些分类抓最新提交，交给 AI 挑选。
export const featuredCategories = ["cs.CL", "cs.AI", "cs.CV", "cs.LG", "cs.RO"];

// 搜索页分类筛选器（arXiv 主要 AI 相关分类）。
export const categoryFilters = [
  { id: "", name: "全部分类" },
  { id: "cs.AI", name: "人工智能" },
  { id: "cs.CL", name: "自然语言处理" },
  { id: "cs.CV", name: "计算机视觉" },
  { id: "cs.LG", name: "机器学习" },
  { id: "cs.RO", name: "机器人" },
  { id: "cs.IR", name: "信息检索" },
  { id: "cs.SE", name: "软件工程" },
  { id: "cs.HC", name: "人机交互" },
  { id: "stat.ML", name: "统计学习" },
  { id: "eess.AS", name: "语音" },
  { id: "q-bio.BM", name: "生物分子" }
];

// 搜索下载页的轮播搜索词：用户视角的自然语言问句。
export const discoverSuggestions = [
  "我想搞懂大模型是怎么学会推理的",
  "找几篇讲 RAG 检索增强的论文",
  "视频生成最近有什么突破",
  "怎么把大模型部署到手机上",
  "扩散模型的原理，和 GAN 比哪个好",
  "多模态大模型是怎么看懂图片的",
  "AI Agent 智能体方向的综述",
  "长上下文窗口有哪些新架构",
  "LoRA 微调的原理和效果",
  "具身智能和机器人方向看什么",
  "大模型安全与对齐问题",
  "Mamba 和 Transformer 有什么区别",
  "小模型怎么蒸馏大模型",
  "AI 怎么预测蛋白质结构",
  "代码生成模型是怎么训练的",
  "混合专家模型 MoE 为什么快",
  "大模型的幻觉问题怎么缓解",
  "RLHF 人类反馈强化学习"
];

export function getTopic(id) {
  return topics.find((topic) => topic.id === id) || null;
}
