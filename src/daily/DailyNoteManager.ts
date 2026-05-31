import { normalizePath, TFile } from "obsidian";
import AiPlugin from "../main";
import { DailyNoteContext, DailyNoteEntry } from "../types";

export class DailyNoteManager {
  plugin: AiPlugin;

  constructor(plugin: AiPlugin) {
    this.plugin = plugin;
  }

  formatDate(date: Date) {
    const y = String(date.getFullYear());
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");

    return this.plugin.settings.dailyNoteDateFormat
      .replace("YYYY", y)
      .replace("MM", m)
      .replace("DD", d);
  }

  getDailyPath(date = new Date()) {
    return normalizePath(
      `${this.plugin.settings.dailyNoteFolder}/${this.formatDate(date)}.md`,
    );
  }

  async ensureTodayNote(): Promise<TFile> {
    const path = this.getDailyPath();
    const existing = this.plugin.app.vault.getAbstractFileByPath(path);

    if (existing instanceof TFile) return existing;

    await this.ensureFolder(this.plugin.settings.dailyNoteFolder);
    return await this.plugin.app.vault.create(
      path,
      `# ${this.formatDate(new Date())}\n\n## 记录\n\n`,
    );
  }

  async getContext(): Promise<DailyNoteContext> {
    const today = await this.ensureTodayNote();
    const todayContent = await this.plugin.app.vault.cachedRead(today);
    const recentNotes = await this.getRecentNotes();

    return {
      todayPath: today.path,
      todayContent,
      recentNotes,
      combinedRecentContent: recentNotes
        .map((note) => `# ${note.date}\n\n${note.content}`)
        .join("\n\n---\n\n"),
    };
  }

  async getRecentNotes(): Promise<DailyNoteEntry[]> {
    const days = Math.max(1, this.plugin.settings.recentDailyNotesDays);
    const notes: DailyNoteEntry[] = [];

    for (let i = 0; i < days; i++) {
      const date = new Date();
      date.setDate(date.getDate() - i);

      const path = this.getDailyPath(date);
      const file = this.plugin.app.vault.getAbstractFileByPath(path);

      if (file instanceof TFile) {
        notes.push({
          path: file.path,
          date: this.formatDate(date),
          content: await this.plugin.app.vault.cachedRead(file),
        });
      }
    }

    return notes;
  }

  async ensureFolder(folderPath: string) {
    const parts = normalizePath(folderPath).split("/").filter(Boolean);
    let current = "";

    for (const part of parts) {
      current = current ? `${current}/${part}` : part;

      if (!this.plugin.app.vault.getAbstractFileByPath(current)) {
        await this.plugin.app.vault.createFolder(current);
      }
    }
  }
}
