import AiPlugin from "../main";
import { ErrorFormatter } from "../errors/ErrorFormatter";

export class EmbeddingClient {
  plugin: AiPlugin;

  constructor(plugin: AiPlugin) {
    this.plugin = plugin;
  }

  async embed(inputs: string[], signal?: AbortSignal): Promise<number[][]> {
    if (inputs.length === 0) return [];

    try {
      const baseUrl =
        this.plugin.settings.embeddingBaseUrl || this.plugin.settings.baseUrl;

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
        throw ErrorFormatter.fromResponse(
          response.status,
          `Embedding error: ${await response.text()}`,
        );
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
