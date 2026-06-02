import { App, Notice, TFile, normalizePath } from "obsidian";

export type NoteAction =
	| { action: "create"; path: string; content?: string }
	| { action: "append"; path: string; content?: string };

export type NoteActionResult = {
	ok: boolean;
	message: string;
	path?: string;
};

export class NoteActionManager {
	app: App;

	constructor(app: App) {
		this.app = app;
	}

	/** 从 AI 回答中解析 note-action 代码块，返回动作与去掉该块后的正文。 */
	static parse(answer: string): { action: NoteAction | null; cleaned: string } {
		const match = answer.match(/```note-action\s*([\s\S]*?)```/);

		if (!match) return { action: null, cleaned: answer };

		let action: NoteAction | null = null;

		try {
			const parsed = JSON.parse(match[1].trim());

			if (
				parsed &&
				(parsed.action === "create" || parsed.action === "append") &&
				typeof parsed.path === "string"
			) {
				action = parsed as NoteAction;
			}
		} catch (error) {
			action = null;
		}

		const cleaned = answer.replace(match[0], "").trim();
		return { action, cleaned };
	}

	async run(action: NoteAction): Promise<NoteActionResult> {
		if (action.action === "create") {
			return this.createNote(action.path, action.content ?? "");
		}

		return this.appendNote(action.path, action.content ?? "");
	}

	async createNote(rawPath: string, content: string): Promise<NoteActionResult> {
		const mdPath = await this.uniquePath(this.ensureMdPath(rawPath));
		await this.ensureFolder(mdPath);

		try {
			const file = await this.app.vault.create(mdPath, content);
			await this.openFile(file);
			return { ok: true, message: `已新建笔记：${mdPath}`, path: mdPath };
		} catch (error) {
			return { ok: false, message: `新建笔记失败：${mdPath}` };
		}
	}

	async appendNote(rawPath: string, content: string): Promise<NoteActionResult> {
		const target = this.resolveExistingFile(rawPath);

		if (!target) {
			const created = await this.createNote(rawPath, content);
			if (created.ok) {
				return { ok: true, message: `未找到目标笔记，已新建：${created.path}`, path: created.path };
			}
			return created;
		}

		try {
			const existing = await this.app.vault.read(target);
			const separator = existing.trim().length > 0 ? "\n\n" : "";
			await this.app.vault.modify(target, `${existing}${separator}${content}`);
			await this.openFile(target);
			return { ok: true, message: `已追加到笔记：${target.path}`, path: target.path };
		} catch (error) {
			return { ok: false, message: `追加到笔记失败：${target.path}` };
		}
	}

	private ensureMdPath(path: string) {
		const normalized = normalizePath(path.trim());
		return normalized.endsWith(".md") ? normalized : `${normalized}.md`;
	}

	private async ensureFolder(path: string) {
		const slash = path.lastIndexOf("/");
		if (slash <= 0) return;

		const folder = path.slice(0, slash);
		if (this.app.vault.getAbstractFileByPath(folder)) return;

		try {
			await this.app.vault.createFolder(folder);
		} catch (error) {
			// 已存在或并发创建，忽略
		}
	}

	private async uniquePath(path: string) {
		if (!this.app.vault.getAbstractFileByPath(path)) return path;

		const dot = path.lastIndexOf(".");
		const base = dot >= 0 ? path.slice(0, dot) : path;
		const ext = dot >= 0 ? path.slice(dot) : "";

		let index = 1;
		let candidate = `${base} ${index}${ext}`;

		while (this.app.vault.getAbstractFileByPath(candidate)) {
			index += 1;
			candidate = `${base} ${index}${ext}`;
		}

		return candidate;
	}

	private resolveExistingFile(rawPath: string): TFile | null {
		const direct = this.ensureMdPath(rawPath);
		const byPath = this.app.vault.getAbstractFileByPath(direct);
		if (byPath instanceof TFile) return byPath;

		const rawNoExt = rawPath.trim().replace(/\.md$/i, "");
		const targetName = (rawNoExt.split("/").pop() ?? rawNoExt).toLowerCase();
		const files = this.app.vault.getMarkdownFiles();

		const fullMatch = files.find(
			(file) => file.path.replace(/\.md$/i, "").toLowerCase() === rawNoExt.toLowerCase()
		);
		if (fullMatch) return fullMatch;

		const nameMatch = files.find((file) => file.basename.toLowerCase() === targetName);
		return nameMatch ?? null;
	}

	private async openFile(file: TFile) {
		try {
			await this.app.workspace.getLeaf(true).openFile(file);
		} catch (error) {
			// 打开失败不影响主流程
		}
	}
}