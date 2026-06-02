import { normalizePath, TFile } from "obsidian";
import AiPlugin from "../main";
import { VaultVectorIndex, VectorIndexMeta } from "../types";
import { ensureFolder, upsertFile } from "../utils/FileUtils";

export class IndexStorage {
	plugin: AiPlugin;

	constructor(plugin: AiPlugin) {
		this.plugin = plugin;
	}

	getIndexPath() {
		return normalizePath(`${this.plugin.settings.indexStorageFolder}/vector-index.json`);
	}

	getMetaPath() {
		return normalizePath(`${this.plugin.settings.indexStorageFolder}/index-meta.json`);
	}

	async save(index: VaultVectorIndex) {
		await ensureFolder(this.plugin.app, this.plugin.settings.indexStorageFolder);

		const meta: VectorIndexMeta = {
			version: index.version,
			storageVersion: 1,
			builtAt: index.builtAt,
			updatedAt: index.updatedAt,
			embeddingModel: index.embeddingModel,
			chunkMaxChars: index.chunkMaxChars,
			chunkOverlapChars: index.chunkOverlapChars,
			excludedFolders: index.excludedFolders,
			chunkCount: index.chunks.length,
			fileCount: new Set(index.chunks.map((chunk) => chunk.path)).size,
		};

		await this.writeJson(this.getIndexPath(), index);
		await this.writeJson(this.getMetaPath(), meta);
	}

	async load(): Promise<VaultVectorIndex | null> {
		const file = this.plugin.app.vault.getAbstractFileByPath(this.getIndexPath());

		if (!(file instanceof TFile)) return null;

		return JSON.parse(await this.plugin.app.vault.cachedRead(file)) as VaultVectorIndex;
	}

	async clear() {
		for (const path of [this.getIndexPath(), this.getMetaPath()]) {
			const file = this.plugin.app.vault.getAbstractFileByPath(path);

			if (file instanceof TFile) {
				await this.plugin.app.vault.delete(file);
			}
		}
	}

	async writeJson(path: string, value: unknown) {
		await upsertFile(this.plugin.app, path, JSON.stringify(value, null, 2));
	}
}