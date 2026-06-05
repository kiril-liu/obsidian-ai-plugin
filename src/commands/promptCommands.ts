import { MarkdownView, Notice } from "obsidian";
import { applyEditorOutput } from "../utils/FileUtils";
import AiPlugin from "../main";
import { PromptTemplate } from "../types";
import { PromptTemplateModal } from "../prompts/PromptTemplateModal";
import { OutputPreviewModal } from "../output/OutputPreviewModal";
import { ErrorFormatter } from "../errors/ErrorFormatter";
import { SourceFormatter } from "../rag/SourceFormatter";

export function registerPromptCommands(plugin: AiPlugin) {
	plugin.addCommand({
		id: "reload-prompt-library",
		name: "Reload prompt library",
		callback: async () => {
			await plugin.promptManager.loadTemplates(true);
			new Notice("已重新加载 Prompt Library");
		},
	});

	plugin.addCommand({
		id: "run-prompt-template",
		name: "Run prompt template",
		callback: async () => {
			const templates = await plugin.promptManager.loadTemplates(true);

			if (templates.length === 0) {
				new Notice("没有找到 Prompt 模板");
				return;
			}

			new PromptTemplateModal(plugin.app, templates, async (template) => {
				await runPromptTemplate(plugin, template);
			}).open();
		},
	});
}

export async function runPromptTemplate(plugin: AiPlugin, template: PromptTemplate) {
	try {
		const activeFile = plugin.app.workspace.getActiveFile();
		const view = plugin.app.workspace.getActiveViewOfType(MarkdownView);
		const selection = view?.editor.getSelection() ?? "";
		const note = activeFile ? await plugin.app.vault.cachedRead(activeFile) : "";

		let vaultContext = "";
		let sourcesMarkdown = "";
		let sourceCount = "0";
		let ragMode = "none";

		if (template.metadata.mode === "keyword") {
			const results = await plugin.keywordSearch.search(selection || note.slice(0, 200) || template.name);
			const sources = SourceFormatter.fromResults(results);
			vaultContext = SourceFormatter.toContextText(sources);
			sourcesMarkdown = SourceFormatter.toMarkdown(sources);
			sourceCount = String(sources.length);
			ragMode = "keyword";
		}

		if (template.metadata.mode === "rag" && (plugin.settings.enableEmbedding ?? false)) {
			const query = selection || note.slice(0, 300) || template.name;
			const queryEmbedding = (await plugin.embeddingClient.embed([query]))[0];
			let results = plugin.vectorStore.search(queryEmbedding, template.metadata.maxSources ?? plugin.settings.vectorSearchMaxResults);

			if (plugin.settings.enableHybridSearch) {
				results = await plugin.hybridSearch.search(query, results);
			}

			const sources = SourceFormatter.fromResults(results);
			vaultContext = SourceFormatter.toContextText(sources);
			sourcesMarkdown = SourceFormatter.toMarkdown(sources);
			sourceCount = String(sources.length);
			ragMode = "rag";
		}

		const prompt = plugin.promptManager.renderTemplate(
			template,
			plugin.promptManager.buildRenderContext({
				selection,
				note: plugin.limitText(note),
				question: template.name,
				vaultContext,
				sources: sourcesMarkdown,
				sourceCount,
				ragMode,
				filePath: activeFile?.path ?? "",
				fileName: activeFile?.basename ?? "",
			})
		);

		const signal = plugin.progressTracker.start(`运行 Prompt：${template.name}`, ["准备上下文", "调用 AI", "输出结果"]);
		plugin.progressTracker.setStep("调用 AI");

		const answer = await plugin.aiClient.chat(prompt, signal);

		plugin.progressTracker.setStep("输出结果");

		const outputMode = template.metadata.output ?? "chat";

		if (outputMode === "chat") {
			plugin.addChatMessage("AI", answer);
		}

		if (outputMode === "append" || outputMode === "replace_selection") {
			if (!view) {
				new Notice("当前没有打开 Markdown 笔记");
			} else if (plugin.settings.enableOutputPreview) {
				new OutputPreviewModal(
					plugin.app,
					{
						title: `Prompt 输出：${template.name}`,
						content: answer,
						sourcesMarkdown,
						defaultAction: outputMode === "append" ? "append_to_note" : "replace_selection",
					},
					async (action) => {
						if (action === "cancel" || action === "copy_to_clipboard") return;
						applyEditorOutput(view.editor, action, answer);
					}
				).open();
			} else {
				applyEditorOutput(view.editor, outputMode === "append" ? "append_to_note" : "replace_selection", answer);
			}
		}

		plugin.progressTracker.complete("Prompt 运行完成");
	} catch (error) {
		const friendly = ErrorFormatter.fromUnknown(error);

		plugin.progressTracker.fail(friendly.message);
		new Notice(ErrorFormatter.toNoticeText(friendly));
	}
}