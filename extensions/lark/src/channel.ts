import {
  buildChannelConfigSchema,
  DEFAULT_ACCOUNT_ID,
  missingTargetError,
  normalizeAccountId,
  type ChannelPlugin,
  type OpenClawConfig,
} from "openclaw/plugin-sdk";

import { LarkConfigSchema } from "./config-schema.js";
import { sendLarkWebhookMessage } from "./send.js";

type LarkAccountConfig = {
  name?: string;
  enabled?: boolean;
  webhookUrl?: string;
  secret?: string;
  timeoutSeconds?: number;
  textChunkLimit?: number;
};

type LarkConfigSection = LarkAccountConfig & {
  defaultAccountId?: string;
  accounts?: Record<string, LarkAccountConfig | undefined>;
};

type ResolvedLarkAccount = {
  accountId: string;
  name?: string;
  enabled: boolean;
  webhookUrl?: string;
  secret?: string;
  timeoutMs: number;
  textChunkLimit?: number;
};

function getLarkSection(cfg: OpenClawConfig): LarkConfigSection | undefined {
  return cfg.channels?.["lark"] as LarkConfigSection | undefined;
}

function listLarkAccountIds(cfg: OpenClawConfig): string[] {
  const section = getLarkSection(cfg);
  if (!section) {
    return [];
  }
  const ids = new Set<string>();
  const accounts = section.accounts ?? {};
  for (const key of Object.keys(accounts)) {
    const normalized = normalizeAccountId(key);
    if (normalized) {
      ids.add(normalized);
    }
  }
  const hasBaseConfig =
    typeof section.webhookUrl === "string" ||
    typeof section.secret === "string" ||
    typeof section.enabled === "boolean";
  if (hasBaseConfig) {
    ids.add(DEFAULT_ACCOUNT_ID);
  }
  return Array.from(ids);
}

function resolveDefaultLarkAccountId(cfg: OpenClawConfig): string {
  const section = getLarkSection(cfg);
  const normalized = normalizeAccountId(section?.defaultAccountId);
  return normalized ?? DEFAULT_ACCOUNT_ID;
}

function resolveLarkAccount(params: {
  cfg: OpenClawConfig;
  accountId?: string | null;
}): ResolvedLarkAccount {
  const section = getLarkSection(params.cfg) ?? {};
  const accountId = normalizeAccountId(params.accountId) ?? resolveDefaultLarkAccountId(params.cfg);
  const entry = (section.accounts ?? {})[accountId] ?? {};
  const enabled = (entry.enabled ?? section.enabled) !== false;
  const timeoutSeconds = entry.timeoutSeconds ?? section.timeoutSeconds;
  const textChunkLimit = entry.textChunkLimit ?? section.textChunkLimit;
  return {
    accountId,
    name: entry.name ?? section.name,
    enabled,
    webhookUrl: (entry.webhookUrl ?? section.webhookUrl)?.trim() || undefined,
    secret: (entry.secret ?? section.secret)?.trim() || undefined,
    timeoutMs: (timeoutSeconds && timeoutSeconds > 0 ? timeoutSeconds : 15) * 1000,
    textChunkLimit: textChunkLimit && textChunkLimit > 0 ? textChunkLimit : undefined,
  };
}

function normalizeLarkWebhookTarget(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  const withoutPrefix = trimmed.replace(/^lark:|^feishu:|^webhook:/i, "").trim();
  if (!withoutPrefix) {
    return null;
  }
  if (!/^https?:\/\//i.test(withoutPrefix)) {
    return null;
  }
  return withoutPrefix;
}

export const larkPlugin: ChannelPlugin<ResolvedLarkAccount> = {
  id: "lark",
  meta: {
    id: "lark",
    label: "Lark/Feishu",
    selectionLabel: "Lark/Feishu",
    docsPath: "/channels/lark",
    blurb: "Lark/Feishu custom bot webhook channel.",
    aliases: ["feishu"],
  },
  capabilities: {
    chatTypes: ["group"],
    media: true,
  },
  configSchema: buildChannelConfigSchema(LarkConfigSchema),
  config: {
    listAccountIds: (cfg) => listLarkAccountIds(cfg),
    resolveAccount: (cfg, accountId) => resolveLarkAccount({ cfg, accountId }),
    defaultAccountId: (cfg) => resolveDefaultLarkAccountId(cfg),
    resolveAllowFrom: ({ cfg, accountId }) => {
      const account = resolveLarkAccount({ cfg, accountId });
      return account.webhookUrl ? [account.webhookUrl] : [];
    },
    isConfigured: async (account) => Boolean(account.webhookUrl),
    isEnabled: (account) => account.enabled,
  },
  outbound: {
    deliveryMode: "direct",
    resolveTarget: ({ cfg, to, allowFrom, accountId, mode }) => {
      const allowList = (allowFrom ?? [])
        .map((entry) => String(entry).trim())
        .map((entry) => normalizeLarkWebhookTarget(entry))
        .filter((entry): entry is string => Boolean(entry));

      const trimmed = to?.trim() ?? "";
      if (trimmed) {
        const normalized = normalizeLarkWebhookTarget(trimmed);
        if (normalized) {
          return { ok: true, to: normalized };
        }
        if ((mode === "implicit" || mode === "heartbeat") && allowList.length > 0) {
          return { ok: true, to: allowList[0] };
        }
        return {
          ok: false,
          error: missingTargetError("Lark/Feishu", "<webhook_url> or channels.lark.webhookUrl"),
        };
      }

      const account = resolveLarkAccount({ cfg: cfg ?? {}, accountId });
      if (account.webhookUrl) {
        return { ok: true, to: account.webhookUrl };
      }
      if (allowList.length > 0) {
        return { ok: true, to: allowList[0] };
      }

      return {
        ok: false,
        error: missingTargetError("Lark/Feishu", "<webhook_url> or channels.lark.webhookUrl"),
      };
    },
    textChunkLimit: 4000,
    sendText: async ({ cfg, to, text, accountId }) => {
      const account = resolveLarkAccount({ cfg, accountId });
      if (!account.enabled) {
        throw new Error(`Lark account disabled: ${account.accountId}`);
      }
      const res = await sendLarkWebhookMessage({
        webhookUrl: to,
        text,
        secret: account.secret,
        timeoutMs: account.timeoutMs,
      });
      if (!res.ok) {
        throw new Error(res.error);
      }
      return { channel: "lark", messageId: "unknown", chatId: to, meta: { response: res.response } };
    },
    sendMedia: async ({ cfg, to, text, mediaUrl, accountId }) => {
      const account = resolveLarkAccount({ cfg, accountId });
      if (!account.enabled) {
        throw new Error(`Lark account disabled: ${account.accountId}`);
      }
      if (!mediaUrl) {
        throw new Error("Lark mediaUrl is required.");
      }
      const composed = text?.trim() ? `${text.trim()}\n${mediaUrl}` : mediaUrl;
      const res = await sendLarkWebhookMessage({
        webhookUrl: to,
        text: composed,
        secret: account.secret,
        timeoutMs: account.timeoutMs,
      });
      if (!res.ok) {
        throw new Error(res.error);
      }
      return { channel: "lark", messageId: "unknown", chatId: to, meta: { response: res.response } };
    },
  },
  messaging: {
    targetResolver: {
      looksLikeId: (raw) => Boolean(normalizeLarkWebhookTarget(raw)),
      hint: "<webhook_url>",
    },
    normalizeTarget: (raw) => normalizeLarkWebhookTarget(raw) ?? raw.trim(),
  },
};
