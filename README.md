# AI Assistant for Obsidian

AI Assistant 是一个面向 Obsidian 的 AI 助手插件，支持 Chat 对话、Vault 检索、RAG 语义问答、Prompt Library、Daily Note 工作流、批量 Prompt、历史对话和 AI 回答插入。
当前稳定版本：`1.6.7`

Note:目前只测试了电脑版本，未测试向量库的功能，目前的Vault检索是依据关键词检索的。

## 核心功能

[基本命令](./screenshoot/commands.png)

### 1. AI Chat
#### 1.侧边栏
插件提供一个右侧 Chat 面板，用于和 AI 对话。
[聊天截图](./screenshoot/overview.png)
#### 2.历史对话
点击 Chat 顶部的 `历史对话` 可以查看最近对话。
[历史对话](./screenshoot/historychat.png)
#### 3.Vault 检索

勾选 Chat 面板中的：
使用 Vault 检索
插件会尝试从当前 Vault 中查找相关内容，再交给 AI 回答。

检索顺序：
1. 优先使用向量索引
2. 如果没有索引或检索失败，自动回退关键词检索
3. 文件名优先匹配
4. 路径匹配
5. 正文关键词匹配

#### 4. 参考来源简化显示

Chat 参考来源区域只显示：

- 文件名
- 相对路径
- 打开按钮

### 2. Prompt Library

插件支持文本化 Prompt 模板。

- 默认 Prompt 文件： AI Copilot/Prompts.md

- 也支持文件夹模式： AI Copilot/Prompts/

- 可以在 Chat 中输入： /每日复盘
[提示词命令](./screenshoot/prompt.png)


#### 1. 日常生活 Prompt Pack

内置日常生活模板方向：

- 每日复盘
- 明日计划
- 周回顾
- 最近 TODO 汇总
- 读书笔记整理
- 学习计划
- 健身记录总结
- 消费记录分析
- 情绪日记整理
- 旅行计划

## 推荐使用流程

### 第一次使用

1. 安装插件
2. 配置 API Key
3. 配置模型
4. 打开 AI Chat view
5. 发送一个普通问题
6. 创建 Prompt Library
7. 构建 Vault vector index（可选，功能未测试）
8. 勾选 `使用 Vault 检索`
9. 测试 Vault 问答

