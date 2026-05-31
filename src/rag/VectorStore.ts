import {
  VaultSearchResult,
  VaultVectorIndex,
  VectorChunk,
  VectorChunkInput,
} from "../types";

export class VectorStore {
  index: VaultVectorIndex | null = null;

  setIndex(index: VaultVectorIndex | null) {
    this.index = index;
  }

  getIndex() {
    return this.index;
  }

  createIndex(
    chunks: VectorChunk[],
    options: {
      embeddingModel: string;
      chunkMaxChars: number;
      chunkOverlapChars: number;
      excludedFolders: string;
    },
  ): VaultVectorIndex {
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

    return this.index.chunks
      .map((chunk) => ({
        path: chunk.path,
        score: VectorStore.cosineSimilarity(queryEmbedding, chunk.embedding),
        excerpt: chunk.text,
        heading: chunk.heading,
        lineStart: chunk.lineStart,
        lineEnd: chunk.lineEnd,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }
}
