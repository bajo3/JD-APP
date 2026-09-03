import {
  D1ChannelInboxRepository,
  type ChannelInboxRepositoryLike,
} from "@/lib/data/channel-inbox-repository";
import { requirePanelUser, type PanelAuthDependencies } from "./panel-auth";

/** Minutos de espera antes de marcar la conversación "atender pronto" y "sin atender". */
export const SLA_SOON_MINUTES = 15;
export const SLA_LATE_MINUTES = 60;

export type SlaLabel = "answered" | "recent" | "soon" | "late";

export type ConversationQueueRow = Readonly<{
  id: string;
  platform: string;
  contactName: string;
  contactPhone: string | null;
  status: string;
  handling: string;
  assignedTo: string | null;
  leadId: string | null;
  accountName: string;
  lastMessagePreview: string | null;
  waitingMinutes: number | null;
  sla: SlaLabel;
}>;

export type ConversationThreadMessage = Readonly<{
  direction: string;
  authorType: string;
  text: string | null;
  occurredAt: string;
}>;

type Runtime = Readonly<{
  repository?: ChannelInboxRepositoryLike;
  now?: Date;
  panelAuth?: PanelAuthDependencies;
}>;

/**
 * Calcula cuántos minutos hace que nadie contesta y en qué franja de SLA cae.
 * Una conversación ya contestada (el último saliente es más nuevo que el
 * último entrante, o nunca hubo entrante) no tiene espera: "answered".
 */
export function slaFor(
  lastInboundAt: string | null,
  lastOutboundAt: string | null,
  now: Date,
): { waitingMinutes: number | null; sla: SlaLabel } {
  if (!lastInboundAt) return { waitingMinutes: null, sla: "answered" };
  const inbound = Date.parse(lastInboundAt);
  if (!Number.isFinite(inbound)) return { waitingMinutes: null, sla: "answered" };
  const outbound = lastOutboundAt ? Date.parse(lastOutboundAt) : null;
  if (outbound !== null && Number.isFinite(outbound) && outbound >= inbound) {
    return { waitingMinutes: null, sla: "answered" };
  }
  const waitingMinutes = Math.max(0, Math.round((now.getTime() - inbound) / 60_000));
  const sla: SlaLabel =
    waitingMinutes >= SLA_LATE_MINUTES ? "late" : waitingMinutes >= SLA_SOON_MINUTES ? "soon" : "recent";
  return { waitingMinutes, sla };
}

/**
 * Cola de la bandeja para `/panel/conversaciones`. El guard corre antes de
 * tocar la base: sin sesión de panel, nadie ve un solo mensaje de un cliente.
 */
export async function getConversationQueue(runtime: Runtime = {}): Promise<{
  rows: readonly ConversationQueueRow[];
  waitingCount: number;
  lateCount: number;
}> {
  await requirePanelUser(undefined, runtime.panelAuth);
  const repository = runtime.repository ?? new D1ChannelInboxRepository();
  const now = runtime.now ?? new Date();
  const raw = await repository.listConversationQueue();
  const rows = raw.map((row) => {
    const { waitingMinutes, sla } = slaFor(row.lastInboundAt, row.lastOutboundAt, now);
    return {
      id: row.id,
      platform: row.platform,
      contactName: row.leadName ?? row.participantDisplayName ?? "Contacto sin nombre",
      contactPhone: row.participantPhoneNormalized,
      status: row.status,
      handling: row.handling,
      assignedTo: row.assignedTo,
      leadId: row.leadId,
      accountName: row.accountDisplayName,
      lastMessagePreview: row.lastMessageText ? row.lastMessageText.slice(0, 140) : null,
      waitingMinutes,
      sla,
    } satisfies ConversationQueueRow;
  });
  return {
    rows,
    waitingCount: rows.filter((row) => row.sla !== "answered").length,
    lateCount: rows.filter((row) => row.sla === "late").length,
  };
}

/**
 * Hilo de una conversación puntual para la pantalla de detalle. No expone
 * nada si la conversación no existe: el llamador decide el 404.
 */
export async function getConversationThread(
  conversationId: string,
  runtime: Runtime = {},
): Promise<{
  conversation: ConversationQueueRow | null;
  messages: readonly ConversationThreadMessage[];
}> {
  await requirePanelUser(undefined, runtime.panelAuth);
  const repository = runtime.repository ?? new D1ChannelInboxRepository();
  const now = runtime.now ?? new Date();
  const [found, messages] = await Promise.all([
    repository.findConversationQueueRow(conversationId),
    repository.listRecentMessages(conversationId, 50),
  ]);
  if (!found) return { conversation: null, messages: [] };
  const { waitingMinutes, sla } = slaFor(found.lastInboundAt, found.lastOutboundAt, now);
  return {
    conversation: {
      id: found.id,
      platform: found.platform,
      contactName: found.leadName ?? found.participantDisplayName ?? "Contacto sin nombre",
      contactPhone: found.participantPhoneNormalized,
      status: found.status,
      handling: found.handling,
      assignedTo: found.assignedTo,
      leadId: found.leadId,
      accountName: found.accountDisplayName,
      lastMessagePreview: found.lastMessageText ? found.lastMessageText.slice(0, 140) : null,
      waitingMinutes,
      sla,
    },
    messages,
  };
}
