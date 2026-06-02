import { FuzzySuggestModal, ItemView, MarkdownRenderer, MarkdownView, Notice, TFile, WorkspaceLeaf } from "obsidian";
import AiPlugin from "../main";
import { ErrorFormatter } from "../errors/ErrorFormatter";
import { ChatHistoryModal } from "../history/ChatHistoryModal";
import { NoteActionManager } from "../actions/NoteActionManager";
import { SourceFormatter } from "../rag/SourceFormatter";
import { ChatMessage, PromptTemplate } from "../types";

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
	promptFileButtonEl: HTMLButtonElement;
	promptSelectEl: HTMLSelectElement;
	selectedPromptFile: string | null = null;
	promptTemplates: PromptTemplate[] = [];
	noteActionManager: NoteActionManager;
	renderedMessages: ChatMessage[] = [];

	constructor(leaf: WorkspaceLeaf, plugin: AiPlugin) {
		super(leaf);
		this.plugin = plugin;
		this.noteActionManager = new NoteActionManager(this.app);
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

		this.promptFileButtonEl = titleRow.createEl("button", {
			cls: "ai-chat-prompt-file-button",
		});
		this.promptFileButtonEl.onclick = () => this.openPromptFilePicker();
		this.renderPromptFileButton();

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

		this.promptSelectEl = row.createEl("select", { cls: "ai-chat-prompt-select" });
		this.renderPromptSelect();

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
		const selectedPrompt = this.promptSelectEl?.value ?? "";

		if (selectedPrompt) {
			this.rememberCurrentMarkdownView();
			const typed = this.inputEl.value.trim();

			this.inputEl.value = "";
			const displayMessage = typed
				? `【提示词：${selectedPrompt}】\n${typed}`
				: `【提示词：${selectedPrompt}】`;
			this.plugin.addChatMessage("你", displayMessage);
			this.renderMessages();

			await this.runSelectedPrompt(selectedPrompt);
			return;
		}

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
				this.noteActionInstruction(),
				currentNoteContext ? this.formatCurrentNoteContext(currentNoteContext) : "",
				contextText ? `Vault 参考资料：\n${contextText}` : "",
				`对话历史：\n${history}`,
				`用户问题：\n${question}`,
			]
				.filter(Boolean)
				.join("\n\n");

			this.plugin.progressTracker.setStep("调用 AI");

			// 流式输出：先建一个临时气泡，token 到达时实时更新
			const streamEl = this.messagesEl.createDiv("ai-chat-message ai-chat-message-ai is-streaming");
			const streamBubble = streamEl.createDiv("ai-chat-bubble");
			streamBubble.style.whiteSpace = "pre-wrap";
			this.scrollLatestUserMessageToTop();

			let answer = "";
			await this.plugin.aiClient.chatStream(prompt, signal, (full) => {
				answer = full;
				const { cleaned } = NoteActionManager.parse(full);
				streamBubble.setText(cleaned || full);
				this.scrollLatestUserMessageToTop();
			});

			const { action, cleaned } = NoteActionManager.parse(answer);
			const displayAnswer = cleaned || answer;
			const finalAnswer = sourcesMarkdown ? `${displayAnswer}\n\n### 参考来源\n\n${sourcesMarkdown}` : displayAnswer;

			this.plugin.addChatMessage("AI", finalAnswer);

			if (action) {
				const result = await this.noteActionManager.run(action);
				this.plugin.addChatMessage("AI", `${result.ok ? "✅" : "⚠️"} ${result.message}`);
				new Notice(result.message);
			}

			this.plugin.progressTracker.setStep("显示结果");
			this.plugin.progressTracker.complete("回答完成");
			this.renderMessages();
			this.renderContextStatus();
		} catch (error) {
			const friendly = ErrorFormatter.fromUnknown(error);
			this.plugin.progressTracker.fail(friendly.message);
			new Notice(ErrorFormatter.toNoticeText(friendly));
			this.renderMessages();
		}
	}

	renderContextStatus() {
		if (!this.statusEl) return;

		this.statusEl.empty();

		const markdownView = this.findCurrentMarkdownView();
		const file = markdownView?.file instanceof TFile ? markdownView.file : null;

		const fileName = file?.name ?? "未检测到 Markdown 笔记";

		const fileRow = this.statusEl.createDiv("ai-chat-context-row");
		fileRow.createSpan({ text: "当前文件：", cls: "ai-chat-context-label" });
		fileRow.createSpan({ text: fileName, cls: "ai-chat-context-value" });
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

	noteActionInstruction() {
		return [
			"你可以执行笔记操作。",
			"当用户明确要求“新建笔记/页面”或“把内容写入/追加到某个笔记”时，请在正常回答之后另起一行，输出一个 note-action 代码块：",
			"```note-action",
			'{"action":"create","path":"目标路径或笔记名","content":"要写入的 Markdown 正文"}',
			"```",
			"其中 action 取 create（新建笔记）或 append（追加到已有笔记）；path 可为带文件夹的相对路径或笔记名；content 必须是完整的 Markdown 正文。",
			"若用户只是普通提问、没有要求操作笔记，则绝对不要输出该代码块。",
		].join("\n");
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

	async runSelectedPrompt(name: string) {
		const template =
			this.promptTemplates.find((item) => item.name === name) ??
			(await this.plugin.promptManager.getTemplateByName(name));

		if (!template) {
			new Notice(`没有找到 Prompt 模板：${name}`);
			return;
		}

		this.activePromptName = template.name;
		const { runPromptTemplate } = await import("../commands/promptCommands");
		await runPromptTemplate(this.plugin, template);
		this.renderMessages();
	}

	getPromptFileName(path: string | null) {
		if (!path) return "无";
		return path.split("/").pop()?.replace(/\.md$/, "") ?? path;
	}

	renderPromptFileButton() {
		if (!this.promptFileButtonEl) return;
		this.promptFileButtonEl.setText(`提示词文件：${this.getPromptFileName(this.selectedPromptFile)}`);
	}

	async openPromptFilePicker() {
		const templates = await this.plugin.promptManager.loadTemplates(true);
		this.promptTemplates = templates;

		const files = Array.from(new Set(templates.map((template) => template.sourcePath))).sort((a, b) =>
			a.localeCompare(b)
		);

		if (files.length === 0) {
			new Notice("没有找到任何提示词文件，请先在设置中创建 Prompt Library");
			return;
		}

		const view = this;

		const modal = new (class extends FuzzySuggestModal<string> {
			getItems() {
				return ["无", ...files];
			}

			getItemText(item: string) {
				return item === "无" ? "无（不指定提示词文件）" : view.getPromptFileName(item);
			}

			onChooseItem(item: string) {
				view.selectedPromptFile = item === "无" ? null : item;
				view.renderPromptFileButton();
				view.renderPromptSelect();
			}
		})(this.app);

		modal.setPlaceholder("选择一个提示词文件");
		modal.open();
	}

	renderPromptSelect() {
		if (!this.promptSelectEl) return;

		this.promptSelectEl.empty();
		this.promptSelectEl.createEl("option", { text: "无", value: "" });

		const names = this.selectedPromptFile
			? this.promptTemplates
					.filter((template) => template.sourcePath === this.selectedPromptFile)
					.map((template) => template.name)
			: [];

		for (const name of names) {
			this.promptSelectEl.createEl("option", { text: name, value: name });
		}

		this.promptSelectEl.value = "";
	}

	renderMessages() {
		if (!this.messagesEl) return;

		// 清掉流式临时气泡和旧的底部占位，避免重复或错位
		this.messagesEl.querySelectorAll(".is-streaming, .ai-chat-scroll-spacer").forEach((el) => el.remove());

		const history = this.plugin.chatHistory;
		const rendered = this.renderedMessages;
		const domCount = this.messagesEl.querySelectorAll(".ai-chat-message").length;

		// 已渲染消息是否仍是当前历史的前缀（按引用比较）
		let commonPrefix = 0;
		while (
			commonPrefix < rendered.length &&
			commonPrefix < history.length &&
			rendered[commonPrefix] === history[commonPrefix]
		) {
			commonPrefix++;
		}

		if (commonPrefix === rendered.length && domCount === rendered.length) {
			// DOM 与历史前缀一致：只追加新增的消息
			for (let i = commonPrefix; i < history.length; i++) {
				this.renderMessage(history[i]);
			}
		} else {
			// 历史被替换 / 清空 / 截断 / 视图重建：整体重建
			this.messagesEl.empty();
			for (const message of history) {
				this.renderMessage(message);
			}
		}

		this.renderedMessages = [...history];
		this.scrollLatestUserMessageToTop();
	}

	scrollLatestUserMessageToTop() {
		if (!this.messagesEl) return;

		// 先清掉旧的底部占位，量出真实内容高度
		this.messagesEl.querySelectorAll(".ai-chat-scroll-spacer").forEach((el) => el.remove());

		const userMessages = this.messagesEl.querySelectorAll<HTMLElement>(".ai-chat-message-user");
		const last = userMessages[userMessages.length - 1];

		if (!last) {
			this.messagesEl.scrollTop = 0;
			return;
		}

		// 要让最新消息能滚到顶部，需要 scrollHeight >= last.offsetTop + clientHeight。
		// 内容不够时，补一个底部占位块。
		const needed = last.offsetTop + this.messagesEl.clientHeight - this.messagesEl.scrollHeight;

		if (needed > 0) {
			const spacer = this.messagesEl.createDiv("ai-chat-scroll-spacer");
			spacer.style.height = `${needed}px`;
		}

		this.messagesEl.scrollTop = last.offsetTop;
	}

	renderMessage(message: ChatMessage) {
		const isUser = message.role === "你";
		const el = this.messagesEl.createDiv(
			isUser ? "ai-chat-message ai-chat-message-user" : "ai-chat-message ai-chat-message-ai"
		);

		const bubble = el.createDiv("ai-chat-bubble");

		if (message.role === "AI") {
			MarkdownRenderer.render(this.app, message.content, bubble, "", this);

			const isStatus = message.content.startsWith("✅ ") || message.content.startsWith("⚠️ ");

			if (!isStatus) {
				const actions = el.createDiv("ai-chat-message-actions");

				actions.createEl("button", { text: "插入到光标" }).onclick = () => {
					this.insertAnswerAtCursor(message.content);
				};

				actions.createEl("button", { text: "复制" }).onclick = async () => {
					await navigator.clipboard.writeText(message.content);
					new Notice("已复制 AI 回答");
				};
			}
		} else {
			bubble.createSpan({ text: message.content });
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

		// 空闲（无任务或任务已结束）时完全隐藏进度条
		if (!state || !state.active) {
			this.progressEl.removeClass("is-active");
			this.progressEl.style.display = "none";
			return;
		}

		this.progressEl.style.display = "";

		const total = state.steps.length;
		const doneCount = state.steps.filter((step) => step.status === "done").length;
		const runningStep = state.steps.find((step) => step.status === "running");
		const currentIndex = runningStep
			? state.steps.indexOf(runningStep)
			: Math.min(doneCount, Math.max(total - 1, 0));

		const failed = !!state.error;
		const cancelled = !!state.cancelled;
		const finished = !state.active && !failed && !cancelled;

		let percent: number;
		if (finished) {
			percent = 100;
		} else if (failed || cancelled) {
			percent = total ? Math.round((doneCount / total) * 100) : 0;
		} else {
			percent = total ? Math.round(((doneCount + (runningStep ? 0.5 : 0)) / total) * 100) : 0;
		}
		percent = Math.max(0, Math.min(100, percent));

		const statusKey = failed ? "failed" : cancelled ? "cancelled" : finished ? "done" : "running";
		const statusText = failed ? "失败" : cancelled ? "已取消" : finished ? "完成" : "运行中";

		const stageLabel = runningStep?.label ?? state.currentStep ?? (finished ? "已完成" : "");
		const stageDetail = runningStep?.detail ?? (failed ? state.error : undefined);

		this.progressEl.addClass("is-active");

		const bar = this.progressEl.createDiv(`ai-progress-bar ai-progress-bar-${statusKey}`);

		// 单行：图标 + 标题 + 滚动阶段 + 步骤计数 + 百分比
		const line = bar.createDiv("ai-progress-line");
		line.createSpan({ text: this.iconForStatus(statusKey), cls: "ai-progress-line-icon" });
		line.createSpan({ text: state.title, cls: "ai-progress-line-title" });
		line.createSpan({ text: statusText, cls: "ai-progress-line-status" });

		const stageViewport = line.createDiv("ai-progress-stage-viewport");
		const stageTrack = stageViewport.createDiv("ai-progress-stage-track");
		const stageText = stageDetail ? `${stageLabel}：${stageDetail}` : stageLabel;
		// 渲染两份，配合 CSS 实现无缝横向滚动
		stageTrack.createSpan({ text: stageText, cls: "ai-progress-stage-item" });
		stageTrack.createSpan({ text: stageText, cls: "ai-progress-stage-item" });

		line.createSpan({
			text: total ? `${Math.min(currentIndex + 1, total)}/${total}` : "",
			cls: "ai-progress-line-count",
		});
		line.createSpan({ text: `${percent}%`, cls: "ai-progress-line-percent" });

		// 进度条
		const track = bar.createDiv("ai-progress-track");
		const fill = track.createDiv(`ai-progress-fill ai-progress-fill-${statusKey}`);
		fill.style.width = `${percent}%`;
		if (statusKey === "running") fill.addClass("is-animated");
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