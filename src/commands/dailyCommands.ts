import { Notice } from "obsidian";
import AiPlugin from "../main";

export function registerDailyCommands(plugin: AiPlugin) {
  plugin.addCommand({
    id: "create-life-prompt-pack",
    name: "Create life prompt pack",
    callback: async () => {
      await plugin.promptManager.createLifePromptPack();
    },
  });

  plugin.addCommand({
    id: "generate-daily-review",
    name: "Generate daily review",
    callback: async () => {
      await runDailyWorkflow(plugin, "每日复盘");
    },
  });

  plugin.addCommand({
    id: "generate-tomorrow-plan",
    name: "Generate tomorrow plan",
    callback: async () => {
      await runDailyWorkflow(plugin, "明日计划");
    },
  });

  plugin.addCommand({
    id: "generate-weekly-review",
    name: "Generate weekly review",
    callback: async () => {
      await runDailyWorkflow(plugin, "周回顾");
    },
  });

  plugin.addCommand({
    id: "collect-recent-todos",
    name: "Collect recent TODOs",
    callback: async () => {
      await runDailyWorkflow(plugin, "最近 TODO 汇总");
    },
  });
}

async function runDailyWorkflow(plugin: AiPlugin, templateName: string) {
  const template = await plugin.promptManager.getTemplateByName(templateName);

  if (!template) {
    new Notice(`没有找到模板：${templateName}，请先创建 Life Prompt Pack`);
    return;
  }

  const context = await plugin.dailyNoteManager.getContext();

  const prompt = plugin.promptManager.renderTemplate(
    template,
    plugin.promptManager.buildRenderContext({
      note: context.todayContent,
      vaultContext: context.combinedRecentContent,
      filePath: context.todayPath,
      fileName: context.todayPath.split("/").pop() ?? "",
      question: templateName,
    }),
  );

  const answer = await plugin.aiClient.chat(prompt);

  const today = await plugin.dailyNoteManager.ensureTodayNote();
  const oldContent = await plugin.app.vault.cachedRead(today);

  await plugin.app.vault.modify(
    today,
    `${oldContent}\n\n## ${templateName}\n\n${answer}\n`,
  );

  new Notice(`${templateName} 已写入今日 Daily Note`);
}
