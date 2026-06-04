import { Platform } from "obsidian";
import AiPlugin from "../main";
import { ErrorFormatter } from "../errors/ErrorFormatter";

export class EmbeddingClient {
	plugin: AiPlugin;
	// 本地模型管线缓存（懒加载，只初始化一次；切换模型时重建）
	private localPipelinePromise: Promise<any> | null = null;
	private localPipelineModelId: string | null = null;

	constructor(plugin: AiPlugin) {
		this.plugin = plugin;
	}

	// 手机端没有 Node fs / 真实绝对路径，本地模型（Transformers.js + onnxruntime-web）跑不起来，
	// 所以只在桌面端用本地模型；移动端一律回退到 API embedding。
	private useLocalEmbedding(): boolean {
		return this.plugin.settings.embeddingProvider === "local" && !Platform.isMobile;
	}

	// 当前实际使用的 embedding 标识：用于索引一致性判断（不同来源/模型维度不同，不可混用）
	getActiveModelId(): string {
		return this.useLocalEmbedding()
			? `local:${this.plugin.settings.localEmbeddingModel}`
			: this.plugin.settings.embeddingModel;
	}

	async embed(inputs: string[], signal?: AbortSignal): Promise<number[][]> {
		if (inputs.length === 0) return [];

		if (this.useLocalEmbedding()) {
			return this.embedLocal(inputs, signal);
		}

		return this.embedApi(inputs, signal);
	}

	// 纯插件内跑：用 Transformers.js 在本地（WASM）算向量，离线、不消耗 token
	private async embedLocal(inputs: string[], signal?: AbortSignal): Promise<number[][]> {
		try {
			const extractor = await this.getLocalPipeline();
			const vectors: number[][] = [];

			for (let i = 0; i < inputs.length; i++) {
				const text = inputs[i];
				if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
				// mean pooling + normalize：直接得到归一化句向量
				const output = await extractor(text, { pooling: "mean", normalize: true });
				vectors.push(Array.from(output.data as Float32Array));
				// 每条算完让出主线程，避免 wasm 单线程把 UI 占死（Measure loop 警告 / 卡顿假死）
				await new Promise((resolve) => setTimeout(resolve, 0));
			}

			return vectors;
		} catch (error) {
			console.error("[AI Copilot] 本地 embedding 失败：", error);
			throw ErrorFormatter.fromUnknown(error);
		}
	}

	// 懒加载本地模型管线：首次会下载模型（之后走浏览器缓存）；切换模型时重建
	private getLocalPipeline(): Promise<any> {
		const modelId = this.plugin.settings.localEmbeddingModel || "Xenova/bge-small-zh-v1.5";

		if (this.localPipelinePromise && this.localPipelineModelId === modelId) {
			return this.localPipelinePromise;
		}

		this.localPipelineModelId = modelId;
		this.localPipelinePromise = (async () => {
			// transformers.js 2.17 在模块首次加载时，用 process.release.name === "node" 判断
			// 要不要用 onnxruntime-node。Obsidian 是 Electron 渲染进程，这个值恰好是 "node"，
			// 于是它会去加载需要原生二进制的 onnxruntime-node —— 而 Obsidian 里没有这个二进制，
			// 导致 InferenceSession 为 undefined，最终报 reading 'create'。
			// 所以在 import 之前临时改掉这个值，强制走 onnxruntime-web（wasm），import 完再还原。
			const proc = (globalThis as any).process;
			const originalReleaseName = proc?.release?.name;
			try {
				if (proc?.release && originalReleaseName === "node") {
					proc.release = { ...proc.release, name: "obsidian" };
				}
			} catch (e) {
				// 改不动就算了，多半本来就不是 Node 环境
			}

			// 动态导入，避免插件启动时就加载这个较大的依赖
			const transformers = (await import("@xenova/transformers")) as any;

			try {
				if (proc?.release && originalReleaseName === "node") {
					proc.release = { ...proc.release, name: originalReleaseName };
				}
			} catch (e) {
				// 忽略还原失败
			}

			const { pipeline, env } = transformers;

			const adapter = this.plugin.app.vault.adapter as any;
			const modelRoot = this.plugin.settings.localModelPath || "AI Copilot/models";

			env.allowLocalModels = true;
			// 允许联网回退：本地缺文件时自动从 HuggingFace 下载模型，方便首次使用。
			env.allowRemoteModels = true;
			env.useBrowserCache = false;

			// 关键：Obsidian 是 Electron，自带 Node fs，transformers 会用文件系统读模型文件，
			// 所以 localModelPath 必须是「真实绝对路径」，绝不能给 app:// URL（否则 fs 找不到，报 not found）。
			const basePath = adapter.getBasePath ? adapter.getBasePath() : "";
			env.localModelPath = `${basePath}/${modelRoot}`;

			// 而 onnxruntime-web 的 wasm 是用 fetch 加载的，所以这里相反——必须给可 fetch 的 app:// URL，结尾带 /。
			if (env.backends?.onnx?.wasm) {
				const wasmUrl = String(adapter.getResourcePath(`${modelRoot}/_onnx_wasm`)).split("?")[0];
				env.backends.onnx.wasm.wasmPaths = wasmUrl + "/";
				env.backends.onnx.wasm.numThreads = 1;
			}

			const extractor = await pipeline("feature-extraction", modelId);
			return extractor;
		})();

		return this.localPipelinePromise;
	}

	private async embedApi(inputs: string[], signal?: AbortSignal): Promise<number[][]> {
		try {
			const baseUrl = this.plugin.settings.embeddingBaseUrl || this.plugin.settings.baseUrl;

			const response = await fetch(`${baseUrl}/embeddings`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${this.plugin.settings.apiKey}`,
				},
				signal,
				body: JSON.stringify({
					model: this.plugin.settings.embeddingModel,
					input: inputs,
				}),
			});

			if (!response.ok) {
				throw ErrorFormatter.fromResponse(response.status, `Embedding error: ${await response.text()}`);
			}

			const data = await response.json();

			return [...(data.data ?? [])]
				.sort((a, b) => a.index - b.index)
				.map((item) => item.embedding as number[]);
		} catch (error) {
			throw ErrorFormatter.fromUnknown(error);
		}
	}
}