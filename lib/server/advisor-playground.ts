import {
  ApiError,
  readJsonObject,
} from "./api";
import { adminApiRoute, adminData } from "./admin-api";
import { runAdvisorTurn, type AdvisorMessage } from "./advisor";
import { buildAdvisorContext } from "./advisor-reply";

/** El playground es deliberadamente acotado: alcanza para probar una charla real sin convertirlo en un inbox. */
export const ADVISOR_TEST_MESSAGE_LIMIT = 20;
export const ADVISOR_TEST_MESSAGE_MAX_CHARS = 2_000;

type TestMessage = Readonly<{
  role: "user" | "assistant";
  content: string;
}>;

function testMessages(payload: Record<string, unknown>): TestMessage[] {
  const raw = payload.messages;
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > ADVISOR_TEST_MESSAGE_LIMIT) {
    throw new ApiError(
      422,
      "VALIDATION_ERROR",
      "Hay datos inválidos.",
      { messages: `Enviá entre 1 y ${ADVISOR_TEST_MESSAGE_LIMIT} mensajes.` },
    );
  }

  const messages: TestMessage[] = [];
  let totalChars = 0;
  raw.forEach((value, index) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new ApiError(422, "VALIDATION_ERROR", "Hay datos inválidos.", {
        [`messages.${index}`]: "Cada mensaje debe tener rol y texto.",
      });
    }
    const item = value as Record<string, unknown>;
    const role = item.role === "user" || item.role === "assistant" ? item.role : null;
    const content = typeof item.content === "string" ? item.content.trim() : "";
    if (!role || content.length === 0 || content.length > ADVISOR_TEST_MESSAGE_MAX_CHARS) {
      throw new ApiError(422, "VALIDATION_ERROR", "Hay datos inválidos.", {
        [`messages.${index}`]: `Usá user/assistant y texto de 1 a ${ADVISOR_TEST_MESSAGE_MAX_CHARS} caracteres.`,
      });
    }
    totalChars += content.length;
    if (totalChars > 16_000) {
      throw new ApiError(422, "VALIDATION_ERROR", "Hay datos inválidos.", {
        messages: "La prueba no puede superar 16.000 caracteres.",
      });
    }
    messages.push({ role, content });
  });

  if (messages[0]?.role !== "user" || messages.at(-1)?.role !== "user") {
    throw new ApiError(422, "VALIDATION_ERROR", "Hay datos inválidos.", {
      messages: "La prueba tiene que empezar y terminar con un mensaje del cliente.",
    });
  }
  return messages;
}

function advisorMessages(messages: readonly TestMessage[]): AdvisorMessage[] {
  return messages.map(({ role, content }) => ({ role, content }));
}

/**
 * Ejecuta un turno del mismo asesor que atiende los canales, pero con un
 * contexto aislado y herramientas de escritura bloqueadas por código.
 */
export function advisorTest(request: Request): Promise<Response> {
  return adminApiRoute(request, async () => {
    const payload = await readJsonObject(request);
    const messages = testMessages(payload);
    const current = messages.at(-1);
    if (!current) throw new ApiError(422, "VALIDATION_ERROR", "Falta el mensaje de prueba.");
    const history = messages.slice(0, -1);
    const contextSummary = buildAdvisorContext(
      history.map((message) => ({
        direction: message.role === "assistant" ? "outgoing" : "incoming",
        text: message.content,
      })),
      current.content,
    );
    const turn = await runAdvisorTurn(
      {
        conversationId: "advisor-test-playground",
        history: advisorMessages(history),
        message: current.content,
        contextSummary,
      },
      {
        toolContext: { testMode: true },
      },
    );
    return adminData({
      reply: turn.reply,
      escalated: turn.escalated,
      outcome: turn.outcome,
      toolCalls: turn.toolCalls,
      vehicleCards: turn.vehicleCards,
      testMode: true,
    });
  });
}
