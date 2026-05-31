import { Notice } from "obsidian";
import AiPlugin from "../main";

export function registerVaultCommands(plugin: AiPlugin) {
  plugin.addCommand({
    id: "open-ai-chat-view",
    name: "Open AI Chat view",
    callback: async () => {
      await plugin.activateChatView();
    },
  });

  plugin.addCommand({
    id: "build-vault-vector-index",
    name: "Build Vault vector index",
    callback: async () => {
      await plugin.vaultIndexer.buildVectorIndex();
    },
  });

  plugin.addCommand({
    id: "update-vault-vector-index",
    name: "Update Vault vector index",
    callback: async () => {
      await plugin.vaultIndexer.updateVectorIndex();
    },
  });

  plugin.addCommand({
    id: "clear-vault-vector-index",
    name: "Clear Vault vector index",
    callback: async () => {
      await plugin.vaultIndexer.clearVectorIndex();
    },
  });

  plugin.addCommand({
    id: "ask-ai-with-semantic-vault-search",
    name: "Ask AI with Semantic Vault search",
    callback: async () => {
      await plugin.activateChatView();
      new Notice("请在 AI Chat 面板中提问，插件会使用 Vault 语义检索。");
    },
  });
}
