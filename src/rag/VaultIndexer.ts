import { Notice, TFile } from "obsidian";
import AiPlugin from "../main";
import { Chunker } from "./Chunker";
import { VaultVectorIndex, VectorChunk, VectorChunkInput } from "../types";

// 每批送入 Embedding 接口的最大片段数，避免单次请求过大或超时
const EMBEDDING_BATCH_SIZE = 64;

export class VaultIndexer {
	plugin: AiPlugin;

	constructor(plugin: AiPlugin) {
		this.plugin = plugin;
	}

	// 收集指定文件的全部切分片段
	private async collectChunks(files: TFile[]): Promise<VectorChunkInput[]> {
		const chunksInput: VectorChunkInput[] = [];

		for (const file of files) {
			const content = await this.plugin.app.vault.cachedRead(file);
			chunksInput.push(
				...Chunker.chunkMarkdown(
					file.path,
					file.basename,
					file.stat.mtime,
					content,
					this.plugin.settings.chunkMaxChars,
					this.plugin.settings.chunkOverlapChars
				)
			);
		}

		return chunksInput;
	}

	// 分批生成 Embedding，避免单次请求过大或超时，并按批次更新进度
	private async embedInBatches(inputs: VectorChunkInput[], signal?: AbortSignal): Promise<number[][]> {
		const embeddings: number[][] = [];
		const total = inputs.length;

		for (let start = 0; start < total; start += EMBEDDING_BATCH_SIZE) {
			const batch = inputs.slice(start, start + EMBEDDING_BATCH_SIZE);
			const batchEmbeddings = await this.plugin.embeddingClient.embed(batch.map((chunk) => chunk.text), signal);
			embeddings.push(...batchEmbeddings);

			const done = Math.min(start + batch.length, total);
			this.plugin.progressTracker.setStep("生成 Embedding", `${done} / ${total} chunks`);
		}

		return embeddings;
	}

	// 把片段输入与对应 embedding 合并成有效的 VectorChunk（丢弃缺失 embedding 的片段）
	private mergeEmbeddings(inputs: VectorChunkInput[], embeddings: number[][]): VectorChunk[] {
		return inputs
			.map((chunk, index) => ({ ...chunk, embedding: embeddings[index] }))
			.filter((chunk): chunk is VectorChunk => Array.isArray(chunk.embedding) && chunk.embedding.length > 0);
	}

	private buildIndexFromChunks(chunks: VectorChunk[], builtAt?: string): VaultVectorIndex {
		const index = this.plugin.vectorStore.createIndex(chunks, {
			embeddingModel: this.plugin.settings.embeddingModel,
			chunkMaxChars: this.plugin.settings.chunkMaxChars,
			chunkOverlapChars: this.plugin.settings.chunkOverlapChars,
			excludedFolders: this.plugin.settings.excludedFolders,
		});

		if (builtAt) index.builtAt = builtAt;
		return index;
	}

	private async persistIndex(index: VaultVectorIndex) {
		this.plugin.vectorStore.setIndex(index);

		this.plugin.progressTracker.setStep("保存索引");

		if (this.plugin.settings.enableExternalIndexStorage) {
			await this.plugin.indexStorage.save(index);
		}

		await this.plugin.saveAllData();
	}

	// 现有索引是否与当前配置兼容；embedding 模型或切分参数变化时必须全量重建
	private isIndexReusable(): boolean {
		const index = this.plugin.vectorStore.getIndex();
		if (!index) return false;

		return (
			index.embeddingModel === this.plugin.settings.embeddingModel &&
			index.chunkMaxChars === this.plugin.settings.chunkMaxChars &&
			index.chunkOverlapChars === this.plugin.settings.chunkOverlapChars
		);
	}

	async buildVectorIndex() {
		try {
			const signal = this.plugin.progressTracker.start("构建 Vault 向量索引", ["扫描文件", "切分文本", "生成 Embedding", "保存索引"]);

			this.plugin.progressTracker.setStep("扫描文件");
			const files = this.plugin.app.vault.getMarkdownFiles().filter((file) => !this.plugin.shouldExcludePath(file.path));

			this.plugin.progressTracker.setStep("切分文本");
			const chunksInput = await this.collectChunks(files);

			this.plugin.progressTracker.setStep("生成 Embedding", `${chunksInput.length} chunks`);
			const embeddings = await this.embedInBatches(chunksInput, signal);
			const chunks = this.mergeEmbeddings(chunksInput, embeddings);

			const index = this.buildIndexFromChunks(chunks);
			await this.persistIndex(index);

			this.plugin.progressTracker.complete(`索引完成：${chunks.length} 个片段`);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.plugin.lastIndexError = message;
			this.plugin.progressTracker.fail(message);
			new Notice(`索引失败：${message}`);
		}
	}

	// 增量更新：只重新切分 / Embedding 新增或修改过的文件，复用未变化文件的片段，并丢弃已删除文件
	async updateVectorIndex() {
		if (!this.isIndexReusable()) {
			// 首次构建或配置已变更，退回全量构建
			await this.buildVectorIndex();
			return;
		}

		try {
			const existing = this.plugin.vectorStore.getIndex()!;
			const signal = this.plugin.progressTracker.start("增量更新向量索引", ["扫描变更", "切分文本", "生成 Embedding", "保存索引"]);

			this.plugin.progressTracker.setStep("扫描变更");
			const files = this.plugin.app.vault.getMarkdownFiles().filter((file) => !this.plugin.shouldExcludePath(file.path));
			const currentPaths = new Set(files.map((file) => file.path));

			const chunksByPath = new Map<string, VectorChunk[]>();
			const indexedMtime = new Map<string, number>();
			for (const chunk of existing.chunks) {
				if (!chunksByPath.has(chunk.path)) chunksByPath.set(chunk.path, []);
				chunksByPath.get(chunk.path)!.push(chunk);
				indexedMtime.set(chunk.path, chunk.mtime);
			}

			const reusedChunks: VectorChunk[] = [];
			const changedFiles: TFile[] = [];

			for (const file of files) {
				const previousMtime = indexedMtime.get(file.path);
				if (previousMtime !== undefined && previousMtime === file.stat.mtime) {
					reusedChunks.push(...(chunksByPath.get(file.path) ?? []));
				} else {
					changedFiles.push(file);
				}
			}

			this.plugin.progressTracker.setStep("切分文本");
			const newChunksInput = await this.collectChunks(changedFiles);

			this.plugin.progressTracker.setStep("生成 Embedding", `${newChunksInput.length} chunks`);
			const embeddings = await this.embedInBatches(newChunksInput, signal);
			const newChunks = this.mergeEmbeddings(newChunksInput, embeddings);

			const index = this.buildIndexFromChunks([...reusedChunks, ...newChunks], existing.builtAt);
			await this.persistIndex(index);

			const deletedCount = [...indexedMtime.keys()].filter((path) => !currentPaths.has(path)).length;
			this.plugin.progressTracker.complete(
				`增量更新完成：新增/更新 ${changedFiles.length} 个文件，删除 ${deletedCount} 个，复用 ${reusedChunks.length} 个片段`
			);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.plugin.lastIndexError = message;
			this.plugin.progressTracker.fail(message);
			new Notice(`增量索引失败：${message}`);
		}
	}

	async clearVectorIndex() {
		this.plugin.vectorStore.setIndex(null);

		if (this.plugin.settings.enableExternalIndexStorage) {
			await this.plugin.indexStorage.clear();
		}

		await this.plugin.saveAllData();
		new Notice("已清空索引");
	}

	async loadIndexOnStartup() {
		if (this.plugin.settings.enableExternalIndexStorage) {
			const index = await this.plugin.indexStorage.load();

			if (index) {
				this.plugin.vectorStore.setIndex(index);
				this.plugin.addIndexLog("info", "已从独立索引文件加载向量索引");
				return;
			}
		}

		if (this.plugin.loadedData?.vectorIndex) {
			this.plugin.vectorStore.setIndex(this.plugin.loadedData.vectorIndex);
		}
	}
}