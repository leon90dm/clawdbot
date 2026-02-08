import { describe, it, expect } from "bun:test";
import { loadConfig } from "./config/config.js";
import { listSessionsFromStore } from "./gateway/session-utils.js";

describe("listSessionsFromStore", () => {
  it("should include archived sessions when listing for an agent", () => {
    const cfg = loadConfig();
    const agentId = "main";
    const store = {
      "agent:main:main": {
        sessionId: "current-id",
        updatedAt: Date.now(),
        totalTokens: 100,
      },
      "agent:main:archive:old-id": {
        sessionId: "old-id",
        updatedAt: Date.now() - 10000,
        totalTokens: 50,
      },
      // Unprefixed archive key (should be canonicalized before passing to listSessionsFromStore usually,
      // but let's see if it handles it if it's passed directly)
      "archive:very-old-id": {
        sessionId: "very-old-id",
        updatedAt: Date.now() - 20000,
        totalTokens: 20,
      },
    };

    const result = listSessionsFromStore({
      cfg,
      storePath: "dummy.json",
      store: store as any,
      opts: {
        agentId: "main",
      },
    });

    const keys = result.sessions.map((s) => s.key);
    expect(keys).toContain("agent:main:main");
    expect(keys).toContain("agent:main:archive:old-id");

    // Unprefixed keys are filtered out if agentId is specified
    expect(keys).not.toContain("archive:very-old-id");

    // Check kinds
    const archiveSession = result.sessions.find((s) => s.key === "agent:main:archive:old-id");
    expect(archiveSession).toBeDefined();
    expect(archiveSession?.kind).toBe("archive");
  });
});
