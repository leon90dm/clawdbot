import type { StreamFn } from "@mariozechner/pi-agent-core";
import { describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../config/config.js";
import { createLlmCallLogger } from "./llm-call-log.js";

describe("createLlmCallLogger", () => {
  it("returns null when logging.llmCalls.enabled is not true", () => {
    const logger = createLlmCallLogger({
      cfg: {} as OpenClawConfig,
      workspaceDir: "/tmp/workspace",
    });
    expect(logger).toBeNull();
  });

  it("records compact summaries by default when enabled", async () => {
    const lines: string[] = [];
    const logger = createLlmCallLogger({
      cfg: {
        logging: {
          llmCalls: {
            enabled: true,
          },
        },
      },
      runId: "run-1",
      sessionId: "session-1",
      workspaceDir: "/tmp/workspace",
      writer: {
        filePath: "memory",
        write: (line) => lines.push(line),
      },
    });
    expect(logger).not.toBeNull();

    const streamFn: StreamFn = ((_model, _context, options) => {
      options?.onPayload?.({ raw: "payload" });
      return {
        result: async () =>
          ({
            role: "assistant",
            provider: "openai",
            model: "gpt-5.2",
            api: "openai-responses",
            content: [{ type: "text", text: "ok" }],
            usage: {
              input: 1,
              output: 2,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: 3,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
            },
            stopReason: "stop",
            timestamp: Date.now(),
          }) as unknown,
      } as unknown;
    }) as StreamFn;

    const wrapped = logger?.wrapStreamFn(streamFn);
    const stream = wrapped?.(
      { id: "gpt-5.2", provider: "openai", api: "openai-responses" } as never,
      { messages: [] } as never,
      {},
    ) as { result: () => Promise<unknown> };

    await stream.result();
    await Promise.resolve();

    expect(lines.length).toBe(3);
    const parsed = lines.map((line) => JSON.parse(line));
    const stages = parsed.map((line) => line.stage);
    expect(stages).toEqual(["request", "request_payload", "response"]);
    expect(parsed[0]?.mode).toBe("summary");
    expect(parsed[0]?.requestSummary?.context?.messages?.count).toBe(0);
    expect(parsed[0]?.context).toBeUndefined();
    expect(parsed[1]?.payloadSummary?.totalBytes).toBeGreaterThan(0);
    expect(parsed[1]?.payload).toBeUndefined();
    expect(parsed[2]?.responseSummary?.usage?.total).toBe(3);
    expect(parsed[2]?.response).toBeUndefined();
  });

  it("includes full bodies when mode=full", async () => {
    const lines: string[] = [];
    const logger = createLlmCallLogger({
      cfg: {
        logging: {
          llmCalls: {
            enabled: true,
            mode: "full",
          },
        },
      },
      writer: {
        filePath: "memory",
        write: (line) => lines.push(line),
      },
    });

    const streamFn: StreamFn = ((_model, _context, options) => {
      options?.onPayload?.({ raw: "payload" });
      return {
        result: async () => ({ role: "assistant", content: [], usage: { totalTokens: 0 } }),
      } as unknown;
    }) as StreamFn;

    const wrapped = logger?.wrapStreamFn(streamFn);
    const stream = wrapped?.(
      { id: "m", provider: "p", api: "a" } as never,
      { messages: [] } as never,
      {},
    ) as {
      result: () => Promise<unknown>;
    };
    await stream.result();
    await Promise.resolve();

    const parsed = lines.map((line) => JSON.parse(line));
    expect(parsed[0]?.mode).toBe("full");
    expect(parsed[0]?.context).toBeDefined();
    expect(parsed[1]?.payload).toBeDefined();
    expect(parsed[2]?.response).toBeDefined();
  });
});
