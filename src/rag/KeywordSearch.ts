import { TFile } from "obsidian";
import AiPlugin from "../main";
import { VaultSearchResult } from "../types";

export class KeywordSearch {
	plugin: AiPlugin;

	constructor(plugin: AiPlugin) {
		this.plugin = plugin;
	}

	async search(query: string): Promise<VaultSearchResult[]> {
		const words = this.extractSearchWords(query);
		const possibleFileName = this.extractPossibleFileName(query);
		const files = this.plugin.app.vault.getFiles().filter((file) => this.canReadAsText(file));
		const results: VaultSearchResult[] = [];

		for (const file of files) {
			if (this.plugin.shouldExcludePath(file.path)) continue;

			try {
				const content = await this.plugin.app.vault.cachedRead(file);
				const score = this.scoreFile(file, content, words, possibleFileName);

				if (score <= 0) continue;

				results.push({
					path: file.path,
					score,
					excerpt: this.buildExcerpt(content, words),
				});
			} catch (error) {
				this.plugin.addIndexLog("warn", `无法读取文件：${file.path}`);
			}
		}

		return results.sort((a, b) => b.score - a.score).slice(0, this.plugin.settings.vaultSearchMaxResults);
	}

	scoreFile(file: TFile, content: string, words: string[], possibleFileName: string) {
		const lowerContent = content.toLowerCase();
		const lowerBasename = file.basename.toLowerCase();
		const lowerName = file.name.toLowerCase();
		const lowerPath = file.path.toLowerCase();
		let score = 0;

		if (possibleFileName) {
			const target = possibleFileName.toLowerCase().replace(/\.md$/, "").trim();

			if (lowerBasename === target) score += 120;
			if (lowerName === `${target}.md`) score += 120;
			if (lowerBasename.includes(target)) score += 80;
			if (lowerPath.includes(target)) score += 40;
		}

		for (const word of words) {
			const normalizedWord = word.toLowerCase().replace(/\.md$/, "").trim();
			if (!normalizedWord) continue;

			if (lowerBasename === normalizedWord) score += 80;
			if (lowerBasename.includes(normalizedWord)) score += 30;
			if (lowerPath.includes(normalizedWord)) score += 15;
			if (lowerContent.includes(normalizedWord)) score += 5;
		}

		return score;
	}

	extractPossibleFileName(query: string) {
		const normalized = query.trim();
		const patterns = [
			/名叫[“\"]?(.+?)[”\"]?的文件/,
			/找到[“\"]?(.+?)[”\"]?(?:这个文件|文件|\.md|，|,|并|的|$)/,
			/读取[“\"]?(.+?)[”\"]?(?:这个文件|文件|\.md|，|,|并|的|内容|$)/,
			/打开[“\"]?(.+?)[”\"]?(?:这个文件|文件|\.md|，|,|并|的|$)/,
			/([\w\u4e00-\u9fa5\-\s]+\.md)/,
		];

		for (const pattern of patterns) {
			const match = normalized.match(pattern);
			if (match?.[1]) {
				return this.cleanPossibleFileName(match[1]);
			}
		}

		return "";
	}

	cleanPossibleFileName(value: string) {
		return value
			.replace(/^当前\s*Vault\s*中/, "")
			.replace(/^名叫/, "")
			.replace(/这个文件$/, "")
			.replace(/文件$/, "")
			.replace(/内容$/, "")
			.replace(/[“”\"]/g, "")
			.trim();
	}

	extractSearchWords(query: string) {
		return query
			.toLowerCase()
			.replace(/[“”\"'，。！？、,.!?]/g, " ")
			.split(/\s+/)
			.map((word) => word.trim())
			.filter((word) => word.length > 0)
			.filter((word) => !this.isStopWord(word));
	}

	isStopWord(word: string) {
		return new Set([
			"请",
			"帮我",
			"找到",
			"读取",
			"打开",
			"文件",
			"这个",
			"主要",
			"内容",
			"告诉我",
			"当前",
			"vault",
			"中",
			"的",
			"并",
			"和",
		]).has(word);
	}

	canReadAsText(file: TFile) {
		const extensions = this.getIncludedTextExtensions();

		if (!extensions.has(file.extension.toLowerCase())) return false;
		if (file.stat.size > this.plugin.settings.maxTextFileSizeKb * 1024) return false;

		return true;
	}

	getIncludedTextExtensions() {
		return new Set(
			this.plugin.settings.includedTextExtensions
				.split(",")
				.map((item) => item.trim().toLowerCase())
				.filter(Boolean)
		);
	}

	buildExcerpt(content: string, words: string[]) {
		const lower = content.toLowerCase();
		const positions = words.map((word) => lower.indexOf(word)).filter((index) => index >= 0);
		const firstIndex = positions.length > 0 ? Math.min(...positions) : 0;
		const start = Math.max(0, firstIndex - 200);

		return content.slice(start, start + this.plugin.settings.vaultSearchMaxCharsPerResult).trim();
	}
}