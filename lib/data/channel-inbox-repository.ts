import { getD1Binding } from "@/db";

/** Identificador del proveedor del puente en todas las tablas del canal. */
export const CHANNEL_PROVIDER_ZERNIO = "ZERNIO";

export type ChannelAccountRecord = Readonly<{
  id: string;
  platform: string;
  displayName: string;
  status: string;
  defaultAssignee: string | null;
}>;

export type ConversationRecord = Readonly<{
  id: string;
  leadId: string | null;
  assignedTo: string | null;
}>;

export type OutboundContext = Readonly<{
  id: string;
  provider: string;
  externalConversationId: string;
  platform: string;
  participantExternalId: string;
  lastInboundAt: string | null;
  handling: string;
  assignedTo: string | null;
  leadId: string | null;
  status: string;
  channelAccountId: string;
  externalAccountId: string;
  accountStatus: string;
}>;

export type InboundIngestInput = Readonly<{
  provider: string;
  externalEventId: string;
  channelAccount: ChannelAccountRecord;
  externalConversationId: string;
  platform: string;
  participantExternalId: string;
  participantPhoneNormalized: string | null;
  participantDisplayName: string | null;
  message: {
    id: string;
    externalMessageId: string;
    platformMessageId: string | null;
    direction: "incoming" | "outgoing";
    authorType: string;
    text: string | null;
    attachmentsJson: string;
    occurredAt: string;
  } | null;
  conversationId: string;
  lead: { id: string; name: string; source: string; assignedTo: string | null } | null;
  leadId: string | null;
  leadEventId: string | null;
  occurredAt: string;
}>;

/**
 * Bandeja unificada persistida en D1. Cada evento del puente entra una sola
 * vez —la clave es el identificador estable que manda el proveedor— y la
 * normalización a conversación, mensaje, lead y línea de tiempo ocurre en un
 * único batch: un corte a la mitad no puede dejar un mensaje sin conversación
 * ni un lead sin su evento.
 */
export class D1ChannelInboxRepository {
  constructor(private readonly d1: D1Database = getD1Binding()) {}

  /**
   * Reserva el evento. Devuelve `false` cuando el proveedor reintenta uno que
   * ya habíamos aceptado: el reintento no vuelve a escribir nada.
   */
  async claimEvent(input: {
    id: string;
    provider: string;
    externalEventId: string;
    type: string;
    payloadHash: string;
    payloadJson: string;
    receivedAt: string;
  }): Promise<boolean> {
    const row = await this.d1
      .prepare(
        `INSERT INTO channel_webhook_event
           (id, provider, external_event_id, type, payload_hash, payload_json, status, received_at)
         VALUES (?, ?, ?, ?, ?, ?, 'RECEIVED', ?)
         ON CONFLICT(provider, external_event_id) DO UPDATE SET
           status = 'RECEIVED',
           failure_reason = NULL,
           processed_at = NULL,
           received_at = excluded.received_at
         WHERE channel_webhook_event.status = 'FAILED'
         RETURNING id`,
      )
      .bind(
        input.id,
        input.provider,
        input.externalEventId,
        input.type,
        input.payloadHash,
        input.payloadJson,
        input.receivedAt,
      )
      .first<{ id: string }>();
    return row !== null;
  }

  async markEvent(input: {
    provider: string;
    externalEventId: string;
    status: "PROCESSED" | "IGNORED" | "FAILED";
    failureReason: string | null;
    processedAt: string;
  }): Promise<void> {
    await this.d1
      .prepare(
        `UPDATE channel_webhook_event
            SET status = ?, failure_reason = ?, processed_at = ?
          WHERE provider = ? AND external_event_id = ?`,
      )
      .bind(
        input.status,
        input.failureReason,
        input.processedAt,
        input.provider,
        input.externalEventId,
      )
      .run();
  }

  async findAccount(
    provider: string,
    externalAccountId: string,
  ): Promise<ChannelAccountRecord | null> {
    const row = await this.d1
      .prepare(
        `SELECT id, platform, display_name, status, default_assignee
           FROM channel_account
          WHERE provider = ? AND external_account_id = ?`,
      )
      .bind(provider, externalAccountId)
      .first<{
        id: string;
        platform: string;
        display_name: string;
        status: string;
        default_assignee: string | null;
      }>();
    if (!row) return null;
    return {
      id: String(row.id),
      platform: String(row.platform),
      displayName: String(row.display_name),
      status: String(row.status),
      defaultAssignee: row.default_assignee === null ? null : String(row.default_assignee),
    };
  }

  /**
   * Todas las cuentas del canal, para la pantalla que las administra. Sin
   * filtrar por estado: una cuenta pausada tiene que poder verse y
   * reactivarse, no desaparecer.
   */
  async listChannelAccounts(): Promise<
    Array<{
      id: string;
      provider: string;
      platform: string;
      externalAccountId: string;
      displayName: string;
      status: string;
      defaultAssignee: string | null;
      createdAt: string;
    }>
  > {
    const result = await this.d1
      .prepare(
        `SELECT id, provider, platform, external_account_id, display_name, status, default_assignee, created_at
           FROM channel_account
          ORDER BY created_at DESC`,
      )
      .all<Record<string, unknown>>();
    return (result.results ?? []).map((row) => ({
      id: String(row.id),
      provider: String(row.provider),
      platform: String(row.platform),
      externalAccountId: String(row.external_account_id),
      displayName: String(row.display_name),
      status: String(row.status),
      defaultAssignee: row.default_assignee === null ? null : String(row.default_assignee),
      createdAt: String(row.created_at),
    }));
  }

  /**
   * Da de alta o actualiza una cuenta del canal. Idempotente por
   * `(provider, external_account_id)`: reconectar la misma cuenta desde el
   * panel corrige nombre, estado y responsable en lugar de duplicar la fila
   * ni fallar.
   */
  async createChannelAccount(input: {
    id: string;
    provider: string;
    platform: string;
    externalAccountId: string;
    displayName: string;
    status: string;
    defaultAssignee: string | null;
    updatedAt: string;
  }): Promise<{ id: string }> {
    const row = await this.d1
      .prepare(
        `INSERT INTO channel_account
           (id, provider, platform, external_account_id, display_name, status, default_assignee, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(provider, external_account_id) DO UPDATE SET
           platform = excluded.platform,
           display_name = excluded.display_name,
           status = excluded.status,
           default_assignee = excluded.default_assignee,
           updated_at = excluded.updated_at,
           version = channel_account.version + 1
         RETURNING id`,
      )
      .bind(
        input.id,
        input.provider,
        input.platform,
        input.externalAccountId,
        input.displayName,
        input.status,
        input.defaultAssignee,
        input.updatedAt,
      )
      .first<{ id: string }>();
    return { id: String(row?.id ?? input.id) };
  }

  async findConversation(
    provider: string,
    externalConversationId: string,
  ): Promise<ConversationRecord | null> {
    const row = await this.d1
      .prepare(
        `SELECT id, lead_id, assigned_to
           FROM inbox_conversation
          WHERE provider = ? AND external_conversation_id = ?`,
      )
      .bind(provider, externalConversationId)
      .first<{ id: string; lead_id: string | null; assigned_to: string | null }>();
    if (!row) return null;
    return {
      id: String(row.id),
      leadId: row.lead_id === null ? null : String(row.lead_id),
      assignedTo: row.assigned_to === null ? null : String(row.assigned_to),
    };
  }

  async findLeadIdByPhone(phoneNormalized: string): Promise<string | null> {
    const row = await this.d1
      .prepare(
        `SELECT id FROM lead
          WHERE phone_normalized = ?
          ORDER BY created_at DESC
          LIMIT 1`,
      )
      .bind(phoneNormalized)
      .first<{ id: string }>();
    return row ? String(row.id) : null;
  }

  async ingestMessage(input: InboundIngestInput): Promise<void> {
    const statements: D1PreparedStatement[] = [];
    const inbound = input.message?.direction !== "outgoing";

    if (input.lead && input.participantPhoneNormalized) {
      statements.push(
        this.d1
          .prepare(
            `INSERT INTO lead (id, name, phone_normalized, source, status, assigned_to)
             VALUES (?, ?, ?, ?, 'NEW', ?)`,
          )
          .bind(
            input.lead.id,
            input.lead.name,
            input.participantPhoneNormalized,
            input.lead.source,
            input.lead.assignedTo,
          ),
      );
    }

    statements.push(
      this.d1
        .prepare(
          `INSERT INTO inbox_conversation
             (id, provider, external_conversation_id, channel_account_id, platform,
              participant_external_id, participant_phone_normalized, participant_display_name,
              lead_id, status, handling, assigned_to, last_inbound_at, last_outbound_at,
              created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', 'HUMAN', ?, ?, ?, ?, ?)
           ON CONFLICT(provider, external_conversation_id) DO UPDATE SET
             participant_display_name =
               COALESCE(excluded.participant_display_name, inbox_conversation.participant_display_name),
             participant_phone_normalized =
               COALESCE(inbox_conversation.participant_phone_normalized, excluded.participant_phone_normalized),
             lead_id = COALESCE(inbox_conversation.lead_id, excluded.lead_id),
             assigned_to = COALESCE(inbox_conversation.assigned_to, excluded.assigned_to),
             status = CASE WHEN inbox_conversation.status = 'CLOSED' THEN 'OPEN' ELSE inbox_conversation.status END,
             last_inbound_at = COALESCE(excluded.last_inbound_at, inbox_conversation.last_inbound_at),
             last_outbound_at = COALESCE(excluded.last_outbound_at, inbox_conversation.last_outbound_at),
             updated_at = excluded.updated_at,
             version = inbox_conversation.version + 1`,
        )
        .bind(
          input.conversationId,
          input.provider,
          input.externalConversationId,
          input.channelAccount.id,
          input.platform,
          input.participantExternalId,
          input.participantPhoneNormalized,
          input.participantDisplayName,
          input.leadId,
          input.channelAccount.defaultAssignee,
          inbound ? input.occurredAt : null,
          inbound ? null : input.occurredAt,
          input.occurredAt,
          input.occurredAt,
        ),
    );

    if (input.message) {
      const message = input.message;
      statements.push(
        this.d1
          .prepare(
            `INSERT INTO inbox_message
               (id, conversation_id, provider, external_message_id, platform_message_id,
                direction, author_type, text, attachments_json, occurred_at)
             SELECT ?, c.id, ?, ?, ?, ?, ?, ?, ?, ?
               FROM inbox_conversation c
              WHERE c.provider = ? AND c.external_conversation_id = ?
             ON CONFLICT(provider, external_message_id) DO NOTHING`,
          )
          .bind(
            message.id,
            input.provider,
            message.externalMessageId,
            message.platformMessageId,
            message.direction,
            message.authorType,
            message.text,
            message.attachmentsJson,
            message.occurredAt,
            input.provider,
            input.externalConversationId,
          ),
      );

      if (input.leadEventId) {
        statements.push(
          this.d1
            .prepare(
              `INSERT INTO lead_event (id, lead_id, type, actor_type, actor_id, metadata_json, occurred_at)
               SELECT ?, c.lead_id, ?, ?, ?, ?, ?
                 FROM inbox_conversation c
                WHERE c.provider = ? AND c.external_conversation_id = ? AND c.lead_id IS NOT NULL`,
            )
            .bind(
              input.leadEventId,
              inbound ? "INBOX_MESSAGE_RECEIVED" : "INBOX_MESSAGE_SENT",
              inbound ? "CUSTOMER" : "SYSTEM",
              input.channelAccount.id,
              JSON.stringify({ platform: input.platform, provider: input.provider }),
              message.occurredAt,
              input.provider,
              input.externalConversationId,
            ),
        );
      }
    }

    statements.push(
      this.d1
        .prepare(
          `UPDATE channel_webhook_event
              SET status = 'PROCESSED', processed_at = ?
            WHERE provider = ? AND external_event_id = ?`,
        )
        .bind(input.occurredAt, input.provider, input.externalEventId),
    );

    await this.d1.batch(statements);
  }

  /**
   * Contexto de envío: la conversación con la cuenta que la atiende. Trae
   * `last_inbound_at` porque de ahí sale la ventana de 24 horas de WhatsApp,
   * que decide si se puede escribir libre o hace falta plantilla aprobada.
   */
  async findConversationForOutbound(conversationId: string): Promise<OutboundContext | null> {
    const row = await this.d1
      .prepare(
        `SELECT c.id, c.provider, c.external_conversation_id, c.platform,
                c.participant_external_id, c.last_inbound_at, c.handling,
                c.assigned_to, c.lead_id, c.status,
                a.id AS account_id, a.external_account_id, a.status AS account_status
           FROM inbox_conversation c
           JOIN channel_account a ON a.id = c.channel_account_id
          WHERE c.id = ?`,
      )
      .bind(conversationId)
      .first<Record<string, unknown>>();
    if (!row) return null;
    return {
      id: String(row.id),
      provider: String(row.provider),
      externalConversationId: String(row.external_conversation_id),
      platform: String(row.platform),
      participantExternalId: String(row.participant_external_id),
      lastInboundAt: row.last_inbound_at === null ? null : String(row.last_inbound_at),
      handling: String(row.handling),
      assignedTo: row.assigned_to === null ? null : String(row.assigned_to),
      leadId: row.lead_id === null ? null : String(row.lead_id),
      status: String(row.status),
      channelAccountId: String(row.account_id),
      externalAccountId: String(row.external_account_id),
      accountStatus: String(row.account_status),
    };
  }

  /**
   * Cola de la bandeja para el panel: una fila por conversación abierta, con
   * el nombre del contacto, el último texto y si está esperando respuesta. No
   * calcula el SLA acá —eso es responsabilidad del que arma la pantalla, con
   * un reloj inyectable—; sólo entrega el dato crudo ordenado por prioridad:
   * primero lo que nadie contestó desde el último mensaje del cliente, de lo
   * más viejo a lo más nuevo esperando; después el resto, más reciente primero.
   */
  async listConversationQueue(limit = 100): Promise<
    Array<{
      id: string;
      platform: string;
      participantDisplayName: string | null;
      participantPhoneNormalized: string | null;
      status: string;
      handling: string;
      assignedTo: string | null;
      leadId: string | null;
      leadName: string | null;
      lastInboundAt: string | null;
      lastOutboundAt: string | null;
      lastMessageText: string | null;
      accountDisplayName: string;
    }>
  > {
    const result = await this.d1
      .prepare(
        `SELECT c.id, c.platform, c.participant_display_name, c.participant_phone_normalized,
                c.status, c.handling, c.assigned_to, c.lead_id, l.name AS lead_name,
                c.last_inbound_at, c.last_outbound_at, a.display_name AS account_display_name,
                (SELECT m.text FROM inbox_message m
                  WHERE m.conversation_id = c.id
                  ORDER BY m.occurred_at DESC, m.rowid DESC LIMIT 1) AS last_message_text,
                CASE
                  WHEN c.last_inbound_at IS NOT NULL
                   AND (c.last_outbound_at IS NULL OR c.last_outbound_at < c.last_inbound_at)
                  THEN 0 ELSE 1
                END AS waiting_rank
           FROM inbox_conversation c
           JOIN channel_account a ON a.id = c.channel_account_id
           LEFT JOIN lead l ON l.id = c.lead_id
          WHERE c.status != 'CLOSED'
          ORDER BY waiting_rank ASC,
                   CASE WHEN waiting_rank = 0 THEN c.last_inbound_at END ASC,
                   c.last_inbound_at DESC
          LIMIT ?`,
      )
      .bind(Math.max(1, Math.min(limit, 200)))
      .all<Record<string, unknown>>();
    return (result.results ?? []).map((row) => ({
      id: String(row.id),
      platform: String(row.platform),
      participantDisplayName: row.participant_display_name === null ? null : String(row.participant_display_name),
      participantPhoneNormalized:
        row.participant_phone_normalized === null ? null : String(row.participant_phone_normalized),
      status: String(row.status),
      handling: String(row.handling),
      assignedTo: row.assigned_to === null ? null : String(row.assigned_to),
      leadId: row.lead_id === null ? null : String(row.lead_id),
      leadName: row.lead_name === null ? null : String(row.lead_name),
      lastInboundAt: row.last_inbound_at === null ? null : String(row.last_inbound_at),
      lastOutboundAt: row.last_outbound_at === null ? null : String(row.last_outbound_at),
      lastMessageText: row.last_message_text === null ? null : String(row.last_message_text),
      accountDisplayName: String(row.account_display_name),
    }));
  }

  /**
   * Una sola fila de la cola, para la pantalla de detalle. Mismas columnas
   * que `listConversationQueue`, sin traer las demás conversaciones abiertas
   * sólo para descartarlas.
   */
  async findConversationQueueRow(conversationId: string): Promise<{
    id: string;
    platform: string;
    participantDisplayName: string | null;
    participantPhoneNormalized: string | null;
    status: string;
    handling: string;
    assignedTo: string | null;
    leadId: string | null;
    leadName: string | null;
    lastInboundAt: string | null;
    lastOutboundAt: string | null;
    lastMessageText: string | null;
    accountDisplayName: string;
  } | null> {
    const row = await this.d1
      .prepare(
        `SELECT c.id, c.platform, c.participant_display_name, c.participant_phone_normalized,
                c.status, c.handling, c.assigned_to, c.lead_id, l.name AS lead_name,
                c.last_inbound_at, c.last_outbound_at, a.display_name AS account_display_name,
                (SELECT m.text FROM inbox_message m
                  WHERE m.conversation_id = c.id
                  ORDER BY m.occurred_at DESC, m.rowid DESC LIMIT 1) AS last_message_text
           FROM inbox_conversation c
           JOIN channel_account a ON a.id = c.channel_account_id
           LEFT JOIN lead l ON l.id = c.lead_id
          WHERE c.id = ?`,
      )
      .bind(conversationId)
      .first<Record<string, unknown>>();
    if (!row) return null;
    return {
      id: String(row.id),
      platform: String(row.platform),
      participantDisplayName: row.participant_display_name === null ? null : String(row.participant_display_name),
      participantPhoneNormalized:
        row.participant_phone_normalized === null ? null : String(row.participant_phone_normalized),
      status: String(row.status),
      handling: String(row.handling),
      assignedTo: row.assigned_to === null ? null : String(row.assigned_to),
      leadId: row.lead_id === null ? null : String(row.lead_id),
      leadName: row.lead_name === null ? null : String(row.lead_name),
      lastInboundAt: row.last_inbound_at === null ? null : String(row.last_inbound_at),
      lastOutboundAt: row.last_outbound_at === null ? null : String(row.last_outbound_at),
      lastMessageText: row.last_message_text === null ? null : String(row.last_message_text),
      accountDisplayName: String(row.account_display_name),
    };
  }

  /**
   * Deja el saliente en la bandeja con su autor y la cita de la que salió cada
   * cifra. El webhook `message.sent` llega después y no duplica: la clave
   * única por mensaje del proveedor lo impide.
   */
  async recordOutboundMessage(input: {
    id: string;
    conversationId: string;
    provider: string;
    externalConversationId: string;
    externalMessageId: string;
    platformMessageId: string | null;
    authorType: string;
    authorId: string | null;
    text: string;
    simulationId: string | null;
    leadEventId: string | null;
    occurredAt: string;
  }): Promise<void> {
    const statements = [
      this.d1
        .prepare(
          `INSERT INTO inbox_message
             (id, conversation_id, provider, external_message_id, platform_message_id,
              direction, author_type, author_id, text, attachments_json, simulation_id, occurred_at)
           VALUES (?, ?, ?, ?, ?, 'outgoing', ?, ?, ?, '[]', ?, ?)
           ON CONFLICT(provider, external_message_id) DO NOTHING`,
        )
        .bind(
          input.id,
          input.conversationId,
          input.provider,
          input.externalMessageId,
          input.platformMessageId,
          input.authorType,
          input.authorId,
          input.text,
          input.simulationId,
          input.occurredAt,
        ),
      this.d1
        .prepare(
          `UPDATE inbox_conversation
              SET last_outbound_at = ?, updated_at = ?, version = version + 1
            WHERE id = ?`,
        )
        .bind(input.occurredAt, input.occurredAt, input.conversationId),
    ];
    if (input.leadEventId) {
      statements.push(
        this.d1
          .prepare(
            `INSERT INTO lead_event (id, lead_id, type, actor_type, actor_id, metadata_json, occurred_at)
             SELECT ?, c.lead_id, 'INBOX_MESSAGE_SENT', ?, ?, ?, ?
               FROM inbox_conversation c
              WHERE c.id = ? AND c.lead_id IS NOT NULL`,
          )
          .bind(
            input.leadEventId,
            input.authorType === "AI" ? "SYSTEM" : "USER",
            input.authorId,
            JSON.stringify({ externalMessageId: input.externalMessageId }),
            input.occurredAt,
            input.conversationId,
          ),
      );
    }
    await this.d1.batch(statements);
  }

  /**
   * Interruptor por conversación entre asesor e intervención humana. La
   * escalada la registra el circuito de salida; acá sólo se asienta.
   */
  async setHandling(input: {
    conversationId: string;
    handling: "AI" | "HUMAN";
    assignedTo: string | null;
    updatedAt: string;
  }): Promise<void> {
    await this.d1
      .prepare(
        `UPDATE inbox_conversation
            SET handling = ?,
                assigned_to = COALESCE(?, assigned_to),
                updated_at = ?,
                version = version + 1
          WHERE id = ?`,
      )
      .bind(input.handling, input.assignedTo, input.updatedAt, input.conversationId)
      .run();
  }

  /**
   * Últimos mensajes de la conversación, del más viejo al más nuevo. Es el
   * hilo que ve el asesor y el que se le entrega al vendedor cuando escala.
   */
  async listRecentMessages(
    conversationId: string,
    limit = 20,
  ): Promise<Array<{ direction: string; authorType: string; text: string | null; occurredAt: string }>> {
    const result = await this.d1
      .prepare(
        `SELECT direction, author_type, text, occurred_at
           FROM inbox_message
          WHERE conversation_id = ?
          ORDER BY occurred_at DESC, rowid DESC
          LIMIT ?`,
      )
      .bind(conversationId, Math.max(1, Math.min(limit, 100)))
      .all<{ direction: string; author_type: string; text: string | null; occurred_at: string }>();
    const rows = result.results ?? [];
    return rows
      .map((row) => ({
        direction: String(row.direction),
        authorType: String(row.author_type),
        text: row.text === null ? null : String(row.text),
        occurredAt: String(row.occurred_at),
      }))
      .reverse();
  }

  /**
   * Asienta un hecho de la conversación en la línea de tiempo del lead. Si la
   * conversación todavía no tiene lead —Instagram sin teléfono, por ejemplo—
   * no escribe nada en lugar de inventar uno.
   */
  async recordConversationEvent(input: {
    id: string;
    conversationId: string;
    type: string;
    actorType: string;
    actorId: string | null;
    metadataJson: string;
    occurredAt: string;
  }): Promise<void> {
    await this.d1
      .prepare(
        `INSERT INTO lead_event (id, lead_id, type, actor_type, actor_id, metadata_json, occurred_at)
         SELECT ?, c.lead_id, ?, ?, ?, ?, ?
           FROM inbox_conversation c
          WHERE c.id = ? AND c.lead_id IS NOT NULL`,
      )
      .bind(
        input.id,
        input.type,
        input.actorType,
        input.actorId,
        input.metadataJson,
        input.occurredAt,
        input.conversationId,
      )
      .run();
  }

  /**
   * Estado de entrega de un saliente. No crea nada: si el mensaje no está en
   * la bandeja, el evento se archiva como ignorado en lugar de inventar una
   * fila para colgarle el estado.
   */
  async updateDeliveryStatus(input: {
    provider: string;
    externalMessageId: string;
    deliveryStatus: string;
    deliveryError: string | null;
  }): Promise<boolean> {
    const result = await this.d1
      .prepare(
        `UPDATE inbox_message
            SET delivery_status = ?, delivery_error = ?
          WHERE provider = ? AND external_message_id = ?`,
      )
      .bind(
        input.deliveryStatus,
        input.deliveryError,
        input.provider,
        input.externalMessageId,
      )
      .run();
    return Number(result.meta?.changes ?? 0) > 0;
  }
}

export type ChannelInboxRepositoryLike = Pick<
  D1ChannelInboxRepository,
  | "claimEvent"
  | "markEvent"
  | "findAccount"
  | "findConversation"
  | "findLeadIdByPhone"
  | "ingestMessage"
  | "updateDeliveryStatus"
  | "findConversationForOutbound"
  | "recordOutboundMessage"
  | "setHandling"
  | "recordConversationEvent"
  | "listRecentMessages"
  | "listConversationQueue"
  | "findConversationQueueRow"
  | "listChannelAccounts"
  | "createChannelAccount"
>;
