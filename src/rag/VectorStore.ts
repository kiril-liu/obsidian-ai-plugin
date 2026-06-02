import { VaultSearchResult, VaultVectorIndex, VectorChunk, VectorChunkInput } from "../types";

export class VectorStore {
	index: VaultVectorIndex | null = null;

	setIndex(index: VaultVectorIndex | null) {
		// 索引存入时把所有片段向量归一化为单位向量（幂等），
		// 之后检索只需做点积，无需每次重算向量模长
		if (index) {
			for (const chunk of index.chunks) {
				chunk.embedding = VectorStore.normalize(chunk.embedding);
			}
		}

		this.index = index;
	}

	getIndex() {
		return this.index;
	}

	createIndex(chunks: VectorChunk[], options: { embeddingModel: string; chunkMaxChars: number; chunkOverlapChars: number; excludedFolders: string }): VaultVectorIndex {
		const now = new Date().toISOString();

		return {
			version: 1,
			builtAt: now,
			updatedAt: now,
			embeddingModel: options.embeddingModel,
			chunkMaxChars: options.chunkMaxChars,
			chunkOverlapChars: options.chunkOverlapChars,
			excludedFolders: options.excludedFolders,
			chunks,
		};
	}

	// 归一化为单位向量；零向量原样返回
	static normalize(vector: number[]): number[] {
		let norm = 0;
		for (let i = 0; i < vector.length; i++) norm += vector[i] * vector[i];
		norm = Math.sqrt(norm);
		if (norm === 0) return vector;
		return vector.map((value) => value / norm);
	}

	// 点积；两个向量均为单位向量时即等于余弦相似度
	static dot(a: number[], b: number[]) {
		let sum = 0;
		const len = Math.min(a.length, b.length);
		for (let i = 0; i < len; i++) sum += a[i] * b[i];
		return sum;
	}

	// 通用余弦相似度，保留给未归一化向量的场景
	static cosineSimilarity(a: number[], b: number[]) {
		let dot = 0;
		let normA = 0;
		let normB = 0;

		for (let i = 0; i < Math.min(a.length, b.length); i++) {
			dot += a[i] * b[i];
			normA += a[i] * a[i];
			normB += b[i] * b[i];
		}

		return dot / (Math.sqrt(normA) * Math.sqrt(normB) || 1);
	}

	search(queryEmbedding: number[], limit: number): VaultSearchResult[] {
		if (!this.index) return [];

		// 查询向量只归一化一次；片段向量在 setIndex 时已归一化，相似度即点积
		const query = VectorStore.normalize(queryEmbedding);

		return this.index.chunks
			.map((chunk) => ({
				path: chunk.path,
				score: VectorStore.dot(query, chunk.embedding),
				excerpt: chunk.text,
				heading: chunk.heading,
				lineStart: chunk.lineStart,
				lineEnd: chunk.lineEnd,
			}))
			.sort((a, b) => b.score - a.score)
			.slice(0, limit);
	}
}