import { App, PluginSettingTab, Setting } from "obsidian";
import AiPlugin from "./main";
import { AiPluginSettings } from "./types";

export const DEFAULT_SETTINGS: AiPluginSettings = {
  apiKey: "",
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-4o-mini",
  vaultSearchMaxResults: 6,
  vaultSearchMaxCharsPerResult: 1200,
  embeddingBaseUrl: "https://api.openai.com/v1",
  embeddingModel: "text-embedding-3-small",
  embeddingProvider: "local",
  localEmbeddingModel: "Xenova/bge-small-zh-v1.5",
  localModelPath: "AI Copilot/models",
  vectorSearchMaxResults: 8,
  chunkMaxChars: 1200,
  chunkOverlapChars: 150,
  excludedFolders: "Templates, Archive, .trash",
  includedTextExtensions: "md, txt, csv, json, canvas",
  maxTextFileSizeKb: 1024,
  chatHistoryMaxMessages: 30,
  enableConversationRetrieval: false,
  linkCurrentNote: true,
  indexLogMaxEntries: 50,
  enablePromptLibrary: true,
  promptLibraryPath: "AI Copilot/Prompts.md",
  enablePromptFolder: true,
  promptFolderPath: "AI Copilot/Prompts",
  enableOutputPreview: true,
  requestTimeoutSeconds: 90,
  dailyNoteFolder: "Daily",
  dailyNoteDateFormat: "YYYY-MM-DD",
  recentDailyNotesDays: 7,
  indexStorageFolder: ".obsidian/plugins/obsidian-ai-copilot/index",
  enableExternalIndexStorage: true,
  enableHybridSearch: true,
  hybridSemanticWeight: 0.7,
  hybridKeywordWeight: 0.2,
  hybridRecencyWeight: 0.1,
  autoUpdateIndexOnStartup: false,
  enablePromptCommandRegistration: true,
  promptRunHistoryMaxEntries: 100,
  workflowOutputFolder: "AI Copilot/Outputs",
  batchRunMaxFiles: 20
};

export class AiSettingsTab extends PluginSettingTab {
  plugin: AiPlugin;

  constructor(app: App, plugin: AiPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "AI Copilot 设置" });

    this.renderModelSettings(containerEl);
    this.renderPromptSettings(containerEl);
    this.renderDailySettings(containerEl);
    this.renderIndexSettings(containerEl);
    this.renderWorkflowSettings(containerEl);
  }

  renderModelSettings(containerEl: HTMLElement) {
    containerEl.createEl("h3", { text: "模型" });
    this.addTextSetting(containerEl, "API Key", "AI 服务密钥", "sk-...", "apiKey");
    this.addTextSetting(containerEl, "Base URL", "OpenAI-compatible API", "https://api.openai.com/v1", "baseUrl");
    this.addTextSetting(containerEl, "Model", "聊天模型", "gpt-4o-mini", "model");
    this.addTextSetting(containerEl, "Embedding Base URL", "Embedding API", "https://api.openai.com/v1", "embeddingBaseUrl");
    this.addTextSetting(containerEl, "Embedding Model", "Embedding 模型", "text-embedding-3-small", "embeddingModel");

    new Setting(containerEl)
      .setName("Embedding 运行方式")
      .setDesc("local＝纯插件内跑（Transformers.js，离线、无 token 消耗）；api＝调用远程 Embedding 接口。切换后需重建索引。")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("local", "本地（Transformers.js）")
          .addOption("api", "远程 API")
          .setValue(this.plugin.settings.embeddingProvider)
          .onChange(async (value) => {
            this.plugin.settings.embeddingProvider = value as "api" | "local";
            await this.plugin.saveSettings();
          })
      );
    this.addTextSetting(containerEl, "本地 Embedding 模型", "Transformers.js 模型 ID（中文推荐 Xenova/bge-small-zh-v1.5）", "Xenova/bge-small-zh-v1.5", "localEmbeddingModel");
    this.addTextSetting(containerEl, "本地模型目录", "离线模型与 wasm 存放的库内文件夹。模型放 <目录>/<模型ID>/，wasm 放 <目录>/_onnx_wasm/", "AI Copilot/models", "localModelPath");
  }

  renderPromptSettings(containerEl: HTMLElement) {
    containerEl.createEl("h3", { text: "Prompt Library" });
    this.addToggleSetting(containerEl, "Enable prompt library", "启用提示词库", "enablePromptLibrary");
    this.addToggleSetting(containerEl, "Enable prompt folder", "读取提示词文件夹", "enablePromptFolder");
    this.addTextSetting(containerEl, "Prompt folder path", "提示词文件夹", "AI Copilot/Prompts", "promptFolderPath");
    this.addToggleSetting(containerEl, "Enable output preview", "写入前预览", "enableOutputPreview");

    new Setting(containerEl)
      .setName("Prompt actions")
      .addButton((button) =>
        button.setButtonText("创建生活模板").onClick(async () => {
          await this.plugin.promptManager.createLifePromptPack();
        })
      )
      .addButton((button) =>
        button.setButtonText("刷新 Prompt 命令").onClick(async () => {
          await this.plugin.promptCommandRegistry.reloadCommandsNotice();
        })
      );
  }

  renderDailySettings(containerEl: HTMLElement) {
    containerEl.createEl("h3", { text: "Daily Note" });
    this.addTextSetting(containerEl, "Daily note folder", "Daily Note 文件夹", "Daily", "dailyNoteFolder");
    this.addTextSetting(containerEl, "Daily note date format", "支持 YYYY、MM、DD", "YYYY-MM-DD", "dailyNoteDateFormat");
    this.addNumberSetting(containerEl, "Recent daily notes days", "读取最近多少天", "7", "recentDailyNotesDays");
  }

  renderIndexSettings(containerEl: HTMLElement) {
    containerEl.createEl("h3", { text: "索引与检索" });
    this.addToggleSetting(containerEl, "External index storage", "索引保存到独立文件", "enableExternalIndexStorage");
    this.addTextSetting(containerEl, "Index storage folder", "索引文件夹", ".obsidian/plugins/obsidian-ai-copilot/index", "indexStorageFolder");
    this.addToggleSetting(containerEl, "Hybrid search", "混合检索", "enableHybridSearch");
    this.addToggleSetting(containerEl, "对话语义检索", "默认关闭。开启后会对每条提问做 Embedding 以检索本会话历史（API 模式下每条消息都要请求，较慢；建议配置本地 Embedding 后再开启）；关闭时仅按最近 N 条对话提供上下文。", "enableConversationRetrieval");
    this.addNumberSetting(containerEl, "Semantic weight", "语义权重", "0.7", "hybridSemanticWeight");
    this.addNumberSetting(containerEl, "Keyword weight", "关键词权重", "0.2", "hybridKeywordWeight");
    this.addNumberSetting(containerEl, "Recency weight", "最近编辑权重", "0.1", "hybridRecencyWeight");
    this.addTextSetting(containerEl, "Included text extensions", "允许 AI 检索和索引的文本文件扩展名", "md, txt, csv, json, canvas", "includedTextExtensions");
    this.addNumberSetting(containerEl, "Max text file size KB", "超过该大小的文本文件不会进入检索和索引", "1024", "maxTextFileSizeKb");

    new Setting(containerEl)
      .setName("Index actions")
      .addButton((button) => button.setButtonText("构建索引").onClick(() => this.plugin.vaultIndexer.buildVectorIndex()))
      .addButton((button) => button.setButtonText("更新索引").onClick(() => this.plugin.vaultIndexer.updateVectorIndex()))
      .addButton((button) => button.setButtonText("清空索引").onClick(() => this.plugin.vaultIndexer.clearVectorIndex()));
  }

  renderWorkflowSettings(containerEl: HTMLElement) {
    containerEl.createEl("h3", { text: "工作流" });
    this.addToggleSetting(containerEl, "Register prompt commands", "模板注册为命令", "enablePromptCommandRegistration");
    this.addTextSetting(containerEl, "Workflow output folder", "输出文件夹", "AI Copilot/Outputs", "workflowOutputFolder");
    this.addNumberSetting(containerEl, "Prompt run history max", "历史条数", "100", "promptRunHistoryMaxEntries");
    this.addNumberSetting(containerEl, "Batch run max files", "批量最大文件数", "20", "batchRunMaxFiles");

    new Setting(containerEl)
      .setName("History")
      .addButton((button) =>
        button.setButtonText("清空运行历史").onClick(() => this.plugin.promptRunHistory.clear())
      );
  }

  addTextSetting(containerEl: HTMLElement, name: string, desc: string, placeholder: string, key: keyof AiPluginSettings) {
    new Setting(containerEl)
      .setName(name)
      .setDesc(desc)
      .addText((text) =>
        text
          .setPlaceholder(placeholder)
          .setValue(String(this.plugin.settings[key] ?? ""))
          .onChange(async (value) => {
            (this.plugin.settings[key] as string) = value;
            await this.plugin.saveSettings();
          })
      );
  }

  addNumberSetting(containerEl: HTMLElement, name: string, desc: string, placeholder: string, key: keyof AiPluginSettings) {
    new Setting(containerEl)
      .setName(name)
      .setDesc(desc)
      .addText((text) =>
        text
          .setPlaceholder(placeholder)
          .setValue(String(this.plugin.settings[key]))
          .onChange(async (value) => {
            const parsed = Number(value);
            (this.plugin.settings[key] as number) = Number.isFinite(parsed) ? parsed : Number(placeholder);
            await this.plugin.saveSettings();
          })
      );
  }

  addToggleSetting(containerEl: HTMLElement, name: string, desc: string, key: keyof AiPluginSettings) {
    new Setting(containerEl)
      .setName(name)
      .setDesc(desc)
      .addToggle((toggle) =>
        toggle.setValue(Boolean(this.plugin.settings[key])).onChange(async (value) => {
          (this.plugin.settings[key] as boolean) = value;
          await this.plugin.saveSettings();
        })
      );
  }
}