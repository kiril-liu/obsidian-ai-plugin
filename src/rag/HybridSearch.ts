import AiPlugin from "../main";
import { HybridSearchResult, VaultSearchResult } from "../types";

export class HybridSearch {
  plugin: AiPlugin;

  constructor(plugin: AiPlugin) {
    this.plugin = plugin;
  }

  async search(
    query: string,
    semanticResults: VaultSearchResult[],
  ): Promise<HybridSearchResult[]> {
    const keywordResults = await this.plugin.keywordSearch.search(query);
    const merged = new Map<string, HybridSearchResult>();

    for (const result of semanticResults) {
      merged.set(result.path, {
        ...result,
        semanticScore: this.normalize(result.score),
        keywordScore: 0,
        recencyScore: await this.getRecencyScore(result.path),
        score: 0,
      });
    }

    for (const result of keywordResults) {
      const existing = merged.get(result.path);

      if (existing) {
        existing.keywordScore = this.normalize(result.score);
      } else {
        merged.set(result.path, {
          ...result,
          semanticScore: 0,
          keywordScore: this.normalize(result.score),
          recencyScore: await this.getRecencyScore(result.path),
          score: 0,
        });
      }
    }

    const semanticWeight = this.plugin.settings.hybridSemanticWeight;
    const keywordWeight = this.plugin.settings.hybridKeywordWeight;
    const recencyWeight = this.plugin.settings.hybridRecencyWeight;

    return [...merged.values()]
      .map((result) => ({
        ...result,
        score:
          result.semanticScore * semanticWeight +
          result.keywordScore * keywordWeight +
          result.recencyScore * recencyWeight,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, this.plugin.settings.vectorSearchMaxResults);
  }

  normalize(score: number) {
    return Math.max(0, Math.min(1, score));
  }

  async getRecencyScore(path: string) {
	const file = this.plugin.app.vault.getAbstractFileByPath(path);

	if (!file || !("stat" in file)) {
		return 0;
	}

	const stat = file.stat as { mtime: number };
	const ageDays = Math.max(0, (Date.now() - stat.mtime) / 86400000);

	return Math.max(0, 1 - ageDays / 30);
	}
}
