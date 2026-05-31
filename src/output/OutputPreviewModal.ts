import { App, Modal, Notice } from "obsidian";
import { OutputAction, OutputPreviewPayload } from "../types";

export class OutputPreviewModal extends Modal {
  payload: OutputPreviewPayload;
  onChooseAction: (action: OutputAction) => void | Promise<void>;

  constructor(
    app: App,
    payload: OutputPreviewPayload,
    onChooseAction: (action: OutputAction) => void | Promise<void>,
  ) {
    super(app);
    this.payload = payload;
    this.onChooseAction = onChooseAction;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl("h2", { text: this.payload.title });
    contentEl.createEl("p", {
      text: "请先预览 AI 输出，再选择写入方式。",
      cls: "ai-output-preview-desc",
    });

    const textarea = contentEl.createEl("textarea");
    textarea.addClass("ai-output-preview-textarea");
    textarea.value = this.buildPreviewText();

    const buttons = contentEl.createDiv("ai-output-preview-buttons");

    this.addButton(buttons, "插入到光标处", "insert_at_cursor");
    this.addButton(buttons, "追加到笔记末尾", "append_to_note");
    this.addButton(buttons, "替换选区", "replace_selection");
    this.addButton(buttons, "复制到剪贴板", "copy_to_clipboard");
    this.addButton(buttons, "取消", "cancel");
  }

  buildPreviewText() {
    return `${this.payload.content}${
      this.payload.sourcesMarkdown
        ? `\n\n### 参考来源\n\n${this.payload.sourcesMarkdown}`
        : ""
    }`;
  }

  addButton(container: HTMLElement, label: string, action: OutputAction) {
    const button = container.createEl("button", { text: label });

    if (action === this.payload.defaultAction) {
      button.addClass("mod-cta");
    }

    button.onclick = async () => {
      try {
        if (action === "copy_to_clipboard") {
          await navigator.clipboard.writeText(this.buildPreviewText());
          new Notice("已复制");
          this.close();
          return;
        }

        await this.onChooseAction(action);
        this.close();
      } catch (error) {
        console.error(error);
        new Notice("输出操作失败");
      }
    };
  }

  onClose() {
    this.contentEl.empty();
  }
}
