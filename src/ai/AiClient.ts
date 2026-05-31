import { Notice } from "obsidian";
import AiPlugin from "../main";
import { ErrorFormatter } from "../errors/ErrorFormatter";

export class AiClient {
  plugin: AiPlugin;

  constructor(plugin: AiPlugin) {
    this.plugin = plugin;
  }

  async chat(prompt: string, signal?: AbortSignal): Promise<string> {
    if (!this.plugin.settings.apiKey) {
      new Notice("请先填写 API Key");
      return "";
    }

    try {
      const response = await fetch(
        `${this.plugin.settings.baseUrl}/chat/completions`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.plugin.settings.apiKey}`,
          },
          signal,
          body: JSON.stringify({
            model: this.plugin.settings.model,
            messages: [
              {
                role: "system",
                content: "你是一个帮助用户整理 Obsidian 笔记的中文 AI 助手。",
              },
              { role: "user", content: prompt },
            ],
            temperature: 0.7,
          }),
        },
      );

      if (!response.ok) {
        throw ErrorFormatter.fromResponse(
          response.status,
          await response.text(),
        );
      }

      const data = await response.json();
      return data.choices?.[0]?.message?.content ?? "";
    } catch (error) {
      throw ErrorFormatter.fromUnknown(error);
    }
  }
}
