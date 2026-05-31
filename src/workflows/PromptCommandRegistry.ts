import { Notice } from "obsidian";
import AiPlugin from "../main";
import { PromptCommandBinding, PromptTemplate } from "../types";
import { runPromptTemplate } from "../commands/promptCommands";

export class PromptCommandRegistry {
  plugin: AiPlugin;
  bindings: PromptCommandBinding[] = [];

  constructor(plugin: AiPlugin) {
    this.plugin = plugin;
  }

  async registerPromptTemplateCommands() {
    if (!this.plugin.settings.enablePromptCommandRegistration) return;

    const templates = await this.plugin.promptManager.loadTemplates(true);
    this.bindings = [];

    for (const template of templates) {
      this.registerTemplateCommand(template);
    }

    if (templates.length > 0) {
      this.plugin.addIndexLog(
        "info",
        `已注册 ${templates.length} 个 Prompt 模板命令`,
      );
    }
  }

  registerTemplateCommand(template: PromptTemplate) {
    const commandId = this.buildCommandId(template.name);
    const commandName = `AI Prompt: ${template.name}`;

    this.plugin.addCommand({
      id: commandId,
      name: commandName,
      callback: async () => {
        await runPromptTemplate(this.plugin, template);
      },
    });

    this.bindings.push({ templateName: template.name, commandId, commandName });
  }

  buildCommandId(templateName: string): string {
    return `ai-prompt-${templateName}`
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  async reloadCommandsNotice() {
    await this.registerPromptTemplateCommands();
    new Notice(`已刷新 Prompt 命令：${this.bindings.length} 个`);
  }
}
