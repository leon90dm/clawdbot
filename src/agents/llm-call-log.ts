import type { StreamFn } from "@mariozechner/pi-agent-core";
import fs from "node:fs/promises";
import path from "node:path";
import type { OpenClawConfig } from "../config/config.js";
import { resolveUserPath } from "../utils.js";

type LlmCallLogStage = "request" | "request_payload" | "response" | "error";
type LlmCallLogMode = "summary" | "full";

type Aggregate = {
  count: number;
  bytes: number;
  estimatedTokens: number;
};

type MessageSummary = {
  count: number;
  totalBytes: number;
  estimatedTokens: number;
  byRole: Record<string, Aggregate>;
  toolResultByTool: Record<string, Aggregate>;
  topMessages: Array<{ idx: number; role?: string; toolName?: string; bytes: number }>;
};

type ToolsSummary = {
  count: number;
  totalBytes: number;
  estimatedTokens: number;
};

type RequestSummary = {
  context?: {
    systemPromptBytes?: number;
    messages?: MessageSummary;
    tools?: ToolsSummary;
    totalBytes: number;
  };
  options?: {
    keys: string[];
    maxTokens?: number;
    temperature?: number;
    reasoning?: string;
    cacheRetention?: string;
    headersCount?: number;
  };
  model?: {
    id?: string;
    provider?: string;
    api?: string;
    contextWindow?: number;
    maxTokens?: number;
  };
};

type PayloadSummary = {
  totalBytes: number;
  keys: string[];
  model?: string;
  stream?: boolean;
  maxTokens?: number;
  messages?: MessageSummary;
  tools?: ToolsSummary;
};

type ResponseSummary = {
  totalBytes: number;
  stopReason?: string;
  contentBlocks?: number;
  contentTextChars?: number;
  usage?: {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
    total?: number;
  };
  hasErrorMessage?: boolean;
};

type LlmCallLogEvent = {
  ts: string;
  stage: LlmCallLogStage;
  mode: LlmCallLogMode;
  callSeq: number;
  runId?: string;
  sessionId?: string;
  sessionKey?: string;
  provider?: string;
  modelId?: string;
  modelApi?: string | null;
  workspaceDir?: string;
  requestSummary?: RequestSummary;
  payloadSummary?: PayloadSummary;
  responseSummary?: ResponseSummary;
  model?: unknown;
  context?: unknown;
  options?: unknown;
  payload?: unknown;
  response?: unknown;
  error?: string;
};

type LlmCallLogWriter = {
  filePath: string;
  write: (line: string) => void;
};

type LlmCallLogConfig = {
  enabled: boolean;
  filePath: string;
  mode: LlmCallLogMode;
};

const writers = new Map<string, LlmCallLogWriter>();

function estimateTokensFromBytes(bytes: number): number {
  return Math.ceil(Math.max(0, bytes) / 4);
}

function byteLength(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value) ?? "", "utf8");
}

function addAggregate(target: Record<string, Aggregate>, key: string, bytes: number): void {
  const existing = target[key] ?? { count: 0, bytes: 0, estimatedTokens: 0 };
  existing.count += 1;
  existing.bytes += bytes;
  existing.estimatedTokens += estimateTokensFromBytes(bytes);
  target[key] = existing;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function summarizeMessages(messages: unknown): MessageSummary | undefined {
  if (!Array.isArray(messages)) {
    return undefined;
  }

  const byRole: Record<string, Aggregate> = {};
  const toolResultByTool: Record<string, Aggregate> = {};
  const topMessages: Array<{ idx: number; role?: string; toolName?: string; bytes: number }> = [];
  let totalBytes = 0;

  for (let idx = 0; idx < messages.length; idx += 1) {
    const msg = messages[idx];
    const msgRecord = asRecord(msg);
    const role = typeof msgRecord?.role === "string" ? msgRecord.role : "unknown";
    const bytes = byteLength(msg);
    totalBytes += bytes;
    addAggregate(byRole, role, bytes);

    const toolName = typeof msgRecord?.toolName === "string" ? msgRecord.toolName : undefined;
    if ((role === "toolResult" || role === "tool") && toolName) {
      addAggregate(toolResultByTool, toolName, bytes);
    }

    topMessages.push({ idx, role, toolName, bytes });
  }

  topMessages.sort((a, b) => b.bytes - a.bytes);

  return {
    count: messages.length,
    totalBytes,
    estimatedTokens: estimateTokensFromBytes(totalBytes),
    byRole,
    toolResultByTool,
    topMessages: topMessages.slice(0, 8),
  };
}

function summarizeTools(tools: unknown): ToolsSummary | undefined {
  if (!Array.isArray(tools)) {
    return undefined;
  }
  const totalBytes = byteLength(tools);
  return {
    count: tools.length,
    totalBytes,
    estimatedTokens: estimateTokensFromBytes(totalBytes),
  };
}

function summarizeRequest(model: unknown, context: unknown, options: unknown): RequestSummary {
  const contextRecord = asRecord(context);
  const optionsRecord = asRecord(options);
  const modelRecord = asRecord(model);

  const summary: RequestSummary = {};

  if (contextRecord) {
    const systemPrompt = contextRecord.systemPrompt;
    const contextMessages = summarizeMessages(contextRecord.messages);
    const contextTools = summarizeTools(contextRecord.tools);
    summary.context = {
      systemPromptBytes: systemPrompt === undefined ? undefined : byteLength(systemPrompt),
      messages: contextMessages,
      tools: contextTools,
      totalBytes: byteLength(context),
    };
  }

  if (optionsRecord) {
    summary.options = {
      keys: Object.keys(optionsRecord).toSorted(),
      maxTokens: typeof optionsRecord.maxTokens === "number" ? optionsRecord.maxTokens : undefined,
      temperature:
        typeof optionsRecord.temperature === "number" ? optionsRecord.temperature : undefined,
      reasoning: typeof optionsRecord.reasoning === "string" ? optionsRecord.reasoning : undefined,
      cacheRetention:
        typeof optionsRecord.cacheRetention === "string" ? optionsRecord.cacheRetention : undefined,
      headersCount:
        optionsRecord.headers && typeof optionsRecord.headers === "object"
          ? Object.keys(optionsRecord.headers as Record<string, string>).length
          : undefined,
    };
  }

  if (modelRecord) {
    summary.model = {
      id: typeof modelRecord.id === "string" ? modelRecord.id : undefined,
      provider: typeof modelRecord.provider === "string" ? modelRecord.provider : undefined,
      api: typeof modelRecord.api === "string" ? modelRecord.api : undefined,
      contextWindow:
        typeof modelRecord.contextWindow === "number" ? modelRecord.contextWindow : undefined,
      maxTokens: typeof modelRecord.maxTokens === "number" ? modelRecord.maxTokens : undefined,
    };
  }

  return summary;
}

function summarizePayload(payload: unknown): PayloadSummary {
  const payloadRecord = asRecord(payload);
  return {
    totalBytes: byteLength(payload),
    keys: payloadRecord ? Object.keys(payloadRecord).toSorted() : [],
    model: typeof payloadRecord?.model === "string" ? payloadRecord.model : undefined,
    stream: typeof payloadRecord?.stream === "boolean" ? payloadRecord.stream : undefined,
    maxTokens: typeof payloadRecord?.max_tokens === "number" ? payloadRecord.max_tokens : undefined,
    messages: summarizeMessages(payloadRecord?.messages),
    tools: summarizeTools(payloadRecord?.tools),
  };
}

function summarizeResponse(response: unknown): ResponseSummary {
  const responseRecord = asRecord(response);
  const content = Array.isArray(responseRecord?.content) ? responseRecord.content : [];
  let contentTextChars = 0;

  for (const block of content) {
    const blockRecord = asRecord(block);
    if (typeof blockRecord?.text === "string") {
      contentTextChars += blockRecord.text.length;
    }
  }

  const usageRecord = asRecord(responseRecord?.usage);

  return {
    totalBytes: byteLength(response),
    stopReason:
      typeof responseRecord?.stopReason === "string" ? responseRecord.stopReason : undefined,
    contentBlocks: content.length,
    contentTextChars,
    usage: usageRecord
      ? {
          input: typeof usageRecord.input === "number" ? usageRecord.input : undefined,
          output: typeof usageRecord.output === "number" ? usageRecord.output : undefined,
          cacheRead: typeof usageRecord.cacheRead === "number" ? usageRecord.cacheRead : undefined,
          cacheWrite:
            typeof usageRecord.cacheWrite === "number" ? usageRecord.cacheWrite : undefined,
          total: typeof usageRecord.totalTokens === "number" ? usageRecord.totalTokens : undefined,
        }
      : undefined,
    hasErrorMessage: typeof responseRecord?.errorMessage === "string",
  };
}

function resolveLlmCallLogConfig(params: {
  cfg?: OpenClawConfig;
  workspaceDir?: string;
}): LlmCallLogConfig {
  const enabled = params.cfg?.logging?.llmCalls?.enabled ?? false;
  const mode = params.cfg?.logging?.llmCalls?.mode ?? "summary";
  const workspaceDir = params.workspaceDir ? resolveUserPath(params.workspaceDir) : process.cwd();
  const filePath = path.join(workspaceDir, "cache", "llm-calls.jsonl");
  return { enabled, filePath, mode };
}

function getWriter(filePath: string): LlmCallLogWriter {
  const existing = writers.get(filePath);
  if (existing) {
    return existing;
  }

  const ready = fs.mkdir(path.dirname(filePath), { recursive: true }).catch(() => undefined);
  let queue = Promise.resolve();

  const writer: LlmCallLogWriter = {
    filePath,
    write: (line: string) => {
      queue = queue
        .then(() => ready)
        .then(() => fs.appendFile(filePath, line, "utf8"))
        .catch(() => undefined);
    },
  };

  writers.set(filePath, writer);
  return writer;
}

function safeJsonStringify(value: unknown): string | null {
  try {
    return JSON.stringify(value, (_key, val) => {
      if (typeof val === "bigint") {
        return val.toString();
      }
      if (typeof val === "function") {
        return "[Function]";
      }
      if (val instanceof Error) {
        return { name: val.name, message: val.message, stack: val.stack };
      }
      if (val instanceof Uint8Array) {
        return { type: "Uint8Array", data: Buffer.from(val).toString("base64") };
      }
      return val;
    });
  } catch {
    return null;
  }
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.stack || error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  const serialized = safeJsonStringify(error);
  return serialized ?? String(error);
}

function isPromise<T>(value: T | Promise<T>): value is Promise<T> {
  return typeof value === "object" && value !== null && "then" in value;
}

function hasResultMethod(value: unknown): value is { result: () => Promise<unknown> } {
  return (
    typeof value === "object" &&
    value !== null &&
    "result" in value &&
    typeof (value as { result?: unknown }).result === "function"
  );
}

export type LlmCallLogger = {
  enabled: true;
  filePath: string;
  wrapStreamFn: (streamFn: StreamFn) => StreamFn;
};

export function createLlmCallLogger(params: {
  cfg?: OpenClawConfig;
  runId?: string;
  sessionId?: string;
  sessionKey?: string;
  provider?: string;
  modelId?: string;
  modelApi?: string | null;
  workspaceDir?: string;
  writer?: LlmCallLogWriter;
}): LlmCallLogger | null {
  const cfg = resolveLlmCallLogConfig({
    cfg: params.cfg,
    workspaceDir: params.workspaceDir,
  });
  if (!cfg.enabled) {
    return null;
  }

  const writer = params.writer ?? getWriter(cfg.filePath);
  let callSeq = 0;

  const base: Omit<LlmCallLogEvent, "ts" | "stage" | "callSeq" | "mode"> = {
    runId: params.runId,
    sessionId: params.sessionId,
    sessionKey: params.sessionKey,
    provider: params.provider,
    modelId: params.modelId,
    modelApi: params.modelApi,
    workspaceDir: params.workspaceDir,
  };

  const record = (event: Omit<LlmCallLogEvent, "ts" | "mode">) => {
    const line = safeJsonStringify({
      ...event,
      mode: cfg.mode,
      ts: new Date().toISOString(),
    });
    if (line) {
      writer.write(`${line}\n`);
    }
  };

  const wrapStreamFn: LlmCallLogger["wrapStreamFn"] = (streamFn) => {
    const wrapped: StreamFn = (model, context, options) => {
      const nextCallSeq = (callSeq += 1);
      const requestSummary = summarizeRequest(model, context, options);
      record({
        ...base,
        stage: "request",
        callSeq: nextCallSeq,
        requestSummary,
        ...(cfg.mode === "full" ? { model, context, options } : {}),
      });

      const nextOptions = {
        ...options,
        onPayload: (payload: unknown) => {
          const payloadSummary = summarizePayload(payload);
          record({
            ...base,
            stage: "request_payload",
            callSeq: nextCallSeq,
            payloadSummary,
            ...(cfg.mode === "full" ? { payload } : {}),
          });
          options?.onPayload?.(payload);
        },
      };

      const attachResponseLogging = <T>(stream: T): T => {
        if (!hasResultMethod(stream)) {
          return stream;
        }
        void stream
          .result()
          .then((response) => {
            const responseSummary = summarizeResponse(response);
            record({
              ...base,
              stage: "response",
              callSeq: nextCallSeq,
              responseSummary,
              ...(cfg.mode === "full" ? { response } : {}),
            });
          })
          .catch((error) => {
            record({
              ...base,
              stage: "error",
              callSeq: nextCallSeq,
              error: formatError(error),
            });
          });
        return stream;
      };

      try {
        const maybePromise = streamFn(model, context, nextOptions);
        if (isPromise(maybePromise)) {
          return maybePromise
            .then((stream) => attachResponseLogging(stream))
            .catch((error) => {
              record({
                ...base,
                stage: "error",
                callSeq: nextCallSeq,
                error: formatError(error),
              });
              throw error;
            });
        }
        return attachResponseLogging(maybePromise);
      } catch (error) {
        record({
          ...base,
          stage: "error",
          callSeq: nextCallSeq,
          error: formatError(error),
        });
        throw error;
      }
    };
    return wrapped;
  };

  return {
    enabled: true,
    filePath: writer.filePath,
    wrapStreamFn,
  };
}
