import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import AiPlugin from "./main";
import { AiPluginSettings } from "./types";
import { ErrorFormatter } from "./errors/ErrorFormatter";

export const DEFAULT_SETTINGS: AiPluginSettings = {
  apiKey: "",
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-4o-mini",
  maxTokens: 0,
  cachedModels: [],
  cachedModelsBaseUrl: "",
  vaultSearchMaxResults: 6,
  vaultSearchMaxCharsPerResult: 1200,
  embeddingBaseUrl: "https://api.openai.com/v1",
  embeddingModel: "text-embedding-3-small",
  cachedEmbeddingModels: [],
  cachedEmbeddingModelsBaseUrl: "",
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

    // 厂商预设：选中后自动填入对应 Base URL（都是 OpenAI 兼容接口）
    const presets: Record<string, string> = {
      "OpenAI": "https://api.openai.com/v1",
      "NVIDIA": "https://integrate.api.nvidia.com/v1",
      "DeepSeek": "https://api.deepseek.com/v1",
      "Ollama（本地）": "http://localhost:11434/v1"
    };

    new Setting(containerEl)
      .setName("厂商预设")
      .setDesc("选择后自动填入对应 Base URL；也可在下方手动修改。各家均为 OpenAI 兼容接口。")
      .addDropdown((dropdown) => {
        dropdown.addOption("", "自定义");
        for (const name of Object.keys(presets)) dropdown.addOption(name, name);
        const current = Object.keys(presets).find((name) => presets[name] === this.plugin.settings.baseUrl) ?? "";
        dropdown.setValue(current);
        dropdown.onChange(async (value) => {
          if (value && presets[value]) {
            this.plugin.settings.baseUrl = presets[value];
            await this.plugin.saveSettings();
            this.display();
          }
        });
      });

    this.addTextSetting(containerEl, "Base URL", "OpenAI-compatible API", "https://api.openai.com/v1", "baseUrl");

    // 模型：下拉选择（来自缓存列表），右侧刷新按钮拉取 GET /v1/models，列表持久化
    new Setting(containerEl)
      .setName("Model")
      .setDesc("聊天模型。填好 Base URL 与 API Key 后点右侧刷新拉取可用模型；列表会缓存，下次直接用。")
      .addDropdown((dropdown) => {
        const models = this.plugin.settings.cachedModels ?? [];
        const current = this.plugin.settings.model;
        const options = models.length
          ? (models.includes(current) ? models : [current, ...models].filter(Boolean))
          : [current].filter(Boolean);

        if (options.length === 0) {
          dropdown.addOption("", "（请先刷新模型列表）");
        } else {
          for (const id of options) dropdown.addOption(id, id);
        }

        dropdown.setValue(current);
        dropdown.onChange(async (value) => {
          this.plugin.settings.model = value;
          await this.plugin.saveSettings();
        });
      })
      .addExtraButton((button) =>
        button
          .setIcon("refresh-cw")
          .setTooltip("刷新模型列表")
          .onClick(async () => {
            try {
              const models = await this.plugin.aiClient.listModels();
              this.plugin.settings.cachedModels = models;
              this.plugin.settings.cachedModelsBaseUrl = this.plugin.settings.baseUrl;
              if (models.length && !models.includes(this.plugin.settings.model)) {
                this.plugin.settings.model = models[0];
              }
              await this.plugin.saveSettings();
              new Notice(`已获取 ${models.length} 个模型`);
              this.display();
            } catch (error) {
              new Notice(ErrorFormatter.toNoticeText(ErrorFormatter.fromUnknown(error)));
            }
          })
      );

    // 也允许手动输入模型名（首次未刷新、或下拉里没有的私有模型）
    this.addTextSetting(containerEl, "Model（手动输入）", "下拉没有想要的模型时，可在此直接手敲模型名。", "gpt-4o-mini", "model");

    // max_tokens 不写死：填 0 表示不发送该参数，避免不同模型上限不同（32768 vs 16384）导致 400
    this.addNumberSetting(containerEl, "Max tokens", "回复最大 token 数；填 0 表示不限制（不发送 max_tokens，避免切模型后报 400）。", "0", "maxTokens");

    this.addTextSetting(containerEl, "Embedding Base URL", "Embedding API", "https://api.openai.com/v1", "embeddingBaseUrl");

    // Embedding 模型：下拉选择（来自缓存列表），刷新按钮拉取 Embedding Base URL 的 GET /v1/models 并筛选含 "embed" 的模型
    new Setting(containerEl)
      .setName("Embedding Model")
      .setDesc("Embedding 模型。填好 Embedding Base URL 与 API Key 后点右侧刷新，从该地址拉取并筛出 embedding 模型；列表会缓存。")
      .addDropdown((dropdown) => {
        const models = this.plugin.settings.cachedEmbeddingModels ?? [];
        const current = this.plugin.settings.embeddingModel;
        const options = models.length
          ? (models.includes(current) ? models : [current, ...models].filter(Boolean))
          : [current].filter(Boolean);

        if (options.length === 0) {
          dropdown.addOption("", "（请先刷新模型列表）");
        } else {
          for (const id of options) dropdown.addOption(id, id);
        }

        dropdown.setValue(current);
        dropdown.onChange(async (value) => {
          this.plugin.settings.embeddingModel = value;
          await this.plugin.saveSettings();
        });
      })
      .addExtraButton((button) =>
        button
          .setIcon("refresh-cw")
          .setTooltip("刷新 Embedding 模型列表")
          .onClick(async () => {
            try {
              const all = await this.plugin.aiClient.listModels(this.plugin.settings.embeddingBaseUrl);
              const embeds = all.filter((id) => id.toLowerCase().includes("embed"));
              const models = embeds.length ? embeds : all;
              this.plugin.settings.cachedEmbeddingModels = models;
              this.plugin.settings.cachedEmbeddingModelsBaseUrl = this.plugin.settings.embeddingBaseUrl;
              if (models.length && !models.includes(this.plugin.settings.embeddingModel)) {
                this.plugin.settings.embeddingModel = models[0];
              }
              await this.plugin.saveSettings();
              new Notice(`已获取 ${models.length} 个 Embedding 模型${embeds.length ? "" : "（未匹配到 embed 关键字，已列出全部）"}`);
              this.display();
            } catch (error) {
              new Notice(ErrorFormatter.toNoticeText(ErrorFormatter.fromUnknown(error)));
            }
          })
      );

    // 也允许手动输入 Embedding 模型名
    this.addTextSetting(containerEl, "Embedding Model（手动输入）", "下拉没有想要的模型时，可在此直接手敲。", "text-embedding-3-small", "embeddingModel");

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