import { hosted, verifyInstallation } from "@/auth/publik";
import { ApiError } from "@/api/errors";
import { getActiveProvider, getBaseUrl, getKey, getModel } from "@/ai/keys";
import { makeChatCompletions, makeOpenAI } from "./openai";
import { makeAnthropic } from "./anthropic";
import type { LlmProvider, ProviderId } from "./types";

// Fixed endpoints for the OpenAI-compatible providers that have one.
const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";
const GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
const OLLAMA_DEFAULT_BASE = "http://localhost:11434/v1";

/**
 * Normalize a user-entered base URL into a chat/completions endpoint. Accepts
 * either an OpenAI-style base (".../v1" -> we append "/chat/completions") or a
 * full endpoint (already ending in "/chat/completions" or carrying a query
 * string, e.g. an Azure deployment URL with ?api-version=) which is used as-is.
 */
function chatEndpoint(base: string): string {
  const b = base.trim().replace(/\/+$/, "");
  if (!b) return b;
  if (/\/chat\/completions/i.test(b) || b.includes("?")) return base.trim();
  return `${b}/chat/completions`;
}

/** Construct a provider bound to a specific key + model (used by the key tester
 *  and getProvider). `baseUrl` is required for Ollama (defaults to localhost)
 *  and Azure (the deployment endpoint); ignored by the others. */
function buildProvider(
  p: ProviderId,
  apiKey: string,
  model: string,
  baseUrl?: string,
): LlmProvider {
  switch (p) {
    case "publik":
      return makeChatCompletions({ id: p, brand: "Publik", endpoint: "/local/chat/completions", apiKey: "", model });
    case "anthropic":
      return makeAnthropic(apiKey, model);
    case "openai":
      return makeOpenAI(apiKey, model);
    case "groq":
      return makeChatCompletions({ id: "groq", brand: "Groq", endpoint: GROQ_ENDPOINT, apiKey, model });
    case "gemini":
      return makeChatCompletions({ id: "gemini", brand: "Google Gemini", endpoint: GEMINI_ENDPOINT, apiKey, model });
    case "ollama":
      return makeChatCompletions({
        id: "ollama",
        brand: "Ollama",
        endpoint: chatEndpoint(baseUrl || OLLAMA_DEFAULT_BASE),
        apiKey: apiKey || "",
        model,
      });
    case "azure":
      return makeChatCompletions({
        id: "azure",
        brand: "Azure OpenAI",
        endpoint: chatEndpoint(baseUrl || ""),
        apiKey,
        model,
        auth: "api-key",
      });
    default:
      return makeOpenAI(apiKey, model);
  }
}

export function makeProvider(...args: Parameters<typeof buildProvider>): LlmProvider {
  const provider = buildProvider(...args);
  if (!hosted || provider.id === "publik") return provider;
  // BYOK calls go directly to the selected provider; recheck the Word session first.
  return { id:provider.id,
    async chat(req) { await verifyInstallation(req.signal); return provider.chat(req); },
    async stream(req, delta) { await verifyInstallation(req.signal); return provider.stream(req, delta); },
  };
}

/** The provider bound to the user's saved key + model, or a NO_KEY error. */
export function getProvider(): LlmProvider {
  const p = getActiveProvider();
  const key = getKey(p);
  // Ollama runs locally with no key; every other provider needs one.
  if (!key && p !== "ollama" && p !== "publik") {
    throw new ApiError("unauthorized", 401, "Add your API key in Settings to use AI features.", "NO_KEY");
  }
  return makeProvider(p, key ?? "", getModel(p), getBaseUrl(p));
}
