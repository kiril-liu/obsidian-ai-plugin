import { FriendlyAiError } from "../types";

export class ErrorFormatter {
  static fromUnknown(error: unknown): FriendlyAiError {
    if (error instanceof DOMException && error.name === "AbortError") {
      return {
        title: "AI 调用已取消",
        message: "你已取消本次 AI 调用。",
        isCancelled: true,
      };
    }

    if (
      typeof error === "object" &&
      error &&
      "title" in error &&
      "message" in error
    ) {
      return error as FriendlyAiError;
    }

    if (error instanceof Error) return this.fromMessage(error.message);
    return this.fromMessage(String(error));
  }

  static fromResponse(status: number, text: string): FriendlyAiError {
    if (status === 401 || status === 403) {
      return {
        title: "API Key 错误或无权限",
        message: "请检查 API Key 是否正确。",
        detail: text,
        statusCode: status,
      };
    }

    if (status === 404) {
      return {
        title: "模型或接口地址不存在",
        message: "请检查 Base URL 和模型名称。",
        detail: text,
        statusCode: status,
      };
    }

    if (status === 429) {
      return {
        title: "请求过于频繁或额度不足",
        message: "请稍后重试，或检查额度。",
        detail: text,
        statusCode: status,
      };
    }

    if (status >= 500) {
      return {
        title: "AI 服务暂时不可用",
        message: "服务端返回错误。",
        detail: text,
        statusCode: status,
      };
    }

    return {
      title: "AI 调用失败",
      message: "请检查模型配置、网络或服务状态。",
      detail: text,
      statusCode: status,
    };
  }

  static fromMessage(message: string): FriendlyAiError {
    const lower = message.toLowerCase();

    if (lower.includes("abort")) {
      return {
        title: "AI 调用已取消",
        message: "你已取消本次 AI 调用。",
        detail: message,
        isCancelled: true,
      };
    }

    if (lower.includes("timeout")) {
      return {
        title: "AI 调用超时",
        message: "请求等待时间过长。",
        detail: message,
      };
    }

    if (lower.includes("failed to fetch") || lower.includes("network")) {
      return {
        title: "网络连接失败",
        message: "请检查网络、Base URL 或本地服务。",
        detail: message,
      };
    }

    if (lower.includes("embedding")) {
      return {
        title: "Embedding 调用失败",
        message: "请检查 Embedding 配置。",
        detail: message,
      };
    }

    return {
      title: "AI 调用失败",
      message: "请检查 API Key、Base URL、模型名称或网络。",
      detail: message,
    };
  }

  static toNoticeText(error: FriendlyAiError) {
    return `${error.title}：${error.message}`;
  }

  static toMarkdown(error: FriendlyAiError) {
    return [
      `## ${error.title}`,
      "",
      error.message,
      error.detail ? `\n\`\`\`text\n${error.detail}\n\`\`\`` : "",
    ].join("\n");
  }
}
