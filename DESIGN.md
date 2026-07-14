# DESIGN.md — 乔木 arXiv 设计锚

> 全站唯一事实源。任何页面、任何会话轮次改动风格前先改这份文件。

## 1. 视觉主题与氛围

学术期刊 × 开发者工具。暖纸色底 + 衬线标题营造"纸质期刊"的可信感，等宽字体的 arXiv ID、日期、分类标签带来工具气质。整体克制、安静、以内容为中心；唯一的重音色是 arXiv 红。

记忆点：首页深色 lead 精选卡 + 右下角巨型「01」衬线编号水印，像期刊索引卡。

## 2. 色板与角色

| Token | 值 | 用途 |
| --- | --- | --- |
| `--paper` | `#F6F3EA` | 页面底色（羊皮纸暖色） |
| `--surface` | `#FCFBF6` | 卡片与输入框 |
| `--surface-sunken` | `#F1EDE1` | 芯片、hover 底、次要按钮 |
| `--ink` | `#1C1813` | 主文字、深色区块（暖近黑，禁纯黑） |
| `--ink-2` | `#5C5647` | 次要文字 |
| `--ink-3` | `#8D8775` | 辅助文字、时间戳 |
| `--accent` | `#B3372C` | 唯一重音色：主 CTA、看点标题、链接强调 |
| `--accent-deep` | `#93291F` | hover 加深 |
| `--accent-tint` | `#F4E4DD` | focus 环、选区底色 |
| `--border` / `--border-strong` | `#E8E2D2` / `#D9D2BD` | 分隔线与边框（暖灰） |

规则：所有灰都带暖调，禁冷灰蓝；重音色只此一个，饱和度 < 80%；深色区块文字 `rgba(252,251,246,.88)`，次要 ≥ `.55`。

## 3. 排版规则

- 展示/标题：`Fraunces`（opsz 轴，字重 400–600，单一字重气质），中文回退 `Songti SC`
- UI/正文：系统中文栈（PingFang SC → Microsoft YaHei → Noto Sans SC），行高 1.65–1.75
- 元数据/ID/日期/分类：`IBM Plex Mono`，`tabular-nums`
- 论文标题 18.5–23px 衬线 500；H1 clamp(34px, 4.6vw, 56px)，最多 2 行
- 禁斜体（含英文）；强调用字重/颜色/字号
- 中西文、中文与数字之间留空格；全角标点

## 4. 组件样式

- **arXiv ID 芯片**：mono 12px、sunken 底、6px 圆角，点击复制
- **分类标签**：mono 11.5px、999px 描边胶囊
- **按钮**：8px 圆角、1px 暖边框；主按钮实色红；`:active { transform: scale(.97) }`
- **论文行**：hairline 分隔的索引卡式行，非卡片堆叠；标题 + 作者 + 摘要 + meta + 右侧动作
- **精选卡**：12px 圆角，hover `translateY(-2px)` + 暖色 lift 阴影；lead 卡深色反相
- **选中态**：整块底色 + 字重，禁左侧竖线装饰

## 5. 布局原则

- 容器 `max-width: 1180px`，4px 间距基准
- 首页：非对称 hero（1.35fr / 1fr）→ 精选 2 列 dense 网格（lead 跨 2 行）→ 主题 6 栏不等比网格 → 最新提交列表
- 详情页：正文 / AI 面板双栏（1fr / 368px），AI 面板 sticky；< 900px 塌缩单列
- 列表分组优先 hairline，卡片只用于需要 z 轴层级处
- 眉批（eyebrow）不用；区块标题用衬线 + 右侧注释

## 6. 深度层级

1. Flat：纸面底色
2. Hairline：`1px solid var(--border)` 分隔
3. Ring：`0 0 0 1px` 暖色环（交互态）
4. Lift：`0 1px 2px + 0 8px 24px` 6% 暖黑（hover 浮起）

## 7. Do's / Don'ts

- ✅ 暖色一统、单一红色重音、衬线标题 + 系统中文 + mono 元数据三层字体分工
- ✅ 内容密度高但用 hairline 与留白分组；列表行入场 45ms 阶梯
- ❌ 紫蓝渐变、纯黑、外发光、渐变文字、玻璃拟态
- ❌ Inter/Roboto、斜体、左侧竖线装饰、每 section 眉批、居中 hero
- ❌ 卡片当万能分组容器

## 8. 响应式

- 900px：双栏塌缩单列，AI 面板取消 sticky，精选网格单列
- 720px：头部换行，搜索占整行；论文行动作区回左
- 480px：主题卡整列，导航收紧
- 禁 `h-screen`，用 `min-h-[100dvh]` 等效；无横向滚动

## 9. Motion 哲学

- 只动 transform/opacity；缓动 `cubic-bezier(0.23,1,0.32,1)`；UI ≤ 300ms
- 列表/卡片入场：translateY(8px) + opacity，40–60ms 阶梯
- hover 浮起 180ms；按压 100ms scale(.97)
- 流式输出用光标闪烁（steps 动画）提示生成中
- 全部包 `prefers-reduced-motion` 兜底；hover 效果包 `@media (hover: hover) and (pointer: fine)`
