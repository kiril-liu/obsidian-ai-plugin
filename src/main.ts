import { Notice, Platform, Plugin, WorkspaceLeaf } from "obsidian";
import { AiClient } from "./ai/AiClient";
import { EmbeddingClient } from "./ai/EmbeddingClient";
import { registerDailyCommands } from "./commands/dailyCommands";
import { registerNoteCommands } from "./commands/noteCommands";
import { registerPromptCommands } from "./commands/promptCommands";
import { registerVaultCommands } from "./commands/vaultCommands";
import { registerWorkflowCommands } from "./commands/workflowCommands";
import { DailyNoteManager } from "./daily/DailyNoteManager";
import { PromptRunHistory } from "./history/PromptRunHistory";
import { IndexStorage } from "./index/IndexStorage";
import { ProgressTracker } from "./progress/ProgressTracker";
import { PromptManager } from "./prompts/PromptManager";
import { HybridSearch } from "./rag/HybridSearch";
import { KeywordSearch } from "./rag/KeywordSearch";
import { VectorStore } from "./rag/VectorStore";
import { VaultIndexer } from "./rag/VaultIndexer";
import { DEFAULT_SETTINGS, AiSettingsTab } from "./settings";
import { AiPluginSettings, ChatConversation, ChatMessage, IndexLogEntry, PluginData } from "./types";
import { AI_CHAT_VIEW_TYPE, AiChatView } from "./views/AiChatView";
import { BatchPromptRunner } from "./workflows/BatchPromptRunner";
import { PromptCommandRegistry } from "./workflows/PromptCommandRegistry";

export default class AiPlugin extends Plugin {
	settings: AiPluginSettings;
	loadedData: PluginData = {};

	aiClient: AiClient;
	embeddingClient: EmbeddingClient;
	keywordSearch: KeywordSearch;
	vectorStore: VectorStore;
	vaultIndexer: VaultIndexer;
	indexStorage: IndexStorage;
	hybridSearch: HybridSearch;
	promptManager: PromptManager;
	progressTracker: ProgressTracker;
	dailyNoteManager: DailyNoteManager;
	promptRunHistory: PromptRunHistory;
	promptCommandRegistry: PromptCommandRegistry;
	batchPromptRunner: BatchPromptRunner;

	chatHistory: ChatMessage[] = [];
	chatConversations: ChatConversation[] = [];
	activeChatId: string | null = null;
	indexLogs: IndexLogEntry[] = [];
	lastIndexError = "";

	async onload() {
		this.loadedData = (await this.loadData()) ?? {};
		this.settings = { ...DEFAULT_SETTINGS, ...(this.loadedData.settings ?? {}) };
		this.chatHistory = this.loadedData.chatHistory ?? [];
		this.chatConversations = this.loadedData.chatConversations ?? [];
		this.activeChatId = this.loadedData.activeChatId ?? null;
		this.indexLogs = this.loadedData.indexLogs ?? [];
		this.lastIndexError = this.loadedData.lastIndexError ?? "";

		this.aiClient = new AiClient(this);
		this.embeddingClient = new EmbeddingClient(this);
		this.keywordSearch = new KeywordSearch(this);
		this.vectorStore = new VectorStore();
		this.indexStorage = new IndexStorage(this);
		this.hybridSearch = new HybridSearch(this);
		this.vaultIndexer = new VaultIndexer(this);
		this.promptManager = new PromptManager(this);
		this.progressTracker = new ProgressTracker(this);
		this.dailyNoteManager = new DailyNoteManager(this);
		this.promptRunHistory = new PromptRunHistory(this);
		this.promptRunHistory.load(this.loadedData.promptRunHistory ?? []);
		this.promptCommandRegistry = new PromptCommandRegistry(this);
		this.batchPromptRunner = new BatchPromptRunner(this);

		this.registerView(AI_CHAT_VIEW_TYPE, (leaf: WorkspaceLeaf) => new AiChatView(leaf, this));

		registerNoteCommands(this);
		registerVaultCommands(this);
		registerPromptCommands(this);
		registerDailyCommands(this);
		registerWorkflowCommands(this);

		this.addSettingTab(new AiSettingsTab(this.app, this));

		await this.vaultIndexer.loadIndexOnStartup();

		if (this.settings.enablePromptCommandRegistration) {
			await this.promptCommandRegistry.registerPromptTemplateCommands();
		}

		if (this.settings.autoUpdateIndexOnStartup) {
			setTimeout(() => this.vaultIndexer.updateVectorIndex(), 2000);
		}

		new Notice("AI Copilot 已加载");
	}

	onunload() {
		this.app.workspace.detachLeavesOfType(AI_CHAT_VIEW_TYPE);
	}

	async saveSettings() {
		await this.saveAllData();
	}

	async saveAllData() {
		await this.saveData({
			settings: this.settings,
			vectorIndex: this.settings.enableExternalIndexStorage ? null : this.vectorStore.getIndex(),
			chatHistory: this.chatHistory,
			chatConversations: this.chatConversations,
			activeChatId: this.activeChatId ?? undefined,
			indexLogs: this.indexLogs,
			lastIndexError: this.lastIndexError,
			promptRunHistory: this.promptRunHistory.entries,
		});
	}

	addChatMessage(role: "你" | "AI", content: string) {
		this.chatHistory.push({
			role,
			content,
			createdAt: new Date().toISOString(),
		});

		if (this.chatHistory.length > this.settings.chatHistoryMaxMessages) {
			this.chatHistory = this.chatHistory.slice(this.chatHistory.length - this.settings.chatHistoryMaxMessages);
		}

		this.syncActiveConversation();
		this.saveAllData();
		this.refreshChatViews();
	}

	addIndexLog(level: "info" | "warn" | "error", message: string) {
		this.indexLogs.push({
			level,
			message,
			createdAt: new Date().toISOString(),
		});

		if (this.indexLogs.length > this.settings.indexLogMaxEntries) {
			this.indexLogs = this.indexLogs.slice(this.indexLogs.length - this.settings.indexLogMaxEntries);
		}

		this.saveAllData();
	}

	shouldExcludePath(path: string) {
		const excluded = this.settings.excludedFolders
			.split(",")
			.map((item) => item.trim())
			.filter(Boolean);

		return excluded.some((folder) => path.startsWith(folder + "/") || path === folder);
	}

	limitText(text: string, max = 12000) {
		if (text.length <= max) return text;
		return text.slice(0, max) + "\n\n……内容过长，已截断。";
	}

	async activateChatView() {
		const leaves = this.app.workspace.getLeavesOfType(AI_CHAT_VIEW_TYPE);

		if (leaves.length > 0) {
			this.app.workspace.revealLeaf(leaves[0]);
			return;
		}

		// 手机端：在主区域整屏打开（配合 CSS 从底部滑入）；桌面端：右侧边栏
		const leaf = Platform.isMobile
			? this.app.workspace.getLeaf(true)
			: this.app.workspace.getRightLeaf(false);

		if (!leaf) return;

		await leaf.setViewState({ type: AI_CHAT_VIEW_TYPE, active: true });
		this.app.workspace.revealLeaf(leaf);
	}

	refreshChatViews() {
		for (const leaf of this.app.workspace.getLeavesOfType(AI_CHAT_VIEW_TYPE)) {
			const view = leaf.view;
			if (view instanceof AiChatView) view.renderMessages();
		}
	}

	refreshProgressViews() {
		for (const leaf of this.app.workspace.getLeavesOfType(AI_CHAT_VIEW_TYPE)) {
			const view = leaf.view;
			if (view instanceof AiChatView) view.renderProgress();
		}
	}

	ensureActiveConversation(): ChatConversation {
		let conversation = this.chatConversations.find((item) => item.id === this.activeChatId);

		if (!conversation) {
			const now = new Date().toISOString();
			conversation = {
				id: this.createConversationId(),
				title: "",
				messages: [],
				createdAt: now,
				updatedAt: now,
			};
			this.chatConversations.push(conversation);
			this.activeChatId = conversation.id;
		}

		return conversation;
	}

	syncActiveConversation() {
		const conversation = this.ensureActiveConversation();
		conversation.messages = [...this.chatHistory];
		conversation.updatedAt = new Date().toISOString();

		if (!conversation.title) {
			const firstUser = this.chatHistory.find((message) => message.role === "你");
			if (firstUser) conversation.title = firstUser.content.split("\\n")[0].slice(0, 50);
		}
	}

	async startNewChatConversation() {
		this.syncActiveConversation();

		const now = new Date().toISOString();
		const conversation: ChatConversation = {
			id: this.createConversationId(),
			title: "",
			messages: [],
			createdAt: now,
			updatedAt: now,
		};

		this.chatConversations.push(conversation);
		this.activeChatId = conversation.id;
		this.chatHistory = [];

		await this.saveAllData();
		this.refreshChatViews();
	}

	async restoreChatConversation(id: string) {
		this.syncActiveConversation();

		const conversation = this.chatConversations.find((item) => item.id === id);
		if (!conversation) return;

		this.activeChatId = conversation.id;
		this.chatHistory = [...conversation.messages];

		await this.saveAllData();
		this.refreshChatViews();
	}

	createConversationId() {
		return `chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
	}
}