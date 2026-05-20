import dotenv from "dotenv";

dotenv.config({ quiet: true, override: true });

const endpoint = resolveTranslateEndpoint();
const apiKey = optionalEnv("AZURE_OPENAI_TRANSLATE_API_KEY") || optionalEnv("AZURE_OPENAI_API_KEY");
const deployment = optionalEnv("AZURE_OPENAI_TRANSLATE_DEPLOYMENT") || "gpt-realtime-translate";

if (!endpoint) {
  fail("Missing AZURE_OPENAI_TRANSLATE_ENDPOINT/AZURE_OPENAI_ENDPOINT or resource name in .env");
}

if (!apiKey) {
  fail("Missing AZURE_OPENAI_TRANSLATE_API_KEY or AZURE_OPENAI_API_KEY in .env");
}

const body = {
  session: {
    type: "transcription",
    audio: {
      input: {
        transcription: {
          model: deployment,
        },
      },
    },
  },
};

const response = await fetch(`${endpoint}/openai/v1/realtime/client_secrets`, {
  method: "POST",
  headers: {
    "api-key": apiKey,
    "Content-Type": "application/json",
  },
  body: JSON.stringify(body),
});

const responseText = await response.text();
const data = safeJson(responseText);
const session = data?.session || {};
const result = {
  endpointHost: new URL(endpoint).host,
  region: response.headers.get("x-ms-region"),
  status: response.status,
  ok: response.ok,
  requestId:
    response.headers.get("apim-request-id") ||
    response.headers.get("x-request-id") ||
    response.headers.get("x-ms-request-id"),
  sessionType: session.type,
  sessionObject: session.object,
  transcriptionModel: session.audio?.input?.transcription?.model,
  turnDetection: session.audio?.input?.turn_detection?.type,
  tokenReturned: Boolean(data?.value || data?.client_secret?.value),
};

console.log(JSON.stringify(result, null, 2));

if (!response.ok) {
  fail(`Translate minimal test failed: ${JSON.stringify(data?.error || data)}`);
}

if (session.type !== "transcription" || session.object !== "realtime.transcription_session") {
  fail("Translate minimal test failed: Azure did not return a realtime.transcription_session");
}

if (session.audio?.input?.transcription?.model !== deployment) {
  fail(`Translate minimal test failed: returned transcription model did not match '${deployment}'`);
}

if (!result.tokenReturned) {
  fail("Translate minimal test failed: Azure did not return an ephemeral token value");
}

console.log("✅ Translate minimal client_secrets test passed.");

function resolveTranslateEndpoint() {
  return (
    resolveAzureEndpoint("AZURE_OPENAI_TRANSLATE_ENDPOINT", "AZURE_OPENAI_TRANSLATE_RESOURCE") ||
    resolveAzureEndpoint("AZURE_OPENAI_ENDPOINT", "AZURE_OPENAI_RESOURCE")
  );
}

function resolveAzureEndpoint(endpointName, resourceName) {
  const endpointValue = optionalEnv(endpointName);
  if (endpointValue) {
    return normalizeAzureEndpoint(endpointValue);
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
    return new URL(trimmed).origin;
  } catch {
    return trimmed;
  }
}

function optionalEnv(name) {
  const value = process.env[name]?.trim();
  if (!value || value.startsWith("<") || value.toLowerCase() === "changeme") {
    return "";
  }

  return value;
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function fail(message) {
  console.error(`❌ ${message}`);
  process.exit(1);
}