import { Notice, Platform, requestUrl } from "obsidian";
import AiPlugin from "../main";
import { ErrorFormatter } from "../errors/ErrorFormatter";

export class AiClient {
	plugin: AiPlugin;

	constructor(plugin: AiPlugin) {
		this.plugin = plugin;
	}

	// 系统提示词
	private static SYSTEM_PROMPT = "你是一个帮助用户整理 Obsidian 笔记的中文 AI 助手。";

	// 统一构造请求体；不发送 max_tokens，避免不同模型上限不同（如 32768 vs 16384）切换后报 400
	private buildBody(prompt: string, stream: boolean): Record<string, unknown> {
		const body: Record<string, unknown> = {
			model: this.plugin.settings.model,
			messages: [
				{ role: "system", content: AiClient.SYSTEM_PROMPT },
				{ role: "user", content: prompt },
			],
			temperature: 0.7,
		};

		if (stream) body.stream = true;

		return body;
	}

	// 拉取可用模型列表：OpenAI 兼容的 GET /v1/models，NVIDIA / OpenAI / DeepSeek / Ollama 等通用。
	// 用 requestUrl 走 Electron 网络栈，绕过 CORS，并自动处理代理与证书。
	async listModels(baseUrlOverride?: string): Promise<string[]> {
		if (!this.plugin.settings.apiKey) {
			new Notice("请先填写 API Key");
			return [];
		}

		try {
			const baseUrl = baseUrlOverride || this.plugin.settings.baseUrl;
			const response = await requestUrl({
				url: `${baseUrl}/models`,
				method: "GET",
				headers: {
					Authorization: `Bearer ${this.plugin.settings.apiKey}`,
				},
				throw: false,
			});

			if (response.status < 200 || response.status >= 300) {
				throw ErrorFormatter.fromResponse(response.status, response.text);
			}

			const data = response.json;
			const list = Array.isArray(data?.data) ? data.data : [];

			return list
				.map((item: any) => item?.id)
				.filter((id: any): id is string => typeof id === "string")
				.sort((a: string, b: string) => a.localeCompare(b));
		} catch (error) {
			throw ErrorFormatter.fromUnknown(error);
		}
	}

	// 非流式：两端都用 requestUrl（绕 CORS + 自动处理代理/证书）
	async chat(prompt: string, signal?: AbortSignal): Promise<string> {
		if (!this.plugin.settings.apiKey) {
			new Notice("请先填写 API Key");
			return "";
		}

		try {
			const response = await requestUrl({
				url: `${this.plugin.settings.baseUrl}/chat/completions`,
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${this.plugin.settings.apiKey}`,
				},
				body: JSON.stringify(this.buildBody(prompt, false)),
				throw: false,
			});

			if (response.status < 200 || response.status >= 300) {
				throw ErrorFormatter.fromResponse(response.status, response.text);
			}

			return response.json?.choices?.[0]?.message?.content ?? "";
		} catch (error) {
			throw ErrorFormatter.fromUnknown(error);
		}
	}

	// 流式：
	// - 桌面端用 Node https，既绕 CORS 又支持真流式与取消；
	// - 桌面端遇到代理/证书类网络错误时，自动降级到 requestUrl 非流式重试一次；
	// - 移动端没有 Node，直接 requestUrl 非流式（拿到完整结果后一次性回调）。
	async chatStream(
		prompt: string,
		signal: AbortSignal | undefined,
		onToken: (full: string, delta: string) => void
	): Promise<string> {
		if (!this.plugin.settings.apiKey) {
			new Notice("请先填写 API Key");
			return "";
		}

		if (Platform.isMobile) {
			return this.chatStreamViaRequestUrl(prompt, signal, onToken);
		}

		try {
			return await this.chatStreamViaNodeHttps(prompt, signal, onToken);
		} catch (error) {
			const friendly = ErrorFormatter.fromUnknown(error);
			// 用户主动取消：不降级，直接抛出
			if (friendly.isCancelled) throw friendly;
			// 仅在「连接 / 代理 / 证书」类错误时降级（这正是 Node https 不读系统代理/证书链的痛点）
			if (this.isProxyOrCertError(error)) {
				return this.chatStreamViaRequestUrl(prompt, signal, onToken);
			}
			throw friendly;
		}
	}

	// requestUrl 不支持真流式：拿到完整结果后一次性回调，体感等同非流式
	private async chatStreamViaRequestUrl(
		prompt: string,
		signal: AbortSignal | undefined,
		onToken: (full: string, delta: string) => void
	): Promise<string> {
		const content = await this.chat(prompt, signal);
		if (content) onToken(content, content);
		return content;
	}

	private isProxyOrCertError(error: any): boolean {
		const code = error?.code ? String(error.code).toUpperCase() : "";
		const message = error?.message ? String(error.message).toUpperCase() : "";

		return (
			code === "ECONNREFUSED" ||
			code === "ETIMEDOUT" ||
			code === "ECONNRESET" ||
			code === "ENOTFOUND" ||
			code === "EAI_AGAIN" ||
			code.includes("CERT") ||
			message.includes("CERT") ||
			message.includes("SELF_SIGNED") ||
			message.includes("UNABLE_TO_VERIFY")
		);
	}

	// 桌面端 Node https 真流式：在 Electron 渲染进程懒加载 https（仅桌面执行，避免移动端触发 NodeJS 包加载错误）
	private chatStreamViaNodeHttps(
		prompt: string,
		signal: AbortSignal | undefined,
		onToken: (full: string, delta: string) => void
	): Promise<string> {
		return new Promise<string>((resolve, reject) => {
			let https: any;
			try {
				https = require("https");
			} catch (error) {
				reject(error);
				return;
			}

			let target: URL;
			try {
				target = new URL(`${this.plugin.settings.baseUrl}/chat/completions`);
			} catch (error) {
				reject(error);
				return;
			}

			const payload = JSON.stringify(this.buildBody(prompt, true));

			const options: any = {
				method: "POST",
				hostname: target.hostname,
				port: target.port || (target.protocol === "http:" ? 80 : 443),
				path: target.pathname + target.search,
				headers: {
					"Content-Type": "application/json",
					"Content-Length": Buffer.byteLength(payload),
					Authorization: `Bearer ${this.plugin.settings.apiKey}`,
					Accept: "text/event-stream",
				},
			};

			// Node 15+ 支持给请求传 AbortSignal，用于取消
			if (signal) options.signal = signal;

			const request = https.request(options, (response: any) => {
				const status = response.statusCode ?? 0;
				response.setEncoding("utf8");

				if (status < 200 || status >= 300) {
					let errorBody = "";
					response.on("data", (chunk: string) => (errorBody += chunk));
					response.on("end", () => reject(ErrorFormatter.fromResponse(status, errorBody)));
					return;
				}

				let buffer = "";
				let full = "";

				response.on("data", (chunk: string) => {
					buffer += chunk;
					const lines = buffer.split("\n");
					buffer = lines.pop() ?? "";

					for (const rawLine of lines) {
						const line = rawLine.trim();
						if (!line || !line.startsWith("data:")) continue;

						const data = line.slice(5).trim();
						if (data === "[DONE]") continue;

						try {
							const json = JSON.parse(data);
							const delta = json.choices?.[0]?.delta?.content ?? "";
							if (delta) {
								full += delta;
								onToken(full, delta);
							}
						} catch (error) {
							// 跳过无法解析的 SSE 行
						}
					}
				});

				response.on("end", () => resolve(full));
				response.on("error", (error: any) => reject(error));
			});

			request.on("error", (error: any) => reject(error));
			request.write(payload);
			request.end();
		});
	}
}