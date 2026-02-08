import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../config/config.js";
import { getMemorySearchManager, type MemoryIndexManager } from "./index.js";

let embedBatchCalls = 0;
let failEmbeddings = false;
let failQueryEmbeddings = false;

vi.mock("./embeddings.js", () => {
  const embedText = (text: string) => {
    const lower = text.toLowerCase();
    const alpha = lower.split("alpha").length - 1;
    const beta = lower.split("beta").length - 1;
    return [alpha, beta];
  };
  return {
    createEmbeddingProvider: async (options: { model?: string }) => ({
      requestedProvider: "openai",
      provider: {
        id: "mock",
        model: options.model ?? "mock-embed",
        embedQuery: async (text: string) => {
          if (failQueryEmbeddings) {
            throw new Error("mock embeddings query failed");
          }
          return embedText(text);
        },
        embedBatch: async (texts: string[]) => {
          embedBatchCalls += 1;
          if (failEmbeddings) {
            throw new Error("mock embeddings failed");
          }
          return texts.map(embedText);
        },
      },
    }),
  };
});

describe("memory index", () => {
  let workspaceDir: string;
  let indexPath: string;
  let manager: MemoryIndexManager | null = null;

  beforeEach(async () => {
    embedBatchCalls = 0;
    failEmbeddings = false;
    failQueryEmbeddings = false;
    workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-mem-"));
    indexPath = path.join(workspaceDir, "index.sqlite");
    await fs.mkdir(path.join(workspaceDir, "memory"));
    await fs.writeFile(
      path.join(workspaceDir, "memory", "2026-01-12.md"),
      "# Log\nAlpha memory line.\nZebra memory line.\nAnother line.",
    );
    await fs.writeFile(path.join(workspaceDir, "MEMORY.md"), "Beta knowledge base entry.");
  });

  afterEach(async () => {
    if (manager) {
      await manager.close();
      manager = null;
    }
    await fs.rm(workspaceDir, { recursive: true, force: true });
  });

  it("indexes memory files and searches by vector", async () => {
    const cfg = {
      agents: {
        defaults: {
          workspace: workspaceDir,
          memorySearch: {
            provider: "openai",
            model: "mock-embed",
            store: { path: indexPath },
            sync: { watch: false, onSessionStart: false, onSearch: true },
            query: { minScore: 0 },
          },
        },
        list: [{ id: "main", default: true }],
      },
    } satisfies OpenClawConfig;
    const result = await getMemorySearchManager({ cfg, agentId: "main" });
    expect(result.manager).not.toBeNull();
    if (!result.manager) {
      throw new Error("manager missing");
    }
    const mgr = result.manager as MemoryIndexManager;
    manager = mgr;
    await mgr.sync({ force: true });
    const results = await mgr.search("alpha");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.path).toContain("memory/2026-01-12.md");
    const status = mgr.status();
    expect(status.sourceCounts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "memory",
          files: status.files,
          chunks: status.chunks,
        }),
      ]),
    );
  });

  it("reindexes when the embedding model changes", async () => {
    const base = {
      agents: {
        defaults: {
          workspace: workspaceDir,
          memorySearch: {
            provider: "openai",
            store: { path: indexPath },
            sync: { watch: false, onSessionStart: false, onSearch: true },
            query: { minScore: 0 },
          },
        },
        list: [{ id: "main", default: true }],
      },
    } satisfies OpenClawConfig;

    const firstCfg = {
      ...base,
      agents: {
        ...base.agents,
        defaults: {
          ...base.agents.defaults,
          memorySearch: {
            ...base.agents.defaults.memorySearch,
            model: "mock-embed-v1",
          },
        },
      },
    } satisfies OpenClawConfig;
    const first = await getMemorySearchManager({
      cfg: firstCfg,
      agentId: "main",
    });
    expect(first.manager).not.toBeNull();
    if (!first.manager) {
      throw new Error("manager missing");
    }
    const firstMgr = first.manager as MemoryIndexManager;
    await firstMgr.sync({ force: true });
    await firstMgr.close();

    const secondCfg = {
      ...base,
      agents: {
        ...base.agents,
        defaults: {
          ...base.agents.defaults,
          memorySearch: {
            ...base.agents.defaults.memorySearch,
            model: "mock-embed-v2",
          },
        },
      },
    } satisfies OpenClawConfig;
    const second = await getMemorySearchManager({
      cfg: secondCfg,
      agentId: "main",
    });
    expect(second.manager).not.toBeNull();
    if (!second.manager) {
      throw new Error("manager missing");
    }
    const secondMgr = second.manager as MemoryIndexManager;
    manager = secondMgr;
    await secondMgr.sync({ reason: "test" });
    const results = await secondMgr.search("alpha");
    expect(results.length).toBeGreaterThan(0);
  });

  it("reuses cached embeddings on forced reindex", async () => {
    const cfg = {
      agents: {
        defaults: {
          workspace: workspaceDir,
          memorySearch: {
            provider: "openai",
            model: "mock-embed",
            store: { path: indexPath, vector: { enabled: false } },
            sync: { watch: false, onSessionStart: false, onSearch: false },
            query: { minScore: 0 },
            cache: { enabled: true },
          },
        },
        list: [{ id: "main", default: true }],
      },
    } satisfies OpenClawConfig;
    const result = await getMemorySearchManager({ cfg, agentId: "main" });
    expect(result.manager).not.toBeNull();
    if (!result.manager) {
      throw new Error("manager missing");
    }
    const mgr = result.manager as MemoryIndexManager;
    manager = mgr;
    await mgr.sync({ force: true });
    const afterFirst = embedBatchCalls;
    expect(afterFirst).toBeGreaterThan(0);

    await mgr.sync({ force: true });
    expect(embedBatchCalls).toBe(afterFirst);
  });

  it("preserves existing index when forced reindex fails", async () => {
    const cfg = {
      agents: {
        defaults: {
          workspace: workspaceDir,
          memorySearch: {
            provider: "openai",
            model: "mock-embed",
            store: { path: indexPath, vector: { enabled: false } },
            sync: { watch: false, onSessionStart: false, onSearch: false },
            query: { minScore: 0 },
            cache: { enabled: false },
          },
        },
        list: [{ id: "main", default: true }],
      },
    } satisfies OpenClawConfig;
    const result = await getMemorySearchManager({ cfg, agentId: "main" });
    expect(result.manager).not.toBeNull();
    if (!result.manager) {
      throw new Error("manager missing");
    }
    const mgr = result.manager as MemoryIndexManager;
    manager = mgr;

    await mgr.sync({ force: true });
    const before = mgr.status();
    expect(before.files).toBeGreaterThan(0);

    failEmbeddings = true;
    await expect(mgr.sync({ force: true })).rejects.toThrow(/mock embeddings failed/i);

    const after = mgr.status();
    expect(after.files).toBe(before.files);
    expect(after.chunks).toBe(before.chunks);

    const files = await fs.readdir(workspaceDir);
    expect(files.some((name) => name.includes(".tmp-"))).toBe(false);
  });

  it("finds keyword matches via hybrid search when query embedding is zero", async () => {
    const cfg = {
      agents: {
        defaults: {
          workspace: workspaceDir,
          memorySearch: {
            provider: "openai",
            model: "mock-embed",
            store: { path: indexPath, vector: { enabled: false } },
            sync: { watch: false, onSessionStart: false, onSearch: true },
            query: {
              minScore: 0,
              hybrid: { enabled: true, vectorWeight: 0, textWeight: 1 },
            },
          },
        },
        list: [{ id: "main", default: true }],
      },
    } satisfies OpenClawConfig;
    const result = await getMemorySearchManager({ cfg, agentId: "main" });
    expect(result.manager).not.toBeNull();
    if (!result.manager) {
      throw new Error("manager missing");
    }
    const mgr = result.manager as MemoryIndexManager;
    manager = mgr;

    const status = mgr.status();
    if (!status.fts?.available) {
      return;
    }

    await mgr.sync({ force: true });
    const results = await mgr.search("zebra");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.path).toContain("memory/2026-01-12.md");
  });

  it("falls back to keyword search when query embeddings fail", async () => {
    const cfg = {
      agents: {
        defaults: {
          workspace: workspaceDir,
          memorySearch: {
            provider: "openai",
            model: "mock-embed",
            store: { path: indexPath, vector: { enabled: false } },
            sync: { watch: false, onSessionStart: false, onSearch: false },
            query: {
              minScore: 0,
              hybrid: { enabled: true, vectorWeight: 0.5, textWeight: 0.5 },
            },
          },
        },
        list: [{ id: "main", default: true }],
      },
    } satisfies OpenClawConfig;
    const result = await getMemorySearchManager({ cfg, agentId: "main" });
    expect(result.manager).not.toBeNull();
    if (!result.manager) {
      throw new Error("manager missing");
    }
    const mgr = result.manager as MemoryIndexManager;
    manager = mgr;

    const status = mgr.status();
    if (!status.fts?.available) {
      return;
    }

    await mgr.sync({ force: true });
    failQueryEmbeddings = true;
    const results = await mgr.search("zebra");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.path).toContain("memory/2026-01-12.md");
  });

  it("hybrid weights can favor vector-only matches over keyword-only matches", async () => {
    const manyAlpha = Array.from({ length: 200 }, () => "Alpha").join(" ");
    await fs.writeFile(
      path.join(workspaceDir, "memory", "vector-only.md"),
      "Alpha beta. Alpha beta. Alpha beta. Alpha beta.",
    );
    await fs.writeFile(
      path.join(workspaceDir, "memory", "keyword-only.md"),
      `${manyAlpha} beta id123.`,
    );

    const cfg = {
      agents: {
        defaults: {
          workspace: workspaceDir,
          memorySearch: {
            provider: "openai",
            model: "mock-embed",
            store: { path: indexPath, vector: { enabled: false } },
            sync: { watch: false, onSessionStart: false, onSearch: true },
            query: {
              minScore: 0,
              maxResults: 200,
              hybrid: {
                enabled: true,
                vectorWeight: 0.99,
                textWeight: 0.01,
                candidateMultiplier: 10,
              },
            },
          },
        },
        list: [{ id: "main", default: true }],
      },
    } satisfies OpenClawConfig;
    const result = await getMemorySearchManager({ cfg, agentId: "main" });
    expect(result.manager).not.toBeNull();
    if (!result.manager) {
      throw new Error("manager missing");
    }
    const mgr = result.manager as MemoryIndexManager;
    manager = mgr;

    const status = mgr.status();
    if (!status.fts?.available) {
      return;
    }

    await mgr.sync({ force: true });
    const results = await mgr.search("alpha beta id123");
    expect(results.length).toBeGreaterThan(0);
    const paths = results.map((r) => r.path);
    expect(paths).toContain("memory/vector-only.md");
    expect(paths).toContain("memory/keyword-only.md");
    const vectorOnly = results.find((r) => r.path === "memory/vector-only.md");
    const keywordOnly = results.find((r) => r.path === "memory/keyword-only.md");
    expect((vectorOnly?.score ?? 0) > (keywordOnly?.score ?? 0)).toBe(true);
  });

  it("hybrid weights can favor keyword matches when text weight dominates", async () => {
    const manyAlpha = Array.from({ length: 200 }, () => "Alpha").join(" ");
    await fs.writeFile(
      path.join(workspaceDir, "memory", "vector-only.md"),
      "Alpha beta. Alpha beta. Alpha beta. Alpha beta.",
    );
    await fs.writeFile(
      path.join(workspaceDir, "memory", "keyword-only.md"),
      `${manyAlpha} beta id123.`,
    );

    const cfg = {
      agents: {
        defaults: {
          workspace: workspaceDir,
          memorySearch: {
            provider: "openai",
            model: "mock-embed",
            store: { path: indexPath, vector: { enabled: false } },
            sync: { watch: false, onSessionStart: false, onSearch: true },
            query: {
              minScore: 0,
              maxResults: 200,
              hybrid: {
                enabled: true,
                vectorWeight: 0.01,
                textWeight: 0.99,
                candidateMultiplier: 10,
              },
            },
          },
        },
        list: [{ id: "main", default: true }],
      },
    } satisfies OpenClawConfig;
    const result = await getMemorySearchManager({ cfg, agentId: "main" });
    expect(result.manager).not.toBeNull();
    if (!result.manager) {
      throw new Error("manager missing");
    }
    const mgr = result.manager as MemoryIndexManager;
    manager = mgr;

    const status = mgr.status();
    if (!status.fts?.available) {
      return;
    }

    await mgr.sync({ force: true });
    const results = await mgr.search("alpha beta id123");
    expect(results.length).toBeGreaterThan(0);
    const paths = results.map((r) => r.path);
    expect(paths).toContain("memory/vector-only.md");
    expect(paths).toContain("memory/keyword-only.md");
    const vectorOnly = results.find((r) => r.path === "memory/vector-only.md");
    const keywordOnly = results.find((r) => r.path === "memory/keyword-only.md");
    expect((keywordOnly?.score ?? 0) > (vectorOnly?.score ?? 0)).toBe(true);
  });

  it("reports vector availability after probe", async () => {
    const cfg = {
      agents: {
        defaults: {
          workspace: workspaceDir,
          memorySearch: {
            provider: "openai",
            model: "mock-embed",
            store: { path: indexPath },
            sync: { watch: false, onSessionStart: false, onSearch: false },
          },
        },
        list: [{ id: "main", default: true }],
      },
    } satisfies OpenClawConfig;
    const result = await getMemorySearchManager({ cfg, agentId: "main" });
    expect(result.manager).not.toBeNull();
    if (!result.manager) {
      throw new Error("manager missing");
    }
    const mgr = result.manager as MemoryIndexManager;
    manager = mgr;
    const available = await mgr.probeVectorAvailability();
    const status = mgr.status();
    expect(status.vector?.enabled).toBe(true);
    expect(typeof status.vector?.available).toBe("boolean");
    expect(status.vector?.available).toBe(available);
  });

  it("rejects reading non-memory paths", async () => {
    const cfg = {
      agents: {
        defaults: {
          workspace: workspaceDir,
          memorySearch: {
            provider: "openai",
            model: "mock-embed",
            store: { path: indexPath },
            sync: { watch: false, onSessionStart: false, onSearch: true },
          },
        },
        list: [{ id: "main", default: true }],
      },
    } satisfies OpenClawConfig;
    const result = await getMemorySearchManager({ cfg, agentId: "main" });
    expect(result.manager).not.toBeNull();
    if (!result.manager) {
      throw new Error("manager missing");
    }
    const mgr = result.manager as MemoryIndexManager;
    manager = mgr;
    await expect(mgr.readFile({ relPath: "NOTES.md" })).rejects.toThrow("path required");
  });

  it("allows reading from additional memory paths and blocks symlinks", async () => {
    const extraDir = path.join(workspaceDir, "extra");
    await fs.mkdir(extraDir, { recursive: true });
    await fs.writeFile(path.join(extraDir, "extra.md"), "Extra content.");

    const cfg = {
      agents: {
        defaults: {
          workspace: workspaceDir,
          memorySearch: {
            provider: "openai",
            model: "mock-embed",
            store: { path: indexPath },
            sync: { watch: false, onSessionStart: false, onSearch: true },
            extraPaths: [extraDir],
          },
        },
        list: [{ id: "main", default: true }],
      },
    } satisfies OpenClawConfig;
    const result = await getMemorySearchManager({ cfg, agentId: "main" });
    expect(result.manager).not.toBeNull();
    if (!result.manager) {
      throw new Error("manager missing");
    }
    const mgr = result.manager as MemoryIndexManager;
    manager = mgr;
    await expect(mgr.readFile({ relPath: "extra/extra.md" })).resolves.toEqual({
      path: "extra/extra.md",
      text: "Extra content.",
    });

    const linkPath = path.join(extraDir, "linked.md");
    let symlinkOk = true;
    try {
      await fs.symlink(path.join(extraDir, "extra.md"), linkPath, "file");
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "EPERM" || code === "EACCES") {
        symlinkOk = false;
      } else {
        throw err;
      }
    }
    if (symlinkOk) {
      await expect(mgr.readFile({ relPath: "extra/linked.md" })).rejects.toThrow("path required");
    }
  });
});
