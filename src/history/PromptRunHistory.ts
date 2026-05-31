import { Notice } from "obsidian";
import AiPlugin from "../main";
import { PromptRunHistoryEntry } from "../types";

export class PromptRunHistory {
  plugin: AiPlugin;
  entries: PromptRunHistoryEntry[] = [];

  constructor(plugin: AiPlugin) {
    this.plugin = plugin;
  }

  load(entries?: PromptRunHistoryEntry[]) {
    this.entries = entries ?? [];
  }

  add(entry: Omit<PromptRunHistoryEntry, "id"> & { id?: string }) {
    const nextEntry: PromptRunHistoryEntry = {
      ...entry,
      id: entry.id ?? crypto.randomUUID(),
    };

    this.entries.push(nextEntry);

    const maxEntries = Math.max(
      10,
      this.plugin.settings.promptRunHistoryMaxEntries,
    );

    if (this.entries.length > maxEntries) {
      this.entries = this.entries.slice(this.entries.length - maxEntries);
    }

    this.plugin.saveAllData();
  }

  clear() {
    this.entries = [];
    this.plugin.saveAllData();
    new Notice("已清空 Prompt 运行历史");
  }

  toMarkdown(limit = 20): string {
    if (this.entries.length === 0) return "暂无 Prompt 运行历史。";

    return [...this.entries]
      .reverse()
      .slice(0, limit)
      .map((entry) =>
        [
          `## ${entry.templateName}`,
          `- 时间：${entry.createdAt}`,
          `- 状态：${entry.status}`,
          `- 输出：${entry.outputTarget}`,
          entry.inputFilePath ? `- 输入文件：${entry.inputFilePath}` : "",
          entry.outputFilePath ? `- 输出文件：${entry.outputFilePath}` : "",
          entry.durationMs
            ? `- 耗时：${(entry.durationMs / 1000).toFixed(1)}s`
            : "",
          entry.error ? `- 错误：${entry.error}` : "",
        ]
          .filter(Boolean)
          .join("\n"),
      )
      .join("\n\n");
  }
}
