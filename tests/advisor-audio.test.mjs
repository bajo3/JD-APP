import assert from "node:assert/strict";
import test from "node:test";

const { audioAttachment, transcribeAudio, MAX_ADVISOR_AUDIO_BYTES } =
  await import("../lib/server/advisor-audio.ts");

test("detecta una nota de voz y rechaza URLs inseguras", () => {
  assert.deepEqual(audioAttachment(JSON.stringify([{
    type: "audio",
    contentType: "audio/ogg",
    url: "https://zernio.com/api/v1/whatsapp/media/media-1?accountId=account-1",
  }])), {
    contentType: "audio/ogg",
    url: "https://zernio.com/api/v1/whatsapp/media/media-1?accountId=account-1",
  });
  assert.equal(audioAttachment(JSON.stringify([{
    type: "audio",
    url: "http://zernio.com/audio.ogg",
  }])), null);
});

test("descarga WhatsApp con Zernio y envía el audio a transcripción", async () => {
  const requests = [];
  const fetchImpl = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    if (String(url).includes("api.openai.com")) {
      assert.ok(init.body instanceof FormData);
      assert.equal(init.body.get("model"), "gpt-transcribe");
      return Response.json({ text: "Busco un auto para trabajar." });
    }
    return new Response(new Uint8Array([1, 2, 3]), {
      headers: { "content-type": "audio/ogg", "content-length": "3" },
    });
  };
  const transcript = await transcribeAudio({
    contentType: "audio/ogg",
    url: "https://zernio.com/api/v1/whatsapp/media/media-1?accountId=account-1",
  }, "whatsapp", {
    fetchImpl,
    openAIApiKey: "openai-test-key-long-enough",
    zernioApiKey: "zernio-test-key-long-enough",
  });
  assert.equal(transcript, "Busco un auto para trabajar.");
  assert.equal(requests[0].init.headers.Authorization, "Bearer zernio-test-key-long-enough");
  assert.equal(requests[1].init.headers.Authorization, "Bearer openai-test-key-long-enough");
});

test("no expone la clave de Zernio a otro host y corta audios grandes", async () => {
  await assert.rejects(() => transcribeAudio({
    contentType: "audio/ogg",
    url: "https://evil.example/whatsapp/media/1",
  }, "whatsapp", {
    fetchImpl: async () => { throw new Error("no debería descargar"); },
    openAIApiKey: "openai-test-key-long-enough",
    zernioApiKey: "zernio-test-key-long-enough",
  }), /UNTRUSTED_WHATSAPP_MEDIA_URL/);

  await assert.rejects(() => transcribeAudio({
    contentType: "audio/ogg",
    url: "https://cdn.example/audio.ogg",
  }, "instagram", {
    fetchImpl: async () => new Response(null, {
      headers: { "content-length": String(MAX_ADVISOR_AUDIO_BYTES + 1) },
    }),
    openAIApiKey: "openai-test-key-long-enough",
  }), /AUDIO_TOO_LARGE/);
});
