const v = (name: string) => "{" + "{" + name + "}" + "}";

export const LIFE_PROMPT_PACK = `# AI Copilot Life Prompt Pack

## 每日复盘

---
category: 生活管理
favorite: true
mode: basic
output: append
description: 根据今天的 Daily Note 生成复盘
---

\`\`\`prompt
请根据下面的今日记录，生成一份简洁的每日复盘：

今日记录：
${v("note")}

请输出：
1. 今日完成
2. 今日问题
3. 情绪和精力
4. 明日最重要的 3 件事
\`\`\`

## 明日计划

---
category: 生活管理
favorite: true
mode: basic
output: append
description: 根据今天记录生成明日计划
---

\`\`\`prompt
请根据下面内容，为我生成明日计划：

${v("note")}

要求：
- 最多 5 个任务
- 区分重要 / 普通
- 给出一个可执行的时间安排
\`\`\`

## 周回顾

---
category: 生活管理
favorite: true
mode: basic
output: append
description: 根据最近 Daily Notes 生成周回顾
---

\`\`\`prompt
请根据最近一周的记录生成周回顾：

${v("vaultContext")}

请输出：
1. 本周完成
2. 本周高频主题
3. 主要问题
4. 下周重点
\`\`\`

## 最近 TODO 汇总

---
category: 任务管理
favorite: true
mode: basic
output: chat
description: 汇总最近记录中的 TODO
---

\`\`\`prompt
请从下面内容中提取 TODO：

${v("vaultContext")}

要求：
- 按优先级排序
- 合并重复事项
- 标记可能已经完成的事项
\`\`\`

## 读书笔记整理

---
category: 学习
favorite: false
mode: rag
output: append
description: 整理读书笔记
---

\`\`\`prompt
请整理当前读书笔记：

当前笔记：
${v("note")}

相关内容：
${v("vaultContext")}

请输出：
1. 核心观点
2. 关键概念
3. 可行动启发
4. 延伸问题
\`\`\`
`;