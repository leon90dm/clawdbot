import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { resolveImplicitProviders } from "./models-config.providers.js";

describe("Ollama provider", () => {
  it("should not include ollama when no API key is configured", async () => {
    const agentDir = mkdtempSync(join(tmpdir(), "openclaw-test-"));
    const providers = await resolveImplicitProviders({ agentDir });

    // Ollama requires explicit configuration via OLLAMA_API_KEY env var or profile
    expect(providers?.ollama).toBeUndefined();
  });
});

describe("Bytedance provider", () => {
  it("should not include bytedance-dev1 when no auth token is configured", async () => {
    const previous = process.env.BYTEDANCE_LLM_AUTH_TOKEN;
    try {
      delete process.env.BYTEDANCE_LLM_AUTH_TOKEN;
      const agentDir = mkdtempSync(join(tmpdir(), "openclaw-test-"));
      const providers = await resolveImplicitProviders({ agentDir });
      expect(providers?.["bytedance-dev1"]).toBeUndefined();
    } finally {
      if (previous === undefined) {
        delete process.env.BYTEDANCE_LLM_AUTH_TOKEN;
      } else {
        process.env.BYTEDANCE_LLM_AUTH_TOKEN = previous;
      }
    }
  });

  it("should include bytedance-dev1 and discover models when configured", async () => {
    const previous = {
      token: process.env.BYTEDANCE_LLM_AUTH_TOKEN,
      baseUrl: process.env.BYTEDANCE_LLM_BASE_URL,
      apiVersion: process.env.BYTEDANCE_LLM_API_VERSION,
      vitest: process.env.VITEST,
      nodeEnv: process.env.NODE_ENV,
    };

    const fetchMock = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => ({
      ok: true,
      status: 200,
      json: async () => ({ data: [{ id: "model-a" }, { id: "model-b", name: "Model B" }] }),
    }));

    try {
      process.env.BYTEDANCE_LLM_AUTH_TOKEN = "token-123";
      process.env.BYTEDANCE_LLM_BASE_URL = "http://example.com";
      process.env.BYTEDANCE_LLM_API_VERSION = "2024-02-01";
      delete process.env.VITEST;
      process.env.NODE_ENV = "development";

      vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

      const agentDir = mkdtempSync(join(tmpdir(), "openclaw-test-"));
      const providers = await resolveImplicitProviders({ agentDir });
      const provider = providers?.["bytedance-dev1"];

      expect(provider).toBeTruthy();
      expect(provider?.baseUrl).toBe("http://example.com");
      expect(provider?.apiKey).toBe("BYTEDANCE_LLM_AUTH_TOKEN");
      expect(provider?.headers).toEqual({
        "auth-token": "token-123",
        "api-version": "2024-02-01",
      });
      expect(provider?.models?.map((m) => ({ id: m.id, name: m.name }))).toEqual([
        { id: "model-a", name: "model-a" },
        { id: "model-b", name: "Model B" },
      ]);
      expect(fetchMock).toHaveBeenCalledWith("http://example.com/models", expect.any(Object));
      expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
        headers: { "auth-token": "token-123", "api-version": "2024-02-01" },
      });
    } finally {
      vi.unstubAllGlobals();
      if (previous.token === undefined) {
        delete process.env.BYTEDANCE_LLM_AUTH_TOKEN;
      } else {
        process.env.BYTEDANCE_LLM_AUTH_TOKEN = previous.token;
      }
      if (previous.baseUrl === undefined) {
        delete process.env.BYTEDANCE_LLM_BASE_URL;
      } else {
        process.env.BYTEDANCE_LLM_BASE_URL = previous.baseUrl;
      }
      if (previous.apiVersion === undefined) {
        delete process.env.BYTEDANCE_LLM_API_VERSION;
      } else {
        process.env.BYTEDANCE_LLM_API_VERSION = previous.apiVersion;
      }
      if (previous.vitest === undefined) {
        delete process.env.VITEST;
      } else {
        process.env.VITEST = previous.vitest;
      }
      if (previous.nodeEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = previous.nodeEnv;
      }
    }
  });
});
