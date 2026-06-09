import { App, Component, ItemView, MarkdownRenderer, MarkdownView, Modal, Notice, TFile, WorkspaceLeaf, setIcon } from "obsidian";
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

export class ChatPanel {
	plugin: AiPlugin;
	app: App;
	host: Component;
	containerEl: HTMLElement;
	messagesEl: HTMLElement;
	inputEl: HTMLTextAreaElement;
	sourcesEl: HTMLElement;
	statusEl: HTMLElement;
	useRag = false;
	useCurrentNote = true;
	vaultSearchButtonEl: HTMLButtonElement;
	progressPercentEl: HTMLElement;
	sendButtonEl: HTMLButtonElement;
	lastMarkdownView: MarkdownView | null = null;
	activePromptName = "普通提问";
	promptFileButtonEl: HTMLButtonElement;
	selectedPromptFile: string | null = null;
	selectedPromptName: string | null = null;
	promptTemplates: PromptTemplate[] = [];
	noteActionManager: NoteActionManager;
	renderedMessages: ChatMessage[] = [];
	// 是否已经渲染过一次消息：首次打开聊天框（含挂载时已有历史）按“看最新”处理，滚到底部
	hasRenderedMessages = false;
	// 置顶只做一次：为 true 时本次 renderMessages 不再强制滚动，用于 AI 回答结束后保留用户流式过程中的滚动位置
	suppressAutoScroll = false;
	keyboardShowHandler: ((event: Event) => void) | null = null;
	keyboardHideHandler: (() => void) | null = null;

	constructor(plugin: AiPlugin, host: Component, app: App) {
		this.plugin = plugin;
		this.host = host;
		this.app = app;
		this.noteActionManager = new NoteActionManager(app);
		// 记住上次「关联当前笔记」开关：从设置读取，跨打开/重启保留
		this.useCurrentNote = plugin.settings.linkCurrentNote ?? true;
	}

	mount(containerEl: HTMLElement) {
		this.containerEl = containerEl;
		containerEl.empty();
		containerEl.addClass("ai-chat-view");

		this.rememberCurrentMarkdownView();
		this.host.registerEvent(
			this.app.workspace.on("active-leaf-change", () => {
				this.rememberCurrentMarkdownView();
				this.renderContextStatus();
			})
		);

		const headerEl = containerEl.createDiv("ai-chat-header");
		const titleRow = headerEl.createDiv("ai-chat-title-row");

		const historyButton = titleRow.createEl("button", {
			cls: "clickable-icon ai-chat-icon-button ai-chat-history-button",
		});
		setIcon(historyButton, "history");
		historyButton.setAttribute("aria-label", "历史对话");
		historyButton.onclick = () => new ChatHistoryModal(this.app, this.plugin).open();

		const newButton = titleRow.createEl("button", {
			cls: "clickable-icon ai-chat-icon-button ai-chat-new-button",
		});
		setIcon(newButton, "message-square-plus");
		newButton.setAttribute("aria-label", "新建对话");
		newButton.onclick = async () => {
			await this.plugin.startNewChatConversation();
			this.renderMessages();
			this.renderSources([]);
			this.renderContextStatus();
		};

		this.statusEl = titleRow.createDiv("ai-chat-context-status");

		this.vaultSearchButtonEl = titleRow.createEl("button", {
			cls: "clickable-icon ai-chat-icon-button ai-chat-vault-button",
		});
		setIcon(this.vaultSearchButtonEl, "search");
		this.attachTapAndLongPress(
			this.vaultSearchButtonEl,
			() => this.setUseRag(!this.useRag),
			() => this.plugin.openVaultSearchSettings()
		);

		this.progressPercentEl = titleRow.createSpan({ cls: "ai-chat-progress-percent" });
		this.renderVaultSearchButton();

		this.promptFileButtonEl = titleRow.createEl("button", {
			cls: "clickable-icon ai-chat-icon-button ai-chat-prompt-file-button",
		});
		this.promptFileButtonEl.onclick = () => this.openPromptPicker();
		this.renderPromptFileButton();

		const bodyEl = containerEl.createDiv("ai-chat-body");
		this.messagesEl = bodyEl.createDiv("ai-chat-messages");
		this.sourcesEl = bodyEl.createDiv("ai-chat-sources");

		const inputArea = containerEl.createDiv("ai-chat-input-area");

		this.inputEl = inputArea.createEl("textarea", {
			cls: "ai-chat-input",
			placeholder: "输入问题，例如：总结这个页面，或输入 /每日复盘 调用 Prompt",
		});

		this.inputEl.addEventListener("keydown", async (event) => {
			if (event.key === "Enter" && !event.shiftKey) {
				event.preventDefault();
				await this.send(this.useRag);
			}
		});

		// 发送/取消图标收进输入框方框内（底部靠右），不再单独占一行
		const inputActions = inputArea.createDiv("ai-chat-input-actions");

		const cancelButton = inputActions.createEl("button", {
			cls: "clickable-icon ai-chat-icon-button ai-chat-cancel-button",
		});
		setIcon(cancelButton, "x");
		cancelButton.setAttribute("aria-label", "取消");
		cancelButton.onclick = () => this.plugin.progressTracker.cancel();

		this.sendButtonEl = inputActions.createEl("button", {
			cls: "clickable-icon ai-chat-icon-button ai-chat-send-button",
		});
		setIcon(this.sendButtonEl, "send");
		this.sendButtonEl.setAttribute("aria-label", "发送");
		this.sendButtonEl.onclick = () => this.send(this.useRag);

		this.renderContextStatus();
		this.renderProgress();
		this.renderMessages();
		this.renderSources([]);

		this.plugin.registerChatPanel(this);
	}

	unmount() {
		if (this.keyboardShowHandler) {
			window.removeEventListener("keyboardWillShow", this.keyboardShowHandler);
			window.removeEventListener("keyboardDidShow", this.keyboardShowHandler);
			this.keyboardShowHandler = null;
		}
		if (this.keyboardHideHandler) {
			window.removeEventListener("keyboardWillHide", this.keyboardHideHandler);
			window.removeEventListener("keyboardDidHide", this.keyboardHideHandler);
			this.keyboardHideHandler = null;
		}
		this.plugin.unregisterChatPanel(this);
	}

	// 手机端：让输入栏浮动并随键盘高度上移。
	// 安卓 Obsidian webview 下键盘是“覆盖式”弹出，visualViewport / VirtualKeyboard 都拿不到高度；
	// 唯一可靠来源是 Capacitor 在 window 上派发的原生键盘事件（携带 keyboardHeight，单位 px）。
	// 快速切换的输入框就是靠它浮起的，这里只监听这组事件，不再做任何兜底重算。
	enableKeyboardFloating() {
		if (!this.containerEl) return;

		this.keyboardShowHandler = (event: Event) => {
			const height = (event as any).keyboardHeight;
			this.containerEl.setCssProps({
				"--ai-chat-keyboard-height": `${Math.max(0, Math.round(height || 0))}px`,
			});
		};
		this.keyboardHideHandler = () => {
			this.containerEl.setCssProps({ "--ai-chat-keyboard-height": "0px" });
		};

		window.addEventListener("keyboardWillShow", this.keyboardShowHandler);
		window.addEventListener("keyboardDidShow", this.keyboardShowHandler);
		window.addEventListener("keyboardWillHide", this.keyboardHideHandler);
		window.addEventListener("keyboardDidHide", this.keyboardHideHandler);
	}

	async send(useRag = false) {
		if (this.plugin.progressTracker.getState()?.active) {
			new Notice("AI 正在响应，请稍候…");
			return;
		}

		const selectedPrompt = this.selectedPromptName ?? "";

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
			// 发送后清除已选提示词：恢复输入框占位，提示词只对本次发送生效，不会一直挂在输入框
			this.setSelectedPrompt(null, null);
			return;
		}

		const question = this.inputEl.value.trim();
		if (!question) return;

		this.rememberCurrentMarkdownView();
		this.inputEl.value = "";
		await this.plugin.addChatMessage("你", question);
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
			// 立即把发送按钮置灰：Modal 面板不一定收到 tracker 的刷新回调，这里对当前面板主动刷新
			this.renderProgress();
			this.plugin.progressTracker.setStep("准备上下文");

			const currentNoteContext = this.useCurrentNote ? await this.getCurrentNoteContext() : null;
			let contextText = "";
			let sourcesMarkdown = "";
			let sources: any[] = [];

			// Embedding 总开关：关闭时不做任何向量化，对话语义检索与 Vault 检索一并关闭（两者都依赖 Embedding）
			const embeddingEnabled = this.plugin.settings.enableEmbedding ?? false;
			// 对话语义检索默认关闭：关闭时不对提问做 Embedding，仅按最近 N 条对话提供上下文，避免每条消息都走 API 变慢
			const useConversationRetrieval = embeddingEnabled && (this.plugin.settings.enableConversationRetrieval ?? false);

			// 当前问题只 embed 一次，会话记忆检索与 Vault 检索共用；仅在需要时（对话检索开启或 Vault 检索）才发起 Embedding
			let questionEmbedding: number[] | null = null;
			if (useConversationRetrieval || (useRag && embeddingEnabled)) {
				try {
					questionEmbedding = (await this.plugin.embeddingClient.embed([question], signal))[0] ?? null;
				} catch (error) {
					questionEmbedding = null;
				}
			}

			// 最近 N 条窗口：保证局部连贯性与指代消解（chatHistory 已截断到 N，末尾是刚加入的当前问题，单独展示故去掉）
			const recentMessages = this.plugin.chatHistory.slice(0, -1);
			const recentTexts = new Set(recentMessages.map((message) => message.content));
			const recentText = recentMessages.map((message) => `${message.role}：${message.content}`).join("\n\n");

			// 会话记忆：在当前会话独立向量库里检索相关历史（与 Vault 索引隔离，不跨会话）
			// 去重：已经在“最近 N 条窗口”里的消息不再重复进入语义记忆
			let memoryText = "";
			if (useConversationRetrieval && questionEmbedding) {
				const conversation = this.plugin.ensureActiveConversation();
				const memoryHits = this.plugin.chatMemory
					.search(
						conversation,
						questionEmbedding,
						this.plugin.settings.chatHistoryMaxMessages,
						question
					)
					.filter((hit) => !recentTexts.has(hit.text));
				memoryText = this.plugin.chatMemory.formatForPrompt(memoryHits);
			}

			// Vault 检索（语义/索引）依赖 Embedding：关闭 Embedding 时直接跳过检索，不再退化为关键词检索
			if (useRag && embeddingEnabled) {
				this.plugin.progressTracker.setStep("检索 Vault");

				try {
					const index = this.plugin.vectorStore.getIndex();

					if (index && index.chunks.length > 0) {
						const queryEmbedding = questionEmbedding ?? (await this.plugin.embeddingClient.embed([question], signal))[0];
						let results = this.plugin.vectorStore.search(queryEmbedding, this.plugin.settings.vectorSearchMaxResults);

						if (this.plugin.settings.enableHybridSearch) {
							results = await this.plugin.hybridSearch.search(question, results);
						}

						sources = SourceFormatter.fromResults(results);
					}
				} catch (error) {
					sources = [];
				}

				contextText = SourceFormatter.toContextText(sources);
				sourcesMarkdown = SourceFormatter.toMarkdown(sources);
				this.renderSources(sources);
			} else {
				this.renderSources([]);
			}

			const prompt = [
				useRag ? "请结合当前笔记和参考资料回答。" : "请结合当前笔记回答用户问题。如果当前笔记上下文为空，则直接回答用户问题。",
				this.noteActionInstruction(),
				currentNoteContext ? this.formatCurrentNoteContext(currentNoteContext) : "",
				contextText ? `Vault 参考资料：\n${contextText}` : "",
				memoryText ? `相关对话记忆（来自本会话历史，语义检索，已排除下方最近对话，按时间先后排序）：\n${memoryText}` : "",
				recentText ? `最近对话（最近 ${recentMessages.length} 条，用于保持连贯性）：\n${recentText}` : "",
				`用户问题：\n${question}`,
			]
				.filter(Boolean)
				.join("\n\n");

			this.plugin.progressTracker.setStep("调用 AI");

			// 流式输出：先建一个临时气泡，token 到达时实时更新
			const streamEl = this.messagesEl.createDiv("ai-chat-message ai-chat-message-ai is-streaming");
			const streamBubble = streamEl.createDiv("ai-chat-bubble");
			this.scrollLatestUserMessageToTop();

			let answer = "";
			await this.plugin.aiClient.chatStream(prompt, signal, (full) => {
				answer = full;
				const { cleaned } = NoteActionManager.parse(full);
				streamBubble.setText(cleaned || full);
				// 不再每个 token 都置顶：发送时已置顶一次，AI 回答期间让用户能自由滚动查看流式输出
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
			// 回答结束后不要把消息重新顶到顶部，保留用户在流式过程中的滚动位置
			this.suppressAutoScroll = true;
			this.renderMessages();
			this.renderProgress();
			this.renderContextStatus();
		} catch (error) {
			const friendly = ErrorFormatter.fromUnknown(error);
			this.plugin.progressTracker.fail(friendly.message);
			new Notice(ErrorFormatter.toNoticeText(friendly));
			this.renderMessages();
			this.renderProgress();
		}
	}

	renderContextStatus() {
		if (!this.statusEl) return;

		this.statusEl.empty();

		const markdownView = this.findCurrentMarkdownView();
		const file = markdownView?.file instanceof TFile ? markdownView.file : null;

		// 关联当前笔记开关：放在文件名旁边，控制是否把当前笔记作为上下文
		const noteLinkButton = this.statusEl.createEl("button", {
			cls: "clickable-icon ai-chat-icon-button ai-chat-note-link-button",
		});
		setIcon(noteLinkButton, this.useCurrentNote ? "link" : "unlink");
		noteLinkButton.toggleClass("is-active", this.useCurrentNote);
		noteLinkButton.setAttribute(
			"aria-label",
			this.useCurrentNote ? "已关联当前笔记（点击关闭）" : "未关联当前笔记（点击开启）"
		);
		noteLinkButton.onclick = (event) => {
			event.stopPropagation();
			this.setUseCurrentNote(!this.useCurrentNote);
		};

		// 极简单行：仅灰色文件名（去掉后缀、无图标无方框）；完整路径放在 tooltip
		this.statusEl.createSpan({
			text: file ? file.basename : "未检测到笔记",
			cls: "ai-chat-context-value",
		});

		this.statusEl.setAttribute("aria-label", file ? file.path : "未检测到 Markdown 笔记");
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
		setIcon(this.promptFileButtonEl, "library");
		const fileName = this.getPromptFileName(this.selectedPromptFile);
		const promptName = this.selectedPromptName ?? "无";
		this.promptFileButtonEl.setAttribute("aria-label", `提示词文件：${fileName}　提示词：${promptName}`);
		this.promptFileButtonEl.toggleClass("is-active", !!this.selectedPromptName);
	}

	async openPromptPicker() {
		const templates = await this.plugin.promptManager.loadTemplates(true);
		this.promptTemplates = templates;

		if (templates.length === 0) {
			new Notice("没有找到任何提示词文件，请先在设置中创建 Prompt Library");
			return;
		}

		new PromptPickerModal(this.app, this).open();
	}

	setSelectedPrompt(file: string | null, name: string | null) {
		this.selectedPromptFile = file;
		this.selectedPromptName = name;
		this.activePromptName = name ?? (this.useRag ? "普通提问 + Vault 检索" : "普通提问");
		// 选中提示词后给输入框一个占位提示：可补充说明，留空则直接运行
		if (this.inputEl) {
			this.inputEl.placeholder = name
				? `已选提示词「${name}」：可补充说明后发送，留空则直接运行`
				: "输入问题，例如：总结这个页面，或输入 /每日复盘 调用 Prompt";
		}
		this.renderPromptFileButton();
		this.renderContextStatus();
	}

	setUseCurrentNote(value: boolean) {
		this.useCurrentNote = value;
		// 持久化，使下次打开（含手机端新弹层）沿用上次的值
		this.plugin.settings.linkCurrentNote = value;
		void this.plugin.saveSettings();
		this.renderContextStatus();
	}

	setUseRag(value: boolean) {
		// Embedding 关闭时 Vault 检索不可用（索引与检索都依赖 Embedding）
		if (value && !(this.plugin.settings.enableEmbedding ?? false)) {
			new Notice("Vault 检索需要先在设置中开启 Embedding");
			this.useRag = false;
			this.renderVaultSearchButton();
			this.renderContextStatus();
			return;
		}
		this.useRag = value;
		if (!this.selectedPromptName) {
			this.activePromptName = value ? "普通提问 + Vault 检索" : "普通提问";
		}
		this.renderVaultSearchButton();
		this.renderContextStatus();
	}

	renderVaultSearchButton() {
		if (!this.vaultSearchButtonEl) return;
		const embeddingEnabled = this.plugin.settings.enableEmbedding ?? false;
		this.vaultSearchButtonEl.toggleClass("is-active", this.useRag && embeddingEnabled);
		this.vaultSearchButtonEl.toggleClass("is-disabled", !embeddingEnabled);
		this.vaultSearchButtonEl.setAttribute(
			"aria-label",
			!embeddingEnabled
				? "Vault 检索：需先开启 Embedding（长按/右键设置）"
				: this.useRag
					? "Vault 检索：开（长按/右键设置）"
					: "Vault 检索：关（长按/右键设置）"
		);
	}

	attachTapAndLongPress(el: HTMLElement, onTap: () => void, onLongPress: () => void) {
		let timer: number | null = null;
		let longFired = false;

		const cancel = () => {
			if (timer !== null) {
				window.clearTimeout(timer);
				timer = null;
			}
		};

		el.addEventListener(
			"touchstart",
			() => {
				longFired = false;
				timer = window.setTimeout(() => {
					longFired = true;
					timer = null;
					onLongPress();
				}, 500);
			},
			{ passive: true }
		);
		el.addEventListener("touchmove", cancel);
		el.addEventListener("touchcancel", cancel);
		el.addEventListener("touchend", cancel);

		el.addEventListener("click", (event) => {
			if (longFired) {
				longFired = false;
				event.preventDefault();
				return;
			}
			onTap();
		});

		el.addEventListener("contextmenu", (event) => {
			event.preventDefault();
			onLongPress();
		});
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

		let rebuilt = false;
		if (commonPrefix === rendered.length && domCount === rendered.length) {
			// DOM 与历史前缀一致：只追加新增的消息
			for (let i = commonPrefix; i < history.length; i++) {
				this.renderMessage(history[i]);
			}
		} else {
			// 历史被替换 / 清空 / 截断 / 视图重建：整体重建
			rebuilt = true;
			this.messagesEl.empty();
			for (const message of history) {
				this.renderMessage(message);
			}
		}

		this.renderedMessages = [...history];

		// 首次渲染（首次打开聊天框，包括挂载时已有历史）也按“看最新”处理
		const isFirstRender = !this.hasRenderedMessages;
		this.hasRenderedMessages = true;

		// 整体重建（如恢复历史对话）或首次打开：滚到底部显示最新消息；
		// 增量追加（正常提问）：把最新提问顶到顶部，便于阅读其下方的回答。
		// suppressAutoScroll 为 true 时（如 AI 回答结束后）不强制滚动，保留用户当前滚动位置。
		const suppress = this.suppressAutoScroll;
		this.suppressAutoScroll = false;
		if (rebuilt || isFirstRender) {
			this.scrollToBottom();
		} else if (!suppress) {
			this.scrollLatestUserMessageToTop();
		}
	}

	// 找到真正发生滚动的容器：从消息区向上找第一个可滚动祖先
	// （桌面通常是消息区本身，手机弹层里可能是 .ai-chat-body），找不到则退回消息区。
	getScrollContainer(): HTMLElement {
		let el: HTMLElement | null = this.messagesEl;
		while (el && el !== document.body) {
			const overflowY = getComputedStyle(el).overflowY;
			if (
				(overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay") &&
				el.scrollHeight > el.clientHeight
			) {
				return el;
			}
			el = el.parentElement;
		}
		return this.messagesEl;
	}

	// 顶部/底部留白：直接读取消息区的 padding-bottom（CSS 单一来源），
	// 这样“我的消息距顶部”与“AI 回答距底部”用的是同一个值，改 CSS 即可同步调整。
	getEdgeGap(): number {
		const pad = parseFloat(getComputedStyle(this.messagesEl).paddingBottom);
		return Number.isFinite(pad) && pad > 0 ? pad : 14;
	}

	scrollLatestUserMessageToTop() {
		if (!this.messagesEl) return;

		// 先清掉旧的底部占位，量出真实内容高度
		this.messagesEl.querySelectorAll(".ai-chat-scroll-spacer").forEach((el) => el.remove());

		const userMessages = this.messagesEl.querySelectorAll<HTMLElement>(".ai-chat-message-user");
		const last = userMessages[userMessages.length - 1];
		const scroller = this.getScrollContainer();

		if (!last) {
			scroller.scrollTop = 0;
			return;
		}

		const gap = this.getEdgeGap();
		// 最新消息在滚动容器内容里的绝对偏移（不受当前滚动位置影响）
		const offsetWithinScroller =
			last.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
		// 不贴顶，留出和底部相同的一点点距离
		const targetTop = Math.max(0, offsetWithinScroller - gap);

		// 要让最新消息能停在距顶部 gap 处，需要 scrollHeight >= targetTop + clientHeight。
		// 内容不够时，补一个底部占位块。
		const needed = targetTop + scroller.clientHeight - scroller.scrollHeight;

		if (needed > 0) {
			const spacer = this.messagesEl.createDiv("ai-chat-scroll-spacer");
			spacer.setCssStyles({ height: `${needed}px` });
		}

		scroller.scrollTop = targetTop;
	}

	// 滚动到消息区底部（用于恢复历史对话/首次打开：直接看到最新的 AI 回答，
	// 回答结尾停在底部偏上一点点——底部留白由消息区的 padding-bottom 提供，与顶部留白相等）
	scrollToBottom() {
		if (!this.messagesEl) return;

		this.messagesEl.querySelectorAll(".ai-chat-scroll-spacer").forEach((el) => el.remove());

		const target = this.getScrollContainer();
		const toBottom = () => {
			target.scrollTop = target.scrollHeight;
		};

		// Markdown 异步渲染会持续改变高度，单帧滚动经常停不到底。
		// 连续多帧 + ResizeObserver 监听高度变化，在布局稳定前持续贴底。
		toBottom();
		let frame = 0;
		const tick = () => {
			toBottom();
			if (frame++ < 8) window.requestAnimationFrame(tick);
		};
		window.requestAnimationFrame(tick);

		if (typeof ResizeObserver !== "undefined") {
			const observer = new ResizeObserver(() => toBottom());
			observer.observe(target);
			// 监听一小段时间后断开，避免长期占用并干扰用户手动滚动
			window.setTimeout(() => observer.disconnect(), 600);
		}
	}

	renderMessage(message: ChatMessage) {
		const isUser = message.role === "你";
		const el = this.messagesEl.createDiv(
			isUser ? "ai-chat-message ai-chat-message-user" : "ai-chat-message ai-chat-message-ai"
		);

		const bubble = el.createDiv("ai-chat-bubble");

		if (message.role === "AI") {
			MarkdownRenderer.render(this.app, message.content, bubble, "", this.host);

			const isStatus = message.content.startsWith("✅ ") || message.content.startsWith("⚠️ ");

			if (!isStatus) {
				const actions = el.createDiv("ai-chat-message-actions");

				const insertButton = actions.createEl("button", {
					cls: "clickable-icon ai-chat-icon-button ai-chat-message-action",
				});
				setIcon(insertButton, "text-cursor-input");
				insertButton.setAttribute("aria-label", "插入到光标");
				insertButton.onclick = () => {
					this.insertAnswerAtCursor(message.content);
				};

				const copyButton = actions.createEl("button", {
					cls: "clickable-icon ai-chat-icon-button ai-chat-message-action",
				});
				setIcon(copyButton, "copy");
				copyButton.setAttribute("aria-label", "复制");
				copyButton.onclick = async () => {
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
		if (!this.progressPercentEl) return;

		const state = this.plugin.progressTracker.getState();
		const busy = !!(state && state.active);

		// AI 响应未结束前，发送图标置灰且不可用
		if (this.sendButtonEl) {
			this.sendButtonEl.disabled = busy;
			this.sendButtonEl.toggleClass("is-disabled", busy);
		}

		// 空闲时不显示百分比；运行中仅在 Vault 检索图标旁显示百分比
		if (!state || !state.active) {
			this.progressPercentEl.setText("");
			this.progressPercentEl.removeClass("is-active");
			return;
		}

		const total = state.steps.length;
		const doneCount = state.steps.filter((step) => step.status === "done").length;
		const runningStep = state.steps.find((step) => step.status === "running");
		const percent = total
			? Math.round(((doneCount + (runningStep ? 0.5 : 0)) / total) * 100)
			: 0;
		const clamped = Math.max(0, Math.min(100, percent));

		this.progressPercentEl.addClass("is-active");
		this.progressPercentEl.setText(`${clamped}%`);
		this.progressPercentEl.setAttribute("aria-label", state.currentStep ?? state.title);
	}

	iconForStatus(status: string) {
		if (status === "done") return "✓";
		if (status === "running") return "…";
		if (status === "failed") return "!";
		if (status === "cancelled") return "×";
		return "○";
	}
}

export class AiChatView extends ItemView {
	plugin: AiPlugin;
	panel: ChatPanel;

	constructor(leaf: WorkspaceLeaf, plugin: AiPlugin) {
		super(leaf);
		this.plugin = plugin;
		this.panel = new ChatPanel(plugin, this, this.app);
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
		this.panel.mount(this.containerEl.children[1] as HTMLElement);
	}

	async onClose() {
		this.panel.unmount();
	}
}

export class AiChatModal extends Modal {
	plugin: AiPlugin;
	host: Component;
	panel: ChatPanel;

	constructor(app: App, plugin: AiPlugin) {
		super(app);
		this.plugin = plugin;
		this.host = new Component();
		this.panel = new ChatPanel(plugin, this.host, app);
	}

	onOpen() {
		this.host.load();
		this.modalEl.addClass("ai-chat-modal");
		this.panel.mount(this.contentEl);
		// 手机端：输入栏浮动并随键盘高度上移
		this.panel.enableKeyboardFloating();
		// 打开后自动把光标聚焦到输入框（类似快速切换）
		window.setTimeout(() => this.panel.inputEl?.focus(), 0);
	}

	onClose() {
		this.panel.unmount();
		this.host.unload();
		this.contentEl.empty();
	}
}

export class PromptPickerModal extends Modal {
	panel: ChatPanel;
	selectedFile: string | null;

	constructor(app: App, panel: ChatPanel) {
		super(app);
		this.panel = panel;
		this.selectedFile = panel.selectedPromptFile;
	}

	onOpen() {
		this.modalEl.addClass("ai-prompt-picker-modal");
		this.render();
	}

	render() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("ai-prompt-picker");

		contentEl.createEl("h2", { text: "提示词" });

		// 上半部分：提示词文件路径
		const fileSection = contentEl.createDiv("ai-prompt-picker-section");
		fileSection.createEl("div", { text: "提示词文件", cls: "ai-prompt-picker-label" });
		const fileList = fileSection.createDiv("ai-prompt-picker-files");

		const files = Array.from(new Set(this.panel.promptTemplates.map((template) => template.sourcePath))).sort((a, b) =>
			a.localeCompare(b)
		);

		const noneFileItem = fileList.createDiv("ai-prompt-picker-file-item");
		noneFileItem.setText("无（普通提问）");
		if (this.selectedFile === null) noneFileItem.addClass("is-selected");
		noneFileItem.onclick = () => {
			this.selectedFile = null;
			this.panel.setSelectedPrompt(null, null);
			this.close();
		};

		for (const file of files) {
			const fileItem = fileList.createDiv("ai-prompt-picker-file-item");
			fileItem.setText(this.panel.getPromptFileName(file));
			if (this.selectedFile === file) fileItem.addClass("is-selected");
			fileItem.onclick = () => {
				this.selectedFile = file;
				this.render();
			};
		}

		// 下半部分：该文件下的提示词
		const promptSection = contentEl.createDiv("ai-prompt-picker-section");
		promptSection.createEl("div", { text: "选择提示词", cls: "ai-prompt-picker-label" });
		const promptList = promptSection.createDiv("ai-prompt-picker-prompts");

		if (this.selectedFile === null) {
			promptList.createEl("div", {
				text: "请先选择上方的提示词文件以查看可用提示词。",
				cls: "ai-prompt-picker-empty",
			});
			return;
		}

		const names = this.panel.promptTemplates
			.filter((template) => template.sourcePath === this.selectedFile)
			.map((template) => template.name);

		if (names.length === 0) {
			promptList.createEl("div", {
				text: "该文件中没有可用的提示词。",
				cls: "ai-prompt-picker-empty",
			});
			return;
		}

		for (const name of names) {
			const promptItem = promptList.createDiv("ai-prompt-picker-prompt-item");
			promptItem.setText(name);
			if (this.panel.selectedPromptName === name && this.panel.selectedPromptFile === this.selectedFile) {
				promptItem.addClass("is-selected");
			}
			promptItem.onclick = () => {
				this.panel.setSelectedPrompt(this.selectedFile, name);
				this.close();
			};
		}
	}

	onClose() {
		this.contentEl.empty();
	}
}