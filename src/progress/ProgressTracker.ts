import { Notice } from "obsidian";
import AiPlugin from "../main";
import { AiProgressState, AiProgressStep } from "../types";

export class ProgressTracker {
  plugin: AiPlugin;
  state: AiProgressState | null = null;
  abortController: AbortController | null = null;

  constructor(plugin: AiPlugin) {
    this.plugin = plugin;
  }

  start(title: string, steps: string[]) {
    this.abortController = new AbortController();

    this.state = {
      active: true,
      title,
      startedAt: Date.now(),
      currentStep: steps[0] ?? "",
      steps: steps.map((label, index) => ({
        label,
        status: index === 0 ? "running" : "pending",
        startedAt: index === 0 ? Date.now() : undefined,
      })),
    };

    this.plugin.refreshProgressViews();
    return this.abortController.signal;
  }

  setStep(label: string, detail?: string) {
    if (!this.state) return;

    let found = false;

    this.state.steps = this.state.steps.map((step) => {
      if (step.label === label) {
        found = true;
        return {
          ...step,
          status: "running",
          detail,
          startedAt: step.startedAt ?? Date.now(),
        };
      }

      if (!found && step.status === "running") {
        return { ...step, status: "done", endedAt: Date.now() };
      }

      return step;
    });

    this.state.currentStep = label;
    this.plugin.refreshProgressViews();
  }

  complete(detail?: string) {
    if (!this.state) return;

    this.state.active = false;
    this.state.endedAt = Date.now();
    this.state.steps = this.state.steps.map((step) => ({
      ...step,
      status:
        step.status === "pending" || step.status === "running"
          ? "done"
          : step.status,
      endedAt: step.endedAt ?? Date.now(),
    }));

    if (detail) new Notice(detail);
    this.plugin.refreshProgressViews();
  }

  fail(error: string) {
    if (!this.state) return;

    this.state.active = false;
    this.state.error = error;
    this.state.endedAt = Date.now();
    this.state.steps = this.state.steps.map((step) =>
      step.status === "running"
        ? { ...step, status: "failed", endedAt: Date.now(), detail: error }
        : step,
    );

    this.plugin.refreshProgressViews();
  }

  cancel() {
    this.abortController?.abort();

    if (!this.state) return;

    this.state.active = false;
    this.state.cancelled = true;
    this.state.endedAt = Date.now();
    this.state.steps = this.state.steps.map((step) =>
      step.status === "running"
        ? { ...step, status: "cancelled", endedAt: Date.now() }
        : step,
    );

    this.plugin.refreshProgressViews();
    new Notice("已取消 AI 调用");
  }

  getSignal() {
    return this.abortController?.signal;
  }

  getState() {
    return this.state;
  }
}
