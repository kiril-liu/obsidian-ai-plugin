import { normalizePath } from "obsidian";
import AiPlugin from "../main";
import { VaultVectorIndex, VectorIndexMeta } from "../types";

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

	// 用 adapter 逐级创建文件夹：兼容 .obsidian 配置目录，且文件夹已存在时不再抛 "Folder already exists"
	private async ensureFolder(folder: string) {
		const adapter = this.plugin.app.vault.adapter;
		const segments = normalizePath(folder).split("/").filter(Boolean);

		let current = "";
		for (const segment of segments) {
			current = current ? `${current}/${segment}` : segment;
			if (!(await adapter.exists(current))) {
				await adapter.mkdir(current);
			}
		}
	}

	async save(index: VaultVectorIndex) {
		await this.ensureFolder(this.plugin.settings.indexStorageFolder);

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
		const adapter = this.plugin.app.vault.adapter;
		const path = this.getIndexPath();

		if (!(await adapter.exists(path))) return null;

		return JSON.parse(await adapter.read(path)) as VaultVectorIndex;
	}

	async clear() {
		const adapter = this.plugin.app.vault.adapter;

		for (const path of [this.getIndexPath(), this.getMetaPath()]) {
			if (await adapter.exists(path)) {
				await adapter.remove(path);
			}
		}
	}

	async writeJson(path: string, value: unknown) {
		await this.plugin.app.vault.adapter.write(path, JSON.stringify(value, null, 2));
	}
}