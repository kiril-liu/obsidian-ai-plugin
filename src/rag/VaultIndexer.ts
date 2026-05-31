import { Notice, TFile } from "obsidian";
import AiPlugin from "../main";
import { Chunker } from "./Chunker";
import { VectorChunk, VectorChunkInput } from "../types";



export class VaultIndexer {
  plugin: AiPlugin;

  constructor(plugin: AiPlugin) {
    this.plugin = plugin;
  }
  
  getIncludedTextExtensions() {
	return new Set(
		this.plugin.settings.includedTextExtensions
			.split(",")
			.map((item) => item.trim().toLowerCase())
			.filter(Boolean)
	);
	}
	
	canIndexFile(file: TFile) {
	const extensions = this.getIncludedTextExtensions();

	if (!extensions.has(file.extension.toLowerCase())) return false;
	if (file.stat.size > this.plugin.settings.maxTextFileSizeKb * 1024) return false;

	return true;
	}

  async buildVectorIndex() {
    try {
      const signal = this.plugin.progressTracker.start("构建 Vault 向量索引", [
        "扫描文件",
        "切分文本",
        "生成 Embedding",
        "保存索引",
      ]);
      this.plugin.progressTracker.setStep("扫描文件"); 
	  
	  const files = this.plugin.app.vault
		.getFiles()
		.filter((file) => this.canIndexFile(file))
		.filter((file) => !this.plugin.shouldExcludePath(file.path));
	const chunksInput: VectorChunkInput[] = [];

      this.plugin.progressTracker.setStep("切分文本");

      for (const file of files) {
        const content = await this.plugin.app.vault.cachedRead(file);
        chunksInput.push(
          ...Chunker.chunkMarkdown(
            file.path,
            file.basename,
            file.stat.mtime,
            content,
            this.plugin.settings.chunkMaxChars,
            this.plugin.settings.chunkOverlapChars,
          ),
        );
      }

      this.plugin.progressTracker.setStep(
        "生成 Embedding",
        `${chunksInput.length} chunks`,
      );

      const embeddings = await this.plugin.embeddingClient.embed(
        chunksInput.map((chunk) => chunk.text),
        signal,
      );

      const chunks: VectorChunk[] = chunksInput.map((chunk, index) => ({
        ...chunk,
        embedding: embeddings[index],
      }));

      const index = this.plugin.vectorStore.createIndex(chunks, {
        embeddingModel: this.plugin.settings.embeddingModel,
        chunkMaxChars: this.plugin.settings.chunkMaxChars,
        chunkOverlapChars: this.plugin.settings.chunkOverlapChars,
        excludedFolders: this.plugin.settings.excludedFolders,
      });

      this.plugin.vectorStore.setIndex(index);

      this.plugin.progressTracker.setStep("保存索引");

      if (this.plugin.settings.enableExternalIndexStorage) {
        await this.plugin.indexStorage.save(index);
      }

      await this.plugin.saveAllData();
      this.plugin.progressTracker.complete(`索引完成：${chunks.length} 个片段`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.plugin.lastIndexError = message;
      this.plugin.progressTracker.fail(message);
      new Notice(`索引失败：${message}`);
    }
  }

  async updateVectorIndex() {
    await this.buildVectorIndex();
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
