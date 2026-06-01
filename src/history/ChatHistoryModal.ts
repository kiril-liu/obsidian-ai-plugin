import { App, Modal, Notice } from "obsidian";
import AiPlugin from "../main";
import { ChatConversation } from "../types";

export class ChatHistoryModal extends Modal {
	plugin: AiPlugin;

	constructor(app: App, plugin: AiPlugin) {
		super(app);
		this.plugin = plugin;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("ai-chat-history-modal");

		contentEl.createEl("h2", { text: "历史对话" });

		const conversations = this.plugin.chatConversations
			.filter((conversation) => conversation.messages.length > 0)
			.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

		if (conversations.length === 0) {
			contentEl.createEl("p", { text: "暂无历史对话。", cls: "ai-chat-desc" });
			return;
		}

		for (const conversation of conversations) {
			this.renderConversation(contentEl, conversation);
		}
	}

	renderConversation(container: HTMLElement, conversation: ChatConversation) {
		const item = container.createDiv("ai-chat-history-item");

		const titleRow = item.createDiv("ai-chat-history-title-row");
		titleRow.createEl("strong", { text: conversation.title || "未命名对话" });
		titleRow.createEl("span", {
			text: new Date(conversation.updatedAt).toLocaleString(),
			cls: "ai-chat-history-time",
		});

		const firstUserMessage = conversation.messages.find(
			(message) => message.role === "你",
		);
		const preview = (firstUserMessage?.content ?? "").split("\n")[0];

		item.createEl("div", { text: preview, cls: "ai-chat-history-preview" });

		const buttonRow = item.createDiv("ai-chat-history-actions");
		buttonRow.createEl("button", { text: "恢复对话" }).onclick = async () => {
			await this.plugin.restoreChatConversation(conversation.id);
			new Notice("已恢复历史对话");
			this.close();
		};
	}

	onClose() {
		this.contentEl.empty();
	}
}