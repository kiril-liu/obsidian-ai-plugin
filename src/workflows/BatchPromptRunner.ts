import { Notice, TFile, normalizePath } from "obsidian";
import AiPlugin from "../main";
import { BatchPromptRunOptions, BatchPromptRunResult, PromptWorkflowOutputTarget } from "../types";
import { ErrorFormatter } from "../errors/ErrorFormatter";
import { ensureFolder, upsertFile } from "../utils/FileUtils";

export class BatchPromptRunner {
	plugin: AiPlugin;

	constructor(plugin: AiPlugin) {
		this.plugin = plugin;
	}

	async run(options: BatchPromptRunOptions): Promise<BatchPromptRunResult> {
		const template = await this.plugin.promptManager.getTemplateByName(options.templateName);

		if (!template) throw new Error(`没有找到 Prompt 模板：${options.templateName}`);

		const maxFiles = Math.max(1, this.plugin.settings.batchRunMaxFiles);
		const filePaths = options.filePaths.slice(0, maxFiles);
		const outputFiles: string[] = [];

		let success = 0;
		let failed = 0;

		this.plugin.progressTracker.start(`批量运行：${template.name}`, ["准备文件", "逐个调用 AI", "写入结果", "完成"]);

		for (const filePath of filePaths) {
			const startedAt = Date.now();

			try {
				const file = this.plugin.app.vault.getAbstractFileByPath(filePath);
				if (!(file instanceof TFile)) {
					failed++;
					continue;
				}

				this.plugin.progressTracker.setStep("逐个调用 AI", file.path);

				const content = await this.plugin.app.vault.cachedRead(file);
				const prompt = this.plugin.promptManager.renderTemplate(
					template,
					this.plugin.promptManager.buildRenderContext({
						note: this.plugin.limitText(content),
						question: template.name,
						filePath: file.path,
						fileName: file.basename,
					})
				);

				const answer = await this.plugin.aiClient.chat(prompt, this.plugin.progressTracker.getSignal());
				const outputPath = await this.writeOutput(options.outputTarget, file, template.name, answer, options.outputFolder);

				if (outputPath) outputFiles.push(outputPath);
				success++;

				this.plugin.promptRunHistory.add({
					templateName: template.name,
					sourcePath: template.sourcePath,
					outputTarget: options.outputTarget,
					inputFilePath: file.path,
					outputFilePath: outputPath,
					status: "success",
					createdAt: new Date().toISOString(),
					durationMs: Date.now() - startedAt,
				});
			} catch (error) {
				failed++;
				const friendlyError = ErrorFormatter.fromUnknown(error);

				this.plugin.promptRunHistory.add({
					templateName: options.templateName,
					outputTarget: options.outputTarget,
					inputFilePath: filePath,
					status: friendlyError.isCancelled ? "cancelled" : "failed",
					error: friendlyError.message,
					createdAt: new Date().toISOString(),
					durationMs: Date.now() - startedAt,
				});
			}
		}

		this.plugin.progressTracker.complete(`批量 Prompt 完成：成功 ${success}，失败 ${failed}`);
		new Notice(`批量 Prompt 完成：成功 ${success}，失败 ${failed}`);

		return { total: filePaths.length, success, failed, outputFiles };
	}

	async writeOutput(outputTarget: PromptWorkflowOutputTarget, inputFile: TFile, templateName: string, answer: string, outputFolder?: string) {
		if (outputTarget === "clipboard") {
			await navigator.clipboard.writeText(answer);
			return undefined;
		}

		if (outputTarget === "chat") {
			this.plugin.addChatMessage("AI", answer);
			return undefined;
		}

		const folder = normalizePath(outputFolder || this.plugin.settings.workflowOutputFolder);
		await ensureFolder(this.plugin.app, folder);

		const safeTemplateName = templateName.replace(/[\\/:*?"<>|]/g, "-");
		const safeInputName = inputFile.basename.replace(/[\\/:*?"<>|]/g, "-");
		const outputPath = normalizePath(`${folder}/${safeInputName} - ${safeTemplateName}.md`);
		const body = `# ${safeInputName} - ${templateName}\n\n来源文件：[[${inputFile.path}]]\n\n---\n\n${answer}\n`;

		await upsertFile(this.plugin.app, outputPath, body);

		return outputPath;
	}
}