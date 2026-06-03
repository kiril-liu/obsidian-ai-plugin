import AiPlugin from "../main";
import { ChatConversation, ChatMemoryEntry, ChatMessage } from "../types";
import { VectorStore } from "../rag/VectorStore";

export class ChatMemoryStore {
	plugin: AiPlugin;

	constructor(plugin: AiPlugin) {
		this.plugin = plugin;
	}

	// 笔记操作的状态提示（✅/⚠️）不进记忆库，避免污染语义
	private shouldSkip(message: ChatMessage) {
		return message.role === "AI" && (message.content.startsWith("✅ ") || message.content.startsWith("⚠️ "));
	}

	// 增量记忆：把一条新消息向量化后追加进当前会话独立向量库；
	// 与 Vault 索引完全隔离，且不随 chatHistory 截断而丢失
	async remember(conversation: ChatConversation, message: ChatMessage) {
		if (this.shouldSkip(message)) return;

		const modelId = this.plugin.embeddingClient.getActiveModelId();
		if (!conversation.memory) conversation.memory = [];

		// 模型一致性：embedding 模型变了，旧向量作废，之后重新累积
		if (conversation.memory.length > 0 && conversation.memory[0].modelId !== modelId) {
			conversation.memory = [];
		}

		try {
			const embedding = (await this.plugin.embeddingClient.embed([message.content]))[0];
			if (!Array.isArray(embedding) || embedding.length === 0) return;

			conversation.memory.push({
				seq: conversation.memory.length,
				role: message.role,
				text: message.content,
				embedding: VectorStore.normalize(embedding),
				modelId,
			});
		} catch (error) {
			console.error("[AI Copilot] 会话记忆向量化失败：", error);
		}
	}

	// 在当前会话向量库里检索与查询最相关的历史消息（不跨会话）
	search(conversation: ChatConversation, queryEmbedding: number[], limit: number, excludeText?: string): ChatMemoryEntry[] {
		if (!conversation.memory || conversation.memory.length === 0) return [];

		const query = VectorStore.normalize(queryEmbedding);

		return conversation.memory
			.filter((entry) => entry.text !== excludeText)
			.map((entry) => ({ entry, score: VectorStore.dot(query, entry.embedding) }))
			.sort((a, b) => b.score - a.score)
			.slice(0, limit)
			.map((item) => item.entry);
	}

	// 把检索到的历史片段按对话先后顺序拼成 prompt 文本
	formatForPrompt(entries: ChatMemoryEntry[]): string {
		return [...entries]
			.sort((a, b) => a.seq - b.seq)
			.map((entry) => `${entry.role}: ${entry.text}`)
			.join("\n\n");
	}
}