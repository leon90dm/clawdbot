import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { MsgContext } from "./auto-reply/templating.js";
import type { OpenClawConfig } from "./config/config.js";
import { initSessionState } from "./auto-reply/reply/session.js";
import { saveSessionStore, type SessionEntry } from "./config/sessions.js";

describe("initSessionState archiving", () => {
  let tmpDir: string;
  let storePath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "session-test-"));
    storePath = path.join(tmpDir, "sessions.json");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should archive previous session when /new is used", async () => {
    // 1. Setup initial session
    const sessionKey = "agent:main:main";
    const initialStore: Record<string, SessionEntry> = {
      [sessionKey]: {
        sessionId: "old-session-id",
        updatedAt: Date.now(),
        totalTokens: 100,
      },
    };
    await saveSessionStore(storePath, initialStore);

    // 2. Call initSessionState with /new
    const ctx: MsgContext = {
      Body: "/new",
      SessionKey: sessionKey,
      From: "user",
      ChatType: "direct",
    };

    const cfg = {
      session: {
        store: storePath,
      },
      agents: {
        defaults: {},
        list: [{ id: "main", default: true }],
      },
    } satisfies OpenClawConfig;

    const result = await initSessionState({
      ctx,
      cfg,
      commandAuthorized: true,
    });

    // 3. Verify result
    expect(result.isNewSession).toBe(true);
    expect(result.sessionId).not.toBe("old-session-id");
    expect(result.previousSessionEntry).toBeDefined();
    expect(result.previousSessionEntry?.sessionId).toBe("old-session-id");

    // 4. Verify store persistence
    const savedStore = JSON.parse(fs.readFileSync(storePath, "utf-8"));

    // Check new session
    expect(savedStore[sessionKey].sessionId).toBe(result.sessionId);

    // Check archive
    const archiveKey = "archive:old-session-id";
    expect(savedStore[archiveKey]).toBeDefined();
    expect(savedStore[archiveKey].sessionId).toBe("old-session-id");
  });
});
