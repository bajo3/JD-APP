export const MAX_ADVISOR_AUDIO_BYTES = 16 * 1024 * 1024;
export const OPENAI_TRANSCRIBE_MODEL = "gpt-transcribe";

export type AdvisorAudioRuntime = Readonly<{
  fetchImpl?: typeof fetch;
  openAIApiKey?: string;
  zernioApiKey?: string;
  timeoutMs?: number;
}>;

type AudioAttachment = Readonly<{ url: string; contentType: string }>;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(source: Record<string, unknown> | null, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = source?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

export function audioAttachment(attachmentsJson?: string | null): AudioAttachment | null {
  if (!attachmentsJson) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(attachmentsJson); } catch { return null; }
  if (!Array.isArray(parsed)) return null;
  for (const raw of parsed) {
    const attachment = record(raw);
    const payload = record(attachment?.payload);
    const type = text(attachment, "type", "attachmentType")?.toLowerCase();
    const declaredContentType = text(attachment, "contentType", "mimeType")?.toLowerCase() ?? "";
    const rawUrl = text(attachment, "url", "attachmentUrl") ?? text(payload, "url");
    if (!rawUrl || (type !== "audio" && !declaredContentType.startsWith("audio/"))) continue;
    try {
      const url = new URL(rawUrl);
      if (url.protocol !== "https:" || url.username || url.password || url.href.length > 8_192) continue;
      return {
        url: url.href,
        contentType: declaredContentType.startsWith("audio/") ? declaredContentType : "audio/ogg",
      };
    } catch { continue; }
  }
  return null;
}

async function boundedBytes(response: Response): Promise<Uint8Array> {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > MAX_ADVISOR_AUDIO_BYTES) throw new Error("AUDIO_TOO_LARGE");
  if (!response.body) throw new Error("AUDIO_EMPTY");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_ADVISOR_AUDIO_BYTES) {
      await reader.cancel();
      throw new Error("AUDIO_TOO_LARGE");
    }
    chunks.push(value);
  }
  if (size === 0) throw new Error("AUDIO_EMPTY");
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

function zernioOrigin(): string {
  try { return new URL(process.env.ZERNIO_API_BASE_URL?.trim() || "https://zernio.com/api").origin; }
  catch { return "https://zernio.com"; }
}

export async function transcribeAudio(
  attachment: AudioAttachment,
  platform: string,
  runtime: AdvisorAudioRuntime = {},
): Promise<string> {
  const fetchImpl = runtime.fetchImpl ?? fetch;
  const openAIKey = (runtime.openAIApiKey ?? process.env.OPENAI_API_KEY ?? "").trim();
  if (openAIKey.length < 16) throw new Error("TRANSCRIPTION_NOT_CONFIGURED");
  const url = new URL(attachment.url);
  const headers: Record<string, string> = {};
  if (platform === "whatsapp") {
    if (url.origin !== zernioOrigin() || !url.pathname.includes("/whatsapp/media/")) {
      throw new Error("UNTRUSTED_WHATSAPP_MEDIA_URL");
    }
    const zernioKey = (runtime.zernioApiKey ?? process.env.ZERNIO_API_KEY ?? "").trim();
    if (zernioKey.length < 16) throw new Error("ZERNIO_MEDIA_NOT_CONFIGURED");
    headers.Authorization = `Bearer ${zernioKey}`;
  }
  const response = await fetchImpl(url, {
    headers,
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(runtime.timeoutMs ?? 20_000),
  });
  if (!response.ok) throw new Error("AUDIO_DOWNLOAD_FAILED");
  const bytes = await boundedBytes(response);
  const form = new FormData();
  form.append("model", process.env.OPENAI_TRANSCRIBE_MODEL?.trim() || OPENAI_TRANSCRIBE_MODEL);
  form.append("language", "es");
  const fileBytes = new Uint8Array(bytes.byteLength);
  fileBytes.set(bytes);
  form.append("file", new Blob([fileBytes.buffer], { type: attachment.contentType }), "mensaje.ogg");
  const transcriptResponse = await fetchImpl("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${openAIKey}` },
    body: form,
    signal: AbortSignal.timeout(runtime.timeoutMs ?? 20_000),
  });
  if (!transcriptResponse.ok) throw new Error("TRANSCRIPTION_FAILED");
  const payload = await transcriptResponse.json() as Record<string, unknown>;
  const transcript = typeof payload.text === "string" ? payload.text.trim().slice(0, 8_000) : "";
  if (!transcript) throw new Error("TRANSCRIPTION_EMPTY");
  return transcript;
}
