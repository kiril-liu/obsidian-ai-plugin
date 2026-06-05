import { normalizePath } from "obsidian";
import AiPlugin from "../main";
import { LIFE_PROMPT_PACK } from "./LifePromptPack";
import { PromptRenderContext, PromptTemplate, PromptTemplateMetadata } from "../types";

export class PromptManager {
	plugin: AiPlugin;
	templates: PromptTemplate[] = [];

	constructor(plugin: AiPlugin) {
		this.plugin = plugin;
	}

	async loadTemplates(force = false): Promise<PromptTemplate[]> {
		if (this.templates.length > 0 && !force) return this.templates;

		const templates: PromptTemplate[] = [];

		// 内置生活模板始终可用，无需创建文件
		templates.push(...this.parseTemplates(LIFE_PROMPT_PACK, "内置：Life Prompt Pack"));

		const folderPath = normalizePath(this.plugin.settings.promptFolderPath);
		const files = this.plugin.app.vault.getMarkdownFiles().filter((file) => file.path.startsWith(folderPath + "/"));

		for (const file of files) {
			templates.push(...this.parseTemplates(await this.plugin.app.vault.cachedRead(file), file.path));
		}

		this.templates = templates.sort((a, b) => {
			const favoriteDiff = Number(Boolean(b.metadata.favorite)) - Number(Boolean(a.metadata.favorite));
			if (favoriteDiff !== 0) return favoriteDiff;
			return `${a.metadata.category ?? ""}${a.name}`.localeCompare(`${b.metadata.category ?? ""}${b.name}`);
		});

		return this.templates;
	}

	parseTemplates(content: string, sourcePath: string): PromptTemplate[] {
		const sections = content.split(/^##\s+/m).slice(1);

		return sections
			.map((section) => {
				const firstLineEnd = section.indexOf("\n");
				const name = section.slice(0, firstLineEnd).trim();
				const body = section.slice(firstLineEnd + 1);

				const metadata = this.parseYamlMetadata(body);
				const promptMatch = body.match(/```prompt\n([\s\S]*?)```/);

				if (!name || !promptMatch) return null;

				return {
					name,
					content: promptMatch[1].trim(),
					sourcePath,
					metadata,
				};
			})
			.filter(Boolean) as PromptTemplate[];
	}

	parseYamlMetadata(body: string): PromptTemplateMetadata {
		const match = body.match(/^---\n([\s\S]*?)\n---/);

		if (!match) return {};

		const metadata: PromptTemplateMetadata = {};

		for (const line of match[1].split("\n")) {
			const [key, ...rest] = line.split(":");
			const value = rest.join(":").trim();

			if (!key || !value) continue;

			if (key === "category") metadata.category = value;
			if (key === "favorite") metadata.favorite = value === "true";
			if (key === "mode" && ["basic", "keyword", "rag"].includes(value)) metadata.mode = value as any;
			if (key === "output" && ["chat", "append", "replace_selection"].includes(value)) metadata.output = value as any;
			if (key === "description") metadata.description = value;
			if (key === "temperature") metadata.temperature = Number(value);
			if (key === "maxSources") metadata.maxSources = Number(value);
		}

		return metadata;
	}

	async getTemplateByName(name: string) {
		const templates = await this.loadTemplates(true);
		return templates.find((template) => template.name === name);
	}

	renderTemplate(template: PromptTemplate, context: PromptRenderContext) {
		let output = template.content;

		for (const [key, value] of Object.entries(context)) {
			output = output.replaceAll(`{{${key}}}`, value);
		}

		return output;
	}

	buildRenderContext(partial: Partial<PromptRenderContext> = {}): PromptRenderContext {
		const now = new Date();

		return {
			selection: "",
			note: "",
			question: "",
			vaultContext: "",
			sources: "",
			sourceCount: "0",
			ragMode: "none",
			filePath: "",
			fileName: "",
			date: now.toISOString().slice(0, 10),
			time: now.toTimeString().slice(0, 5),
			chatHistory: this.plugin.chatHistory.map((message) => `${message.role}: ${message.content}`).join("\n\n"),
			lastAnswer: [...this.plugin.chatHistory].reverse().find((message) => message.role === "AI")?.content ?? "",
			...partial,
		};
	}
}