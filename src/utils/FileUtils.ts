import { App, Editor, TFile, normalizePath } from "obsidian";

export type EditorOutputAction = "insert_at_cursor" | "append_to_note" | "replace_selection";

/** 逐级创建文件夹（已存在则跳过）。 */
export async function ensureFolder(app: App, folderPath: string): Promise<void> {
	const parts = normalizePath(folderPath).split("/").filter(Boolean);
	let current = "";

	for (const part of parts) {
		current = current ? `${current}/${part}` : part;
		if (!app.vault.getAbstractFileByPath(current)) {
			await app.vault.createFolder(current);
		}
	}
}

/** 写入文件：已存在则覆盖，否则新建，返回写入的文件。 */
export async function upsertFile(app: App, path: string, content: string): Promise<TFile> {
	const existing = app.vault.getAbstractFileByPath(path);

	if (existing instanceof TFile) {
		await app.vault.modify(existing, content);
		return existing;
	}

	return await app.vault.create(path, content);
}

/** 把内容按指定方式写入编辑器。 */
export function applyEditorOutput(editor: Editor, action: EditorOutputAction, content: string): void {
	if (action === "append_to_note") {
		editor.setValue(`${editor.getValue()}\n\n${content}`);
		return;
	}

	// insert_at_cursor 与 replace_selection 都写入当前选区/光标处
	editor.replaceSelection(content);
}