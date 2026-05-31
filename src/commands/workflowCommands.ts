import { Notice, TFile } from "obsidian";
import AiPlugin from "../main";
import { OutputPreviewModal } from "../output/OutputPreviewModal";

export function registerWorkflowCommands(plugin: AiPlugin) {
  plugin.addCommand({
    id: "reload-prompt-template-commands",
    name: "Reload prompt template commands",
    callback: async () => {
      await plugin.promptCommandRegistry.reloadCommandsNotice();
    },
  });

  plugin.addCommand({
    id: "show-prompt-run-history",
    name: "Show prompt run history",
    callback: async () => {
      const markdown = plugin.promptRunHistory.toMarkdown();

      new OutputPreviewModal(
        plugin.app,
        {
          title: "Prompt 运行历史",
          content: markdown,
          defaultAction: "copy_to_clipboard",
        },
        async () => {
          await navigator.clipboard.writeText(markdown);
        },
      ).open();
    },
  });

  plugin.addCommand({
    id: "clear-prompt-run-history",
    name: "Clear prompt run history",
    callback: async () => {
      plugin.promptRunHistory.clear();
    },
  });

  plugin.addCommand({
    id: "batch-run-prompt-on-current-folder",
    name: "Batch run prompt on current folder",
    callback: async () => {
      const activeFile = plugin.app.workspace.getActiveFile();

      if (!activeFile) {
        new Notice("当前没有打开文件");
        return;
      }

      const folder = activeFile.parent;
      const files =
        folder?.children.filter(
          (item): item is TFile =>
            item instanceof TFile && item.extension === "md",
        ) ?? [];

      const templates = await plugin.promptManager.loadTemplates(true);
      const firstTemplate = templates[0];

      if (!firstTemplate) {
        new Notice("没有可运行的 Prompt 模板");
        return;
      }

      await plugin.batchPromptRunner.run({
        templateName: firstTemplate.name,
        filePaths: files.map((file) => file.path),
        outputTarget: "new_note",
        outputFolder: plugin.settings.workflowOutputFolder,
      });
    },
  });
}
