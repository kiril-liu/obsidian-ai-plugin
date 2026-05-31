import { App, FuzzySuggestModal } from "obsidian";
import { PromptTemplate } from "../types";

export class PromptTemplateModal extends FuzzySuggestModal<PromptTemplate> {
  templates: PromptTemplate[];
  onChoose: (template: PromptTemplate) => void | Promise<void>;

  constructor(
    app: App,
    templates: PromptTemplate[],
    onChoose: (template: PromptTemplate) => void | Promise<void>,
  ) {
    super(app);
    this.templates = templates;
    this.onChoose = onChoose;
    this.setPlaceholder("选择一个 Prompt 模板");
  }

  getItems(): PromptTemplate[] {
    return this.templates;
  }

  getItemText(item: PromptTemplate): string {
    const category = item.metadata.category
      ? `[${item.metadata.category}] `
      : "";
    const favorite = item.metadata.favorite ? "★ " : "";
    return `${favorite}${category}${item.name}`;
  }

  async onChooseItem(item: PromptTemplate) {
    await this.onChoose(item);
  }
}
