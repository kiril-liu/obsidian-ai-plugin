import { Editor, MarkdownView, Notice } from "obsidian";
import AiPlugin from "../main";
import { OutputPreviewModal } from "../output/OutputPreviewModal";
import { ErrorFormatter } from "../errors/ErrorFormatter";

export function registerNoteCommands(plugin: AiPlugin) {
  plugin.addCommand({
    id: "summarize-selected-text",
    name: "Summarize selected text",
    editorCallback: async (editor) => {
      await runEditorCommand(
        plugin,
        editor,
        "请总结下面这段内容：",
        "replace_selection",
      );
    },
  });

  plugin.addCommand({
    id: "rewrite-selected-text",
    name: "Rewrite selected text",
    editorCallback: async (editor) => {
      await runEditorCommand(
        plugin,
        editor,
        "请润色改写下面这段内容，保持原意：",
        "replace_selection",
      );
    },
  });

  plugin.addCommand({
    id: "summarize-current-note",
    name: "Summarize current note",
    callback: async () => {
      const view = plugin.app.workspace.getActiveViewOfType(MarkdownView);
      if (!view || !view.file) {
		new Notice("当前没有打开 Markdown 笔记");
		return;
		}

		const content = await plugin.app.vault.cachedRead(view.file);
      await runPromptForNote(
        plugin,
        `请总结下面这篇笔记：\n\n${plugin.limitText(content)}`,
        "append_to_note",
      );
    },
  });

  plugin.addCommand({
    id: "extract-todos-from-current-note",
    name: "Extract TODOs from current note",
    callback: async () => {
      const view = plugin.app.workspace.getActiveViewOfType(MarkdownView);
	  if (!view || !view.file) {
		  new Notice("当前没有打开 Markdown 笔记");
		  return;
		}
	
		const content = await plugin.app.vault.cachedRead(view.file);
      await runPromptForNote(
        plugin,
        `请从下面笔记中提取 TODO，使用 Markdown checklist：\n\n${plugin.limitText(content)}`,
        "append_to_note",
      );
    },
  });
}

async function runEditorCommand(
  plugin: AiPlugin,
  editor: Editor,
  instruction: string,
  defaultAction: "replace_selection" | "append_to_note",
) {
  const selection = editor.getSelection();

  if (!selection.trim()) {
    new Notice("请先选中文本");
    return;
  }

  const prompt = `${instruction}\n\n${selection}`;

  await runWithPreview(
    plugin,
    prompt,
    defaultAction,
    async (content, action) => {
      if (action === "replace_selection") editor.replaceSelection(content);
      if (action === "append_to_note")
        editor.setValue(`${editor.getValue()}\n\n${content}`);
      if (action === "insert_at_cursor") editor.replaceSelection(content);
    },
  );
}

async function runPromptForNote(
  plugin: AiPlugin,
  prompt: string,
  defaultAction: "append_to_note",
) {
  const view = plugin.app.workspace.getActiveViewOfType(MarkdownView);
  if (!view) return;

  await runWithPreview(
    plugin,
    prompt,
    defaultAction,
    async (content, action) => {
      const editor = view.editor;

      if (action === "append_to_note")
        editor.setValue(`${editor.getValue()}\n\n${content}`);
      if (action === "insert_at_cursor") editor.replaceSelection(content);
      if (action === "replace_selection") editor.replaceSelection(content);
    },
  );
}

async function runWithPreview(
  plugin: AiPlugin,
  prompt: string,
  defaultAction: "replace_selection" | "append_to_note",
  apply: (
    content: string,
    action: "insert_at_cursor" | "append_to_note" | "replace_selection",
  ) => Promise<void> | void,
) {
  try {
    const signal = plugin.progressTracker.start("AI 处理笔记", [
      "发送请求",
      "等待回复",
      "准备输出",
    ]);
    plugin.progressTracker.setStep("发送请求");

    const answer = await plugin.aiClient.chat(prompt, signal);

    plugin.progressTracker.setStep("准备输出");

    if (plugin.settings.enableOutputPreview) {
      new OutputPreviewModal(
        plugin.app,
        {
          title: "AI 输出预览",
          content: answer,
          defaultAction,
        },
        async (action) => {
          if (action === "cancel") return;
          if (action === "copy_to_clipboard") return;
          await apply(answer, action);
        },
      ).open();
    } else {
      await apply(answer, defaultAction);
    }

    plugin.progressTracker.complete("AI 处理完成");
  } catch (error) {
    const friendly = ErrorFormatter.fromUnknown(error);
    plugin.progressTracker.fail(friendly.message);
    new Notice(ErrorFormatter.toNoticeText(friendly));
  }
}
