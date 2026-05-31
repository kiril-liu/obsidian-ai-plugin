import { Notice, Plugin, WorkspaceLeaf } from "obsidian";
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
import {
  AiPluginSettings,
  ChatConversation,
  ChatMessage,
  IndexLogEntry,
  PluginData,
} from "./types";
import { AI_CHAT_VIEW_TYPE, AiChatView } from "./views/AiChatView";
import { BatchPromptRunner } from "./workflows/BatchPromptRunner";
import { PromptCommandRegistry } from "./workflows/PromptCommandRegistry";

export default class AiPlugin extends Plugin {
  settings: AiPluginSettings;
  loadedData: PluginData | null = null;

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
  activeChatId = "";
  indexLogs: IndexLogEntry[] = [];
  lastIndexError = "";

  async onload() {
    const data = ((await this.loadData()) ?? {}) as PluginData;
    this.loadedData = data;

    this.settings = { ...DEFAULT_SETTINGS, ...(data.settings ?? {}) };
    this.chatHistory = data.chatHistory ?? [];
    this.chatConversations = data.chatConversations ?? [];
    this.activeChatId = data.activeChatId ?? "";
    this.indexLogs = data.indexLogs ?? [];
    this.lastIndexError = data.lastIndexError ?? "";

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
    this.promptRunHistory.load(data.promptRunHistory ?? []);
    this.promptCommandRegistry = new PromptCommandRegistry(this);
    this.batchPromptRunner = new BatchPromptRunner(this);

    this.ensureActiveConversation();

    this.registerView(
      AI_CHAT_VIEW_TYPE,
      (leaf: WorkspaceLeaf) => new AiChatView(leaf, this),
    );
	
	this.addRibbonIcon("wand-sparkles", "Open AI Copilot", async () => {
	await this.activateChatView();
	});
	
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
      vectorIndex: this.settings.enableExternalIndexStorage
        ? null
        : this.vectorStore.getIndex(),
      chatHistory: this.chatHistory,
      chatConversations: this.chatConversations,
      activeChatId: this.activeChatId,
      indexLogs: this.indexLogs,
      lastIndexError: this.lastIndexError,
      promptRunHistory: this.promptRunHistory.entries,
    });
  }

  ensureActiveConversation() {
    if (
      this.activeChatId &&
      this.chatConversations.some((item) => item.id === this.activeChatId)
    ) {
      return;
    }

    const now = new Date().toISOString();
    const conversation: ChatConversation = {
      id: crypto.randomUUID(),
      title: "新对话",
      messages: this.chatHistory ?? [],
      createdAt: now,
      updatedAt: now,
    };

    this.activeChatId = conversation.id;
    this.chatConversations.unshift(conversation);
  }

  syncActiveConversation() {
    this.ensureActiveConversation();

    const conversation = this.chatConversations.find(
      (item) => item.id === this.activeChatId,
    );
    if (!conversation) return;

    conversation.messages = this.chatHistory;
    conversation.updatedAt = new Date().toISOString();
    conversation.title = this.buildConversationTitle(this.chatHistory);
  }

  buildConversationTitle(messages: ChatMessage[]) {
    const firstUserMessage = messages.find((message) => message.role === "你");
    if (!firstUserMessage) return "新对话";
    return firstUserMessage.content.slice(0, 24) || "新对话";
  }

  async startNewChatConversation() {
    this.syncActiveConversation();

    const now = new Date().toISOString();
    const conversation: ChatConversation = {
      id: crypto.randomUUID(),
      title: "新对话",
      messages: [],
      createdAt: now,
      updatedAt: now,
    };

    this.chatConversations.unshift(conversation);
    this.activeChatId = conversation.id;
    this.chatHistory = [];

    await this.saveAllData();
    this.refreshChatViews();
  }

  async restoreChatConversation(conversationId: string) {
    this.syncActiveConversation();

    const conversation = this.chatConversations.find(
      (item) => item.id === conversationId,
    );
    if (!conversation) return;

    this.activeChatId = conversation.id;
    this.chatHistory = [...conversation.messages];

    await this.saveAllData();
    this.refreshChatViews();
  }

  addChatMessage(role: "你" | "AI", content: string) {
    this.chatHistory.push({
      role,
      content,
      createdAt: new Date().toISOString(),
    });

    if (this.chatHistory.length > this.settings.chatHistoryMaxMessages) {
      this.chatHistory = this.chatHistory.slice(
        this.chatHistory.length - this.settings.chatHistoryMaxMessages,
      );
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
      this.indexLogs = this.indexLogs.slice(
        this.indexLogs.length - this.settings.indexLogMaxEntries,
      );
    }

    this.saveAllData();
  }

  shouldExcludePath(path: string) {
    const excluded = this.settings.excludedFolders
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);

    return excluded.some(
      (folder) => path.startsWith(folder + "/") || path === folder,
    );
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

    const leaf = this.app.workspace.getRightLeaf(false);

    if (!leaf) {
      new Notice("无法打开 AI Chat 面板");
      return;
    }

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
}
