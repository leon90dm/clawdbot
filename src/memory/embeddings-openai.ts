import type { EmbeddingProvider, EmbeddingProviderOptions } from "./embeddings.js";
import { requireApiKey, resolveApiKeyForProvider } from "../agents/model-auth.js";
import { extractErrorCode, formatErrorMessage } from "../infra/errors.js";

export type OpenAiEmbeddingClient = {
  baseUrl: string;
  headers: Record<string, string>;
  model: string;
};

export const DEFAULT_OPENAI_EMBEDDING_MODEL = "text-embedding-3-small";
const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_OLLAMA_BASE_URL = "http://127.0.0.1:11434/v1";

export function normalizeOpenAiModel(model: string): string {
  const trimmed = model.trim();
  if (!trimmed) {
    return DEFAULT_OPENAI_EMBEDDING_MODEL;
  }
  if (trimmed.startsWith("openai/")) {
    return trimmed.slice("openai/".length);
  }
  return trimmed;
}

export function normalizeOllamaEmbeddingModel(model: string): string {
  const trimmed = model.trim();
  if (!trimmed) {
    return "nomic-embed-text";
  }
  if (trimmed.startsWith("ollama/")) {
    return trimmed.slice("ollama/".length);
  }
  if (trimmed.startsWith("openai/")) {
    return trimmed.slice("openai/".length);
  }
  return trimmed;
}

function normalizeOpenAiCompatibleBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim();
  if (!trimmed) {
    return DEFAULT_OPENAI_BASE_URL;
  }
  try {
    const parsed = new URL(trimmed);
    const pathname = parsed.pathname.replace(/\/+$/, "");
    if (!pathname || pathname === "/") {
      parsed.pathname = "/v1";
      parsed.search = "";
      parsed.hash = "";
      return parsed.toString().replace(/\/$/, "");
    }
  } catch {}
  return trimmed;
}

export async function createOpenAiEmbeddingProvider(
  options: EmbeddingProviderOptions,
): Promise<{ provider: EmbeddingProvider; client: OpenAiEmbeddingClient }> {
  const client = await resolveOpenAiEmbeddingClient(options);
  const url = `${client.baseUrl.replace(/\/$/, "")}/embeddings`;

  const embed = async (input: string[]): Promise<number[][]> => {
    if (input.length === 0) {
      return [];
    }
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: client.headers,
        body: JSON.stringify({ model: client.model, input }),
      });
    } catch (err) {
      const code =
        extractErrorCode(err) ?? extractErrorCode((err as { cause?: unknown } | null)?.cause);
      const prefix = code ? `${code}: ` : "";
      const message = formatErrorMessage(err);
      throw Object.assign(
        new Error(`openai embeddings request failed: ${url}: ${prefix}${message}`),
        {
          cause: err,
        },
      );
    }
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`openai embeddings failed: ${url}: ${res.status} ${text}`);
    }
    const payload = (await res.json()) as {
      data?: Array<{ embedding?: number[] }>;
    };
    const data = payload.data ?? [];
    return data.map((entry) => entry.embedding ?? []);
  };

  return {
    provider: {
      id: "openai",
      model: client.model,
      embedQuery: async (text) => {
        const [vec] = await embed([text]);
        return vec ?? [];
      },
      embedBatch: embed,
    },
    client,
  };
}

export async function createOllamaEmbeddingProvider(
  options: EmbeddingProviderOptions,
): Promise<{ provider: EmbeddingProvider; client: OpenAiEmbeddingClient }> {
  const client = await resolveOllamaEmbeddingClient(options);
  const normalizedBaseUrl = client.baseUrl.replace(/\/$/, "");
  const openAiCompatibleUrl = `${normalizedBaseUrl}/embeddings`;
  const nativeBaseUrl = normalizedBaseUrl.replace(/\/v1$/i, "");
  const nativeEmbedUrl = `${nativeBaseUrl}/api/embed`;
  const nativeEmbeddingsUrl = `${nativeBaseUrl}/api/embeddings`;

  let preferredApi: "openai" | "openai-single" | "ollama-embed" | "ollama-embeddings" = "openai";

  const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

  const shouldRetryBody = (text: string): boolean => {
    if (!text) {
      return true;
    }
    return /EOF|EPIPE|ECONNRESET|ECONNREFUSED|connection refused|connection reset|broken pipe|dial tcp|timeout|timed out|socket hang up/i.test(
      text,
    );
  };

  const request = async (url: string, body: unknown): Promise<Response> => {
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const res = (await fetch(url, {
          method: "POST",
          headers: client.headers,
          body: JSON.stringify(body),
        })) as Response;

        if (res.ok) {
          return res;
        }

        const cloneFn = (res as unknown as { clone?: () => Response }).clone;
        const text = cloneFn
          ? await cloneFn.call(res).text()
          : typeof (res as unknown as { text?: () => Promise<string> }).text === "function"
            ? await (res as unknown as { text: () => Promise<string> }).text()
            : "";
        const retryable = res.status >= 500 && shouldRetryBody(text);
        if (!retryable || attempt === maxAttempts) {
          if (cloneFn) {
            return res;
          }
          return new Response(text, { status: res.status });
        }
        await sleep(150 * 2 ** (attempt - 1));
      } catch (err) {
        const message = formatErrorMessage(err);
        const retryable = shouldRetryBody(message);
        if (!retryable || attempt === maxAttempts) {
          const code =
            extractErrorCode(err) ?? extractErrorCode((err as { cause?: unknown } | null)?.cause);
          const prefix = code ? `${code}: ` : "";
          throw Object.assign(
            new Error(`ollama embeddings request failed: ${url}: ${prefix}${message}`),
            {
              cause: err,
            },
          );
        }
        await sleep(150 * 2 ** (attempt - 1));
      }
    }
    throw new Error(`ollama embeddings request failed: ${url}: retry exhausted`);
  };

  const parseEmbeddingResponse = async (res: Response, url: string): Promise<number[][]> => {
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`ollama embeddings failed: ${url}: ${res.status} ${text}`);
    }

    const payload = (await res.json()) as {
      data?: Array<{ embedding?: number[] }>;
      embedding?: number[];
      embeddings?: number[][];
    };

    if (Array.isArray(payload.embeddings)) {
      return payload.embeddings;
    }
    if (Array.isArray(payload.data)) {
      return payload.data.map((entry) => entry.embedding ?? []);
    }
    if (Array.isArray(payload.embedding)) {
      return [payload.embedding];
    }
    return [];
  };

  const shouldTryFallbackEndpoint = (res: Response, text: string): boolean => {
    if (res.status === 404 || res.status === 405 || res.status === 501) {
      return true;
    }
    if (res.status >= 500) {
      return true;
    }
    if (res.status === 400 || res.status === 422) {
      return /not found|unknown|unsupported|unrecognized|invalid/i.test(text);
    }
    return false;
  };

  const embed = async (input: string[]): Promise<number[][]> => {
    if (input.length === 0) {
      return [];
    }

    if (preferredApi === "ollama-embed") {
      const res = await request(nativeEmbedUrl, { model: client.model, input });
      return await parseEmbeddingResponse(res, nativeEmbedUrl);
    }

    if (preferredApi === "ollama-embeddings") {
      const results = await Promise.all(
        input.map(async (text) => {
          const res = await request(nativeEmbeddingsUrl, { model: client.model, prompt: text });
          const [vec] = await parseEmbeddingResponse(res, nativeEmbeddingsUrl);
          return vec ?? [];
        }),
      );
      return results;
    }

    if (preferredApi === "openai-single") {
      const results = await Promise.all(
        input.map(async (text) => {
          const res = await request(openAiCompatibleUrl, { model: client.model, input: text });
          const [vec] = await parseEmbeddingResponse(res, openAiCompatibleUrl);
          return vec ?? [];
        }),
      );
      return results;
    }

    let openAiResponse: Response;
    openAiResponse = await request(openAiCompatibleUrl, { model: client.model, input });

    if (openAiResponse.ok) {
      return await parseEmbeddingResponse(openAiResponse, openAiCompatibleUrl);
    }

    const openAiText = await openAiResponse.text();
    if (!shouldTryFallbackEndpoint(openAiResponse, openAiText)) {
      throw new Error(
        `ollama embeddings failed: ${openAiCompatibleUrl}: ${openAiResponse.status} ${openAiText}`,
      );
    }

    try {
      const results = await Promise.all(
        input.map(async (text) => {
          const res = await request(openAiCompatibleUrl, { model: client.model, input: text });
          const [vec] = await parseEmbeddingResponse(res, openAiCompatibleUrl);
          return vec ?? [];
        }),
      );
      preferredApi = "openai-single";
      return results;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      try {
        const res = await request(nativeEmbedUrl, { model: client.model, input });
        const vectors = await parseEmbeddingResponse(res, nativeEmbedUrl);
        preferredApi = "ollama-embed";
        return vectors;
      } catch (nativeErr) {
        const nativeMessage = nativeErr instanceof Error ? nativeErr.message : String(nativeErr);
        const res = await request(nativeEmbeddingsUrl, { model: client.model, prompt: input[0] });
        if (!res.ok) {
          const text = await res.text();
          throw Object.assign(
            new Error(
              `${message}\n\n${nativeMessage}\n\nollama embeddings failed: ${nativeEmbeddingsUrl}: ${res.status} ${text}`,
            ),
            { cause: err },
          );
        }
        preferredApi = "ollama-embeddings";
        const results = await Promise.all(
          input.map(async (text) => {
            const perItem = await request(nativeEmbeddingsUrl, {
              model: client.model,
              prompt: text,
            });
            const [vec] = await parseEmbeddingResponse(perItem, nativeEmbeddingsUrl);
            return vec ?? [];
          }),
        );
        return results;
      }
    }
  };

  return {
    provider: {
      id: "ollama",
      model: client.model,
      embedQuery: async (text) => {
        const [vec] = await embed([text]);
        return vec ?? [];
      },
      embedBatch: embed,
    },
    client,
  };
}

export async function resolveOpenAiEmbeddingClient(
  options: EmbeddingProviderOptions,
): Promise<OpenAiEmbeddingClient> {
  const remote = options.remote;
  const remoteApiKey = remote?.apiKey?.trim();
  const remoteBaseUrl = remote?.baseUrl?.trim();
  const providerConfig = options.config.models?.providers?.openai;
  const baseUrl = normalizeOpenAiCompatibleBaseUrl(
    remoteBaseUrl || providerConfig?.baseUrl?.trim() || DEFAULT_OPENAI_BASE_URL,
  );
  const normalizedBaseUrl = baseUrl.replace(/\/$/, "");

  let apiKey: string | undefined = remoteApiKey || undefined;
  if (!apiKey) {
    try {
      apiKey = requireApiKey(
        await resolveApiKeyForProvider({
          provider: "openai",
          cfg: options.config,
          agentDir: options.agentDir,
        }),
        "openai",
      );
    } catch (err) {
      if (normalizedBaseUrl !== DEFAULT_OPENAI_BASE_URL) {
        apiKey = undefined;
      } else {
        throw err;
      }
    }
  }

  const headerOverrides = Object.assign({}, providerConfig?.headers, remote?.headers);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    ...headerOverrides,
  };
  const model = normalizeOpenAiModel(options.model);
  return { baseUrl, headers, model };
}

export async function resolveOllamaEmbeddingClient(
  options: EmbeddingProviderOptions,
): Promise<OpenAiEmbeddingClient> {
  const remote = options.remote;
  const remoteApiKey = remote?.apiKey?.trim();
  const remoteBaseUrl = remote?.baseUrl?.trim();

  const providerConfig = options.config.models?.providers?.ollama;
  const baseUrl = normalizeOpenAiCompatibleBaseUrl(
    remoteBaseUrl || providerConfig?.baseUrl?.trim() || DEFAULT_OLLAMA_BASE_URL,
  );

  const headerOverrides = Object.assign({}, providerConfig?.headers, remote?.headers);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(remoteApiKey ? { Authorization: `Bearer ${remoteApiKey}` } : {}),
    ...headerOverrides,
  };
  const model = normalizeOllamaEmbeddingModel(options.model);
  return { baseUrl, headers, model };
}
