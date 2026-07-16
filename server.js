import express from "express";
import dotenv from "dotenv";
import { DefaultAzureCredential } from "@azure/identity";

const cliPort = process.env.PORT;
dotenv.config({ quiet: true, override: true });
if (cliPort) {
  process.env.PORT = cliPort;
}

const app = express();
const port = Number(process.env.PORT || 3000);

app.use(express.json({ limit: "4mb" }));
app.use(express.static("public"));

const azureEndpoint = resolveAzureEndpoint();
const translateAzureEndpoint =
  resolveAzureEndpoint("AZURE_OPENAI_TRANSLATE_ENDPOINT", "AZURE_OPENAI_TRANSLATE_RESOURCE") || azureEndpoint;
const forceEntraId = optionalEnv("AZURE_OPENAI_AUTH_MODE").toLowerCase() === "entra";
const azureApiKey = forceEntraId ? "" : optionalEnv("AZURE_OPENAI_API_KEY");
const translateAzureApiKey = forceEntraId ? "" : optionalEnv("AZURE_OPENAI_TRANSLATE_API_KEY") || azureApiKey;
const safetyIdentifier = optionalEnv("OPENAI_SAFETY_IDENTIFIER");

const deployments = {
  agent: optionalEnv("AZURE_OPENAI_REALTIME2_DEPLOYMENT") || "gpt-realtime-2.1",
  translate: optionalEnv("AZURE_OPENAI_TRANSLATE_DEPLOYMENT") || "gpt-realtime-translate",
  transcribe: optionalEnv("AZURE_OPENAI_WHISPER_DEPLOYMENT") || "gpt-realtime-whisper",
};

const translateEngine = "gpt-realtime-translate";

const defaultVoice = optionalEnv("AZURE_OPENAI_DEFAULT_VOICE") || "alloy";
const defaultReasoningEffort = optionalEnv("AZURE_OPENAI_REASONING_EFFORT") || "minimal";
const defaultInputTranscriptionModel =
  optionalEnv("AZURE_OPENAI_INPUT_TRANSCRIPTION_MODEL") || deployments.transcribe || "gpt-4o-transcribe";

let credential;
let cachedBearerToken;
let cachedBearerTokenExpiresAt = 0;

class HttpError extends Error {
  constructor(message, status = 500, details = undefined) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.details = details;
  }
}

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    endpointConfigured: Boolean(azureEndpoint),
    translateEndpointConfigured: Boolean(translateAzureEndpoint),
  });
});

app.get("/api/runtime", (_req, res) => {
  res.json({
    deployments,
    defaults: {
      voice: defaultVoice,
      reasoningEffort: defaultReasoningEffort,
      inputTranscriptionModel: defaultInputTranscriptionModel,
    },
    capabilities: {
      agentReasoning: deployments.agent.includes("realtime-2"),
      translateUsesDedicatedEndpoint: translateAzureEndpoint !== azureEndpoint,
    },
    translateEngine,
    authMode: azureApiKey ? "api-key" : "microsoft-entra-id",
    authModes: {
      agent: azureApiKey ? "api-key" : "microsoft-entra-id",
      translate: translateAzureApiKey ? "api-key" : "microsoft-entra-id",
      transcribe: azureApiKey ? "api-key" : "microsoft-entra-id",
    },
    endpointHost: azureEndpoint ? new URL(azureEndpoint).host : "",
    endpointHosts: {
      agent: endpointHostForMode("agent"),
      translate: endpointHostForMode("translate"),
      transcribe: endpointHostForMode("transcribe"),
    },
    endpoints: {
      realtimeClientSecrets: "/openai/v1/realtime/client_secrets",
      realtimeCalls: "/openai/v1/realtime/calls",
      translationClientSecrets: "/openai/v1/realtime/client_secrets",
      translationCalls: "/openai/v1/realtime/calls",
    },
  });
});

app.post("/api/webrtc/connect", async (req, res) => {
  try {
    const mode = parseMode(req.body?.mode);
    assertAzureConfigured(mode);
    const sdp = parseSdp(req.body?.sdp);
    const options = sanitizeOptions(req.body?.options || {});

    const tStart = performance.now();
    const clientSecret = await createClientSecret(mode, options);
    const tSecret = performance.now();
    const answerSdp = await exchangeSdp(mode, clientSecret, sdp, options);
    const tSdp = performance.now();

    const secretMs = (tSecret - tStart).toFixed(1);
    const sdpMs = (tSdp - tSecret).toFixed(1);
    const totalMs = (tSdp - tStart).toFixed(1);
    res.set(
      "Server-Timing",
      `secret;desc="client_secrets";dur=${secretMs}, sdp;desc="sdp_exchange";dur=${sdpMs}, total;dur=${totalMs}`
    );
    res.type("application/sdp").send(answerSdp);
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    const details = error instanceof HttpError ? error.details : undefined;
    console.error("WebRTC connection failed:", error);
    res.status(status).json({
      error: {
        message: error.message || "Failed to connect to Azure Realtime API",
        details,
      },
    });
  }
});

app.post("/api/events/echo", (req, res) => {
  res.json({ received: req.body, at: new Date().toISOString() });
});

app.listen(port, () => {
  console.log(`Azure GPT Realtime WebRTC demo listening on http://localhost:${port}`);
  console.log(`Auth mode: ${azureApiKey ? "api-key" : "Microsoft Entra ID via DefaultAzureCredential"}`);
  if (translateAzureEndpoint !== azureEndpoint) {
    console.log(`Translate endpoint: ${new URL(translateAzureEndpoint).host}`);
  }
  if (!azureEndpoint) {
    console.warn("Azure endpoint is not configured yet. Fill AZURE_OPENAI_ENDPOINT or AZURE_OPENAI_RESOURCE in .env.");
  }
});

async function createClientSecret(mode, options) {
  const endpoint = endpointForMode(mode);
  const url = `${endpoint}${clientSecretPath()}`;
  const sessionPayload = buildSessionPayload(mode, options);
  const response = await fetch(url, {
    method: "POST",
    headers: await azureAuthHeaders(mode, { json: true }),
    body: JSON.stringify(sessionPayload),
  });

  const responseText = await response.text();
  if (!response.ok) {
    throw new HttpError("Azure failed to create a Realtime client secret", response.status, safeJson(responseText));
  }

  const data = safeJson(responseText);
  const value = data?.value || data?.client_secret?.value;
  if (!value) {
    throw new HttpError("Azure client secret response did not include a token value", 502, data);
  }

  return value;
}

async function exchangeSdp(mode, clientSecret, sdp, options = {}) {
  const endpoint = endpointForMode(mode);
  const url = new URL(`${endpoint}${callsPath()}`);
  if (shouldUseWebrtcFilter(mode, options)) {
    url.searchParams.set("webrtcfilter", "on");
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${clientSecret}`,
      "Content-Type": "application/sdp",
    },
    body: sdp,
  });

  const answerSdp = await response.text();
  if (!response.ok) {
    throw new HttpError("Azure failed the WebRTC SDP exchange", response.status, safeJson(answerSdp));
  }

  return answerSdp;
}

function shouldUseWebrtcFilter(mode, options) {
  if (mode !== "agent") {
    return false;
  }

  if (options.enableInputTranscription) {
    return false;
  }

  return process.env.AZURE_OPENAI_WEBRTC_FILTER === "on";
}

function buildSessionPayload(mode, options) {
  if (mode === "translate") {
    return buildTranslationSessionPayload(options);
  }

  if (mode === "transcribe") {
    return buildTranscriptionSessionPayload(options);
  }

  return buildRealtime2SessionPayload(options);
}

function buildTranscriptionTurnDetection(options) {
  const td = buildTurnDetection({ ...options, interruptResponse: false });
  if (td && typeof td === "object") {
    // Transcription sessions don't accept create_response / interrupt_response.
    delete td.create_response;
    delete td.interrupt_response;
  }
  return td;
}

function buildRealtime2SessionPayload(options) {
  const voice = options.voice || defaultVoice;
  const reasoningEffort = options.reasoningEffort || defaultReasoningEffort;
  const instructions = realtime2Instructions(options.instructions);
  const supportsReasoning = deployments.agent.includes("realtime-2");

  const inputAudio = {
    noise_reduction: { type: options.noiseReduction || "near_field" },
    turn_detection: buildTurnDetection(options),
  };

  if (options.enableInputTranscription) {
    inputAudio.transcription = compactObject({
      model: options.inputTranscriptionModel || defaultInputTranscriptionModel,
      language: options.sourceLanguage,
      prompt: options.transcriptionPrompt,
    });
  }

  return {
    session: compactObject({
      type: "realtime",
      model: deployments.agent,
      output_modalities: ["audio"],
      instructions,
      reasoning: supportsReasoning ? { effort: reasoningEffort } : undefined,
      audio: {
        input: inputAudio,
        output: {
          voice,
        },
      },
    }),
  };
}

function buildTranslationSessionPayload(options = {}) {
  // Per useful.md, gpt-realtime-translate uses the same minimal transcription
  // session shape as gpt-realtime-whisper (model must live at
  // session.audio.input.transcription.model). We *additionally* honor the
  // user's VAD / noise-reduction / source-language picks if they were sent,
  // since the underlying transcription pipeline accepts them and an empty
  // turn_detection disables segmentation entirely.
  return {
    session: {
      type: "transcription",
      audio: {
        input: compactObject({
          transcription: compactObject({
            model: deployments.translate,
            language: options.sourceLanguage,
            prompt: options.transcriptionPrompt,
          }),
          turn_detection: buildTranscriptionTurnDetection(options),
          noise_reduction: { type: options.noiseReduction || "near_field" },
        }),
      },
    },
  };
}

function buildTranscriptionSessionPayload(options) {
  // sourceLanguage left undefined => Whisper auto-detects. Don't force "en"
  // or non-English speech gets mistranscribed / returned as U+FFFD noise.
  return {
    session: {
      type: "transcription",
      audio: {
        input: {
          transcription: compactObject({
            model: deployments.transcribe,
            language: options.sourceLanguage,
            prompt: options.transcriptionPrompt,
          }),
          turn_detection: buildTranscriptionTurnDetection(options),
          noise_reduction: { type: options.noiseReduction || "near_field" },
        },
      },
      include: options.includeLogprobs ? ["item.input_audio_transcription.logprobs"] : undefined,
    },
  };
}

function buildTurnDetection(options) {
  const interruptResponse = options.interruptResponse === true;

  if (options.turnDetection === "semantic_vad") {
    return compactObject({
      type: "semantic_vad",
      eagerness: options.semanticEagerness || "auto",
      create_response: true,
      interrupt_response: interruptResponse,
    });
  }

  if (options.turnDetection === "none") {
    return null;
  }

  return {
    type: "server_vad",
    threshold: clampNumber(options.vadThreshold, 0, 1, 0.5),
    prefix_padding_ms: clampInteger(options.prefixPaddingMs, 0, 1000, 300),
    silence_duration_ms: clampInteger(options.silenceDurationMs, 100, 2000, 450),
    create_response: true,
    interrupt_response: interruptResponse,
  };
}

function realtime2Instructions(customInstructions) {
  const baseInstructions = customInstructions || defaultRealtime2Instructions();
  return `${baseInstructions.trim()}

${singleSpokenItemContract()}`;
}

function singleSpokenItemContract() {
  return `# Mandatory Realtime Audio Contract
Speak exactly one assistant audio item per response.
Never create a separate commentary, preamble, or setup audio item before the answer.
Never split a response into commentary and final_answer phases.
Start directly with the useful answer content; do not begin with filler such as "好的", "当然", "可以", "我来", "下面", or "接下来".
Keep the spoken answer short enough to fit in one continuous audio item. If more detail is needed, ask whether to continue.`;
}

function defaultRealtime2Instructions() {
  return `# Role and Objective
You are a concise multilingual realtime voice assistant running on Azure GPT-realtime-2.1.

# Language
Reply in the user's language by default. If language confidence is low, ask whether to continue in English or Chinese.

# Reasoning
For direct questions, answer quickly. For multi-step troubleshooting, planning, or comparisons, reason internally before responding.

# Spoken response shape
Answer directly in one assistant audio item.
Do not create a separate preamble/commentary item, and do not split output into commentary and final_answer phases.
Avoid opening-only phrases such as "I'll explain that first" unless the explanation immediately continues in the same spoken item.
Do not reveal private chain-of-thought.

# Voice UX
Keep responses natural, brief, and paced for spoken playback.
For spoken answers, prefer 2-4 short sentences or at most 3 concise bullets.
Avoid long monologues. If the user asks for a detailed explanation, give a short first part and ask whether to continue.
Ask one clarification question at a time when audio is unclear.`;
}

async function azureAuthHeaders(mode, { json = false } = {}) {
  const headers = {};

  if (json) {
    headers["Content-Type"] = "application/json";
  }

  if (safetyIdentifier) {
    headers["OpenAI-Safety-Identifier"] = safetyIdentifier;
  }

  const apiKey = apiKeyForMode(mode);
  if (apiKey) {
    headers["api-key"] = apiKey;
    return headers;
  }

  headers.Authorization = `Bearer ${await getBearerToken()}`;
  return headers;
}

async function getBearerToken() {
  const now = Date.now();
  if (cachedBearerToken && now < cachedBearerTokenExpiresAt - 5 * 60 * 1000) {
    return cachedBearerToken;
  }

  credential ||= new DefaultAzureCredential();
  const token = await credential.getToken("https://cognitiveservices.azure.com/.default");
  cachedBearerToken = token.token;
  cachedBearerTokenExpiresAt = token.expiresOnTimestamp;
  return cachedBearerToken;
}

function clientSecretPath() {
  return "/openai/v1/realtime/client_secrets";
}

function callsPath() {
  return "/openai/v1/realtime/calls";
}

function endpointForMode(mode) {
  return mode === "translate" ? translateAzureEndpoint : azureEndpoint;
}

function apiKeyForMode(mode) {
  return mode === "translate" ? translateAzureApiKey : azureApiKey;
}

function endpointHostForMode(mode) {
  const endpoint = endpointForMode(mode);
  return endpoint ? new URL(endpoint).host : "";
}

function assertAzureConfigured(mode) {
  if (!endpointForMode(mode)) {
    throw new HttpError(
      mode === "translate"
        ? "Missing AZURE_OPENAI_TRANSLATE_ENDPOINT/AZURE_OPENAI_TRANSLATE_RESOURCE or default AZURE_OPENAI_ENDPOINT/AZURE_OPENAI_RESOURCE in .env"
        : "Missing AZURE_OPENAI_ENDPOINT or AZURE_OPENAI_RESOURCE in .env",
      500
    );
  }
}

function resolveAzureEndpoint(endpointName = "AZURE_OPENAI_ENDPOINT", resourceName = "AZURE_OPENAI_RESOURCE") {
  const endpoint = optionalEnv(endpointName);
  if (endpoint) {
    return normalizeAzureEndpoint(endpoint);
  }

  const resource = optionalEnv(resourceName);
  if (!resource) {
    return "";
  }

  if (resource.startsWith("https://")) {
    return normalizeAzureEndpoint(resource);
  }

  return `https://${resource}.openai.azure.com`;
}

function normalizeAzureEndpoint(value) {
  const trimmed = value.trim().replace(/\/+$/, "");
  try {
    const url = new URL(trimmed);
    if (url.pathname && url.pathname !== "/") {
      console.warn(
        `AZURE_OPENAI_ENDPOINT should be the resource root; ignoring path '${url.pathname}'. ` +
          `Using '${url.origin}'.`
      );
    }
    return url.origin;
  } catch {
    return trimmed;
  }
}

function parseMode(value) {
  if (["agent", "translate", "transcribe"].includes(value)) {
    return value;
  }

  throw new HttpError("Invalid mode. Expected agent, translate, or transcribe.", 400);
}

function parseSdp(value) {
  if (typeof value !== "string" || !value.includes("v=0")) {
    throw new HttpError("Invalid SDP offer", 400);
  }

  return value;
}

function sanitizeOptions(rawOptions) {
  const options = { ...rawOptions };

  return {
    voice: enumValue(options.voice, ["alloy", "ash", "ballad", "coral", "echo", "sage", "shimmer", "verse"], undefined),
    reasoningEffort: enumValue(options.reasoningEffort, ["minimal", "low", "medium", "high", "xhigh"], undefined),
    sourceLanguage: languageValue(options.sourceLanguage),
    instructions: boundedString(options.instructions, 8000),
    transcriptionPrompt: boundedString(options.transcriptionPrompt, 1000),
    turnDetection: enumValue(options.turnDetection, ["server_vad", "semantic_vad", "none"], undefined),
    semanticEagerness: enumValue(options.semanticEagerness, ["low", "medium", "high", "auto"], undefined),
    vadThreshold: Number(options.vadThreshold),
    prefixPaddingMs: Number(options.prefixPaddingMs),
    silenceDurationMs: Number(options.silenceDurationMs),
    enableInputTranscription: Boolean(options.enableInputTranscription),
    interruptResponse: options.interruptResponse === true,
    includeLogprobs: Boolean(options.includeLogprobs),
    inputTranscriptionModel: boundedString(options.inputTranscriptionModel, 80),
    noiseReduction: enumValue(options.noiseReduction, ["near_field", "far_field"], undefined),
  };
}

function optionalEnv(name) {
  const value = process.env[name]?.trim();
  if (!value || value.startsWith("<") || value.toLowerCase() === "changeme") {
    return "";
  }

  return value;
}

function enumValue(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function languageValue(value) {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  if (!/^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})?$/.test(trimmed)) {
    throw new HttpError(`Invalid language code: ${trimmed}`, 400);
  }

  return trimmed;
}

function boundedString(value, maxLength) {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  return trimmed.slice(0, maxLength);
}

function clampNumber(value, min, max, fallback) {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

function clampInteger(value, min, max, fallback) {
  return Math.round(clampNumber(value, min, max, fallback));
}

function compactObject(object) {
  return Object.fromEntries(
    Object.entries(object).filter(([, value]) => value !== undefined && value !== "")
  );
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
