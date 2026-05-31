import { ItemView, MarkdownView, Notice, TFile, WorkspaceLeaf } from "obsidian";
import AiPlugin from "../main";
import { ErrorFormatter } from "../errors/ErrorFormatter";
import { ChatHistoryModal } from "../history/ChatHistoryModal";
import { SourceFormatter } from "../rag/SourceFormatter";
import { ChatMessage } from "../types";

export const AI_CHAT_VIEW_TYPE = "ai-copilot-chat-view";

type CurrentNoteContext = {
	fileName: string;
	path: string;
	content: string;
	selection: string;
};

export class AiChatView extends ItemView {
	plugin: AiPlugin;
	messagesEl: HTMLElement;
	inputEl: HTMLTextAreaElement;
	sourcesEl: HTMLElement;
	progressEl: HTMLElement;
	statusEl: HTMLElement;
	useRagEl: HTMLInputElement;
	lastMarkdownView: MarkdownView | null = null;
	activePromptName = "普通提问";

	constructor(leaf: WorkspaceLeaf, plugin: AiPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType() {
		return AI_CHAT_VIEW_TYPE;
	}

	getDisplayText() {
		return "AI Copilot";
	}

	getIcon() {
		return "sparkles";
	}

	async onOpen() {
		const container = this.containerEl.children[1];
		container.empty();
		container.addClass("ai-chat-view");

		this.rememberCurrentMarkdownView();
		this.registerEvent(
			this.app.workspace.on("active-leaf-change", () => {
				this.rememberCurrentMarkdownView();
				this.renderContextStatus();
			})
		);

		const headerEl = container.createDiv("ai-chat-header");
		const titleRow = headerEl.createDiv("ai-chat-title-row");

		const historyButton = titleRow.createEl("button", {
			text: "历史对话",
			cls: "ai-chat-history-button",
		});
		historyButton.onclick = () => new ChatHistoryModal(this.app, this.plugin).open();

		titleRow.createEl("button", {
			text: "新建对话",
			cls: "ai-chat-new-button",
		}).onclick = async () => {
			await this.plugin.startNewChatConversation();
			this.renderMessages();
			this.renderSources([]);
			this.renderContextStatus();
		};

		this.statusEl = headerEl.createDiv("ai-chat-context-status");

		this.progressEl = container.createDiv("ai-chat-progress");

		const bodyEl = container.createDiv("ai-chat-body");
		this.messagesEl = bodyEl.createDiv("ai-chat-messages");
		this.sourcesEl = bodyEl.createDiv("ai-chat-sources");

		const inputArea = container.createDiv("ai-chat-input-area");

		this.inputEl = inputArea.createEl("textarea", {
			cls: "ai-chat-input",
			placeholder: "输入问题，例如：总结这个页面，或输入 /每日复盘 调用 Prompt",
		});

		this.inputEl.addEventListener("keydown", async (event) => {
			if (event.key === "Enter" && !event.shiftKey) {
				event.preventDefault();
				await this.send(this.useRagEl.checked);
			}
		});

		const row = inputArea.createDiv("ai-chat-button-row");

		const ragLabel = row.createEl("label", { cls: "ai-chat-rag-toggle" });
		this.useRagEl = ragLabel.createEl("input", { type: "checkbox" });
		ragLabel.createSpan({ text: "使用 Vault 检索" });
		this.useRagEl.onchange = () => {
			this.activePromptName = this.useRagEl.checked ? "普通提问 + Vault 检索" : "普通提问";
			this.renderContextStatus();
		};

		row.createEl("button", { text: "发送", cls: "mod-cta" }).onclick = () => this.send(this.useRagEl.checked);
		row.createEl("button", { text: "取消" }).onclick = () => this.plugin.progressTracker.cancel();
		row.createEl("button", { text: "清空" }).onclick = async () => {
			this.plugin.chatHistory = [];
			this.plugin.syncActiveConversation();
			await this.plugin.saveAllData();
			this.renderMessages();
			this.renderSources([]);
			this.renderContextStatus();
		};

		this.renderContextStatus();
		this.renderProgress();
		this.renderMessages();
		this.renderSources([]);
	}

	async send(useRag = false) {
		const question = this.inputEl.value.trim();
		if (!question) return;

		this.rememberCurrentMarkdownView();
		this.inputEl.value = "";
		this.plugin.addChatMessage("你", question);
		this.renderMessages();

		this.activePromptName = useRag ? "普通提问 + Vault 检索" : "普通提问";
		this.renderContextStatus();

		if (question.startsWith("/")) {
			const promptName = question.slice(1).trim();
			this.activePromptName = `/${promptName}`;
			this.renderContextStatus();
			await this.runSlashPrompt(promptName);
			return;
		}

		try {
			const signal = this.plugin.progressTracker.start("AI Chat", ["准备上下文", "检索 Vault", "调用 AI", "显示结果"]);
			this.plugin.progressTracker.setStep("准备上下文");

			const currentNoteContext = await this.getCurrentNoteContext();
			let contextText = "";
			let sourcesMarkdown = "";
			let sources: any[] = [];

			if (useRag) {
				this.plugin.progressTracker.setStep("检索 Vault");

				try {
					const index = this.plugin.vectorStore.getIndex();

					if (index && index.chunks.length > 0) {
						const queryEmbedding = (await this.plugin.embeddingClient.embed([question], signal))[0];
						let results = this.plugin.vectorStore.search(queryEmbedding, this.plugin.settings.vectorSearchMaxResults);

						if (this.plugin.settings.enableHybridSearch) {
							results = await this.plugin.hybridSearch.search(question, results);
						}

						sources = SourceFormatter.fromResults(results);
					} else {
						const keywordResults = await this.plugin.keywordSearch.search(question);
						sources = SourceFormatter.fromResults(keywordResults);
					}
				} catch (error) {
					const keywordResults = await this.plugin.keywordSearch.search(question);
					sources = SourceFormatter.fromResults(keywordResults);
				}

				contextText = SourceFormatter.toContextText(sources);
				sourcesMarkdown = SourceFormatter.toMarkdown(sources);
				this.renderSources(sources);
			} else {
				this.renderSources([]);
			}

			const history = this.plugin.chatHistory
				.slice(-this.plugin.settings.chatHistoryMaxMessages)
				.map((message) => `${message.role}: ${message.content}`)
				.join("\n\n");

			const prompt = [
				useRag ? "请结合当前笔记和参考资料回答。" : "请结合当前笔记回答用户问题。如果当前笔记上下文为空，则直接回答用户问题。",
				currentNoteContext ? this.formatCurrentNoteContext(currentNoteContext) : "",
				contextText ? `Vault 参考资料：\n${contextText}` : "",
				`对话历史：\n${history}`,
				`用户问题：\n${question}`,
			]
				.filter(Boolean)
				.join("\n\n");

			this.plugin.progressTracker.setStep("调用 AI");

			const answer = await this.plugin.aiClient.chat(prompt, signal);
			const finalAnswer = sourcesMarkdown ? `${answer}\n\n### 参考来源\n\n${sourcesMarkdown}` : answer;

			this.plugin.addChatMessage("AI", finalAnswer);
			this.plugin.progressTracker.setStep("显示结果");
			this.plugin.progressTracker.complete("回答完成");
			this.renderMessages();
			this.renderContextStatus();
		} catch (error) {
			const friendly = ErrorFormatter.fromUnknown(error);
			this.plugin.progressTracker.fail(friendly.message);
			new Notice(ErrorFormatter.toNoticeText(friendly));
		}
	}

	renderContextStatus() {
		if (!this.statusEl) return;

		this.statusEl.empty();

		const markdownView = this.findCurrentMarkdownView();
		const file = markdownView?.file instanceof TFile ? markdownView.file : null;

		const fileName = file?.name ?? "未检测到 Markdown 笔记";
		const path = file?.path ?? "请先打开一个 Markdown 笔记";

		const fileRow = this.statusEl.createDiv("ai-chat-context-row");
		fileRow.createSpan({ text: "当前文件：", cls: "ai-chat-context-label" });
		fileRow.createSpan({ text: fileName, cls: "ai-chat-context-value" });

		const pathRow = this.statusEl.createDiv("ai-chat-context-row");
		pathRow.createSpan({ text: "路径：", cls: "ai-chat-context-label" });
		pathRow.createSpan({ text: path, cls: "ai-chat-context-value" });

		const promptRow = this.statusEl.createDiv("ai-chat-context-row");
		promptRow.createSpan({ text: "当前 Prompt：", cls: "ai-chat-context-label" });
		promptRow.createSpan({ text: this.activePromptName || "普通提问", cls: "ai-chat-context-value" });
	}

	rememberCurrentMarkdownView() {
		const activeMarkdownView = this.app.workspace.getActiveViewOfType(MarkdownView);

		if (activeMarkdownView?.file instanceof TFile && activeMarkdownView.file.extension === "md") {
			this.lastMarkdownView = activeMarkdownView;
		}
	}

	findCurrentMarkdownView(): MarkdownView | null {
		const activeMarkdownView = this.app.workspace.getActiveViewOfType(MarkdownView);

		if (activeMarkdownView?.file instanceof TFile && activeMarkdownView.file.extension === "md") {
			this.lastMarkdownView = activeMarkdownView;
			return activeMarkdownView;
		}

		if (this.lastMarkdownView?.file instanceof TFile && this.lastMarkdownView.file.extension === "md") {
			return this.lastMarkdownView;
		}

		const markdownLeaves = this.app.workspace.getLeavesOfType("markdown");

		for (const leaf of markdownLeaves) {
			if (leaf.view instanceof MarkdownView && leaf.view.file instanceof TFile && leaf.view.file.extension === "md") {
				this.lastMarkdownView = leaf.view;
				return leaf.view;
			}
		}

		return null;
	}

	async getCurrentNoteContext(): Promise<CurrentNoteContext | null> {
		const markdownView = this.findCurrentMarkdownView();

		if (!markdownView?.file) return null;

		const file = markdownView.file;
		const selection = markdownView.editor.getSelection();
		const content = await this.app.vault.cachedRead(file);

		return {
			fileName: file.name,
			path: file.path,
			selection,
			content: this.plugin.limitText(content),
		};
	}

	formatCurrentNoteContext(context: CurrentNoteContext) {
		return [
			"当前笔记上下文：",
			`文件名：${context.fileName}`,
			`路径：${context.path}`,
			context.selection ? `当前选中文本：\n${context.selection}` : "",
			`当前笔记内容：\n${context.content}`,
		]
			.filter(Boolean)
			.join("\n\n");
	}

	async runSlashPrompt(name: string) {
		const template = await this.plugin.promptManager.getTemplateByName(name);

		if (!template) {
			new Notice(`没有找到 Prompt 模板：${name}`);
			return;
		}

		const { runPromptTemplate } = await import("../commands/promptCommands");
		await runPromptTemplate(this.plugin, template);
	}

	renderMessages() {
		if (!this.messagesEl) return;

		this.messagesEl.empty();

		for (const message of this.plugin.chatHistory) {
			this.renderMessage(message);
		}

		this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
	}

	renderMessage(message: ChatMessage) {
		const el = this.messagesEl.createDiv("ai-chat-message");
		el.createEl("strong", { text: `${message.role}：` });
		el.createSpan({ text: message.content });

		if (message.role === "AI") {
			const actions = el.createDiv("ai-chat-message-actions");

			actions.createEl("button", { text: "插入到光标" }).onclick = () => {
				this.insertAnswerAtCursor(message.content);
			};

			actions.createEl("button", { text: "复制" }).onclick = async () => {
				await navigator.clipboard.writeText(message.content);
				new Notice("已复制 AI 回答");
			};
		}
	}

	insertAnswerAtCursor(content: string) {
		const markdownView = this.findWritableMarkdownView();

		if (!markdownView) {
			new Notice("当前文件不是 md 格式，或没有打开可插入的 Markdown 笔记");
			return;
		}

		markdownView.editor.replaceSelection(content);
		new Notice("已插入到当前光标位置");
	}

	findWritableMarkdownView(): MarkdownView | null {
		return this.findCurrentMarkdownView();
	}

	getFileName(path: string) {
		return path.split("/").pop() ?? path;
	}

	renderSources(sources: any[]) {
		if (!this.sourcesEl) return;

		this.sourcesEl.empty();

		if (!sources.length) {
			this.sourcesEl.addClass("ai-chat-sources-empty");
			return;
		}

		this.sourcesEl.removeClass("ai-chat-sources-empty");
		this.sourcesEl.createEl("h3", { text: "参考来源" });

		for (const source of sources) {
			const card = this.sourcesEl.createDiv("ai-chat-source-card ai-chat-source-card-simple");
			card.createEl("div", { text: this.getFileName(source.path), cls: "ai-chat-source-path" });
			card.createEl("div", { text: source.path, cls: "ai-chat-source-line" });

			card.createEl("button", { text: "打开" }).onclick = async () => {
				const file = this.plugin.app.vault.getAbstractFileByPath(source.path);
				if (file) await this.plugin.app.workspace.getLeaf().openFile(file as any);
			};
		}
	}

	renderProgress() {
		if (!this.progressEl) return;

		this.progressEl.empty();

		const state = this.plugin.progressTracker.getState();

		if (!state) {
			this.progressEl.createEl("div", { text: "暂无 AI 调用", cls: "ai-chat-progress-empty" });
			return;
		}

		const header = this.progressEl.createDiv("ai-progress-header");
		header.createEl("strong", { text: state.title });
		header.createEl("span", { text: state.active ? "运行中" : state.cancelled ? "已取消" : state.error ? "失败" : "完成" });

		const list = this.progressEl.createDiv("ai-progress-step-list");

		for (const step of state.steps) {
			const row = list.createDiv(`ai-progress-step ai-progress-step-${step.status}`);
			row.createSpan({ text: this.iconForStatus(step.status), cls: "ai-progress-step-icon" });
			row.createSpan({ text: step.detail ? `${step.label}：${step.detail}` : step.label });
		}
	}

	iconForStatus(status: string) {
		if (status === "done") return "✓";
		if (status === "running") return "…";
		if (status === "failed") return "!";
		if (status === "cancelled") return "×";
		return "○";
	}

	async onClose() {}
}