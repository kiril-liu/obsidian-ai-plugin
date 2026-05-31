import { SourceReference, VaultSearchResult } from "../types";

export class SourceFormatter {
	
	static getFileName(path: string) {
	return path.split("/").pop() ?? path;
	}

  static fromResults(results: VaultSearchResult[]): SourceReference[] {
    return results.map((result) => ({ ...result }));
  }

  static toContextText(results: SourceReference[]) {
    return results
      .map((source, index) => {
        const line = source.lineStart
          ? ` 行 ${source.lineStart}${source.lineEnd ? `-${source.lineEnd}` : ""}`
          : "";
        const heading = source.heading ? ` / ${source.heading}` : "";
        return `[${index + 1}] ${source.path}${heading}${line}\n${source.excerpt}`;
      })
      .join("\n\n---\n\n");
  }
  
  static toMarkdown(sources: Array<{ path: string }>) {
	if (!sources.length) return "";

	return sources
		.map((source, index) => {
			const fileName = this.getFileName(source.path);
			return `${index + 1}. ${fileName}\n   ${source.path}`;
		})
		.join("\n");
	}
}
