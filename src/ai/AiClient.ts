import { Notice } from "obsidian";
import AiPlugin from "../main";
import { ErrorFormatter } from "../errors/ErrorFormatter";

export class AiClient {
	plugin: AiPlugin;

	constructor(plugin: AiPlugin) {
		this.plugin = plugin;
	}

	async chat(prompt: string, signal?: AbortSignal): Promise<string> {
		if (!this.plugin.settings.apiKey) {
			new Notice("请先填写 API Key");
			return "";
		}

		try {
			const response = await fetch(`${this.plugin.settings.baseUrl}/chat/completions`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${this.plugin.settings.apiKey}`,
				},
				signal,
				body: JSON.stringify({
					model: this.plugin.settings.model,
					messages: [
						{ role: "system", content: "你是一个帮助用户整理 Obsidian 笔记的中文 AI 助手。" },
						{ role: "user", content: prompt },
					],
					temperature: 0.7,
				}),
			});

			if (!response.ok) {
				throw ErrorFormatter.fromResponse(response.status, await response.text());
			}

			const data = await response.json();
			return data.choices?.[0]?.message?.content ?? "";
		} catch (error) {
			throw ErrorFormatter.fromUnknown(error);
		}
	}

	async chatStream(
		prompt: string,
		signal: AbortSignal | undefined,
		onToken: (full: string, delta: string) => void
	): Promise<string> {
		if (!this.plugin.settings.apiKey) {
			new Notice("请先填写 API Key");
			return "";
		}

		try {
			const response = await fetch(`${this.plugin.settings.baseUrl}/chat/completions`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${this.plugin.settings.apiKey}`,
				},
				signal,
				body: JSON.stringify({
					model: this.plugin.settings.model,
					messages: [
						{ role: "system", content: "你是一个帮助用户整理 Obsidian 笔记的中文 AI 助手。" },
						{ role: "user", content: prompt },
					],
					temperature: 0.7,
					stream: true,
				}),
			});

			if (!response.ok) {
				throw ErrorFormatter.fromResponse(response.status, await response.text());
			}

			if (!response.body) {
				// 不支持流时回退到一次性返回
				const data = await response.json();
				const content = data.choices?.[0]?.message?.content ?? "";
				if (content) onToken(content, content);
				return content;
			}

			const reader = response.body.getReader();
			const decoder = new TextDecoder();
			let buffer = "";
			let full = "";

			while (true) {
				const { value, done } = await reader.read();
				if (done) break;

				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split("\n");
				buffer = lines.pop() ?? "";

				for (const rawLine of lines) {
					const line = rawLine.trim();
					if (!line || !line.startsWith("data:")) continue;

					const payload = line.slice(5).trim();
					if (payload === "[DONE]") continue;

					try {
						const json = JSON.parse(payload);
						const delta = json.choices?.[0]?.delta?.content ?? "";
						if (delta) {
							full += delta;
							onToken(full, delta);
						}
					} catch (error) {
						// 跳过无法解析的 SSE 行
					}
				}
			}

			return full;
		} catch (error) {
			throw ErrorFormatter.fromUnknown(error);
		}
	}
}