import { getD1Binding } from "@/db";

/**
 * Solicitudes de visita preparadas por el asesor. No representan una reserva
 * ni un turno confirmado: una persona del equipo todavía debe aceptarlas.
 */
export class D1VisitRequestRepository {
  constructor(private readonly d1: D1Database = getD1Binding()) {}

  async createRequest(input: {
    id: string;
    eventId: string;
    conversationId: string;
    leadId: string;
    vehicleId: string | null;
    requestedAt: string;
    assignedTo: string | null;
    note: string | null;
    createdAt: string;
  }): Promise<boolean> {
    const visit = this.d1
      .prepare(
        `INSERT INTO visit_request
           (id, lead_id, conversation_id, vehicle_id, requested_at, status,
            assigned_to, note, created_at, updated_at)
         SELECT ?, lead_id, id, ?, ?, 'REQUESTED', COALESCE(assigned_to, ?), ?, ?, ?
           FROM inbox_conversation
          WHERE id = ? AND lead_id = ? AND status = 'OPEN'
         ON CONFLICT DO NOTHING`,
      )
      .bind(
        input.id,
        input.vehicleId,
        input.requestedAt,
        input.assignedTo,
        input.note,
        input.createdAt,
        input.createdAt,
        input.conversationId,
        input.leadId,
      );
    const event = this.d1
      .prepare(
        `INSERT INTO lead_event
           (id, lead_id, type, actor_type, actor_id, metadata_json, occurred_at)
         SELECT ?, lead_id, 'VISIT_REQUESTED', 'AI', ?, ?, ?
           FROM visit_request
          WHERE id = ? AND changes() > 0`,
      )
      .bind(
        input.eventId,
        input.assignedTo,
        JSON.stringify({
          requestedAt: input.requestedAt,
          vehicleId: input.vehicleId,
          hasNote: input.note !== null,
          status: "REQUESTED",
        }),
        input.createdAt,
        input.id,
      );
    const handoff = this.d1
      .prepare(
        `UPDATE inbox_conversation
            SET handling = 'HUMAN', assigned_to = COALESCE(assigned_to, ?),
                version = version + 1, updated_at = ?
          WHERE id = ? AND EXISTS (SELECT 1 FROM lead_event WHERE id = ?)`,
      )
      .bind(input.assignedTo, input.createdAt, input.conversationId, input.eventId);
    // El evento queda inmediatamente después del INSERT: `changes()` sólo
    // permite continuar si esta solicitud creó la fila. Un replay no duplica
    // ni evento ni escalada a atención humana.
    const [result] = await this.d1.batch([visit, event, handoff]);
    return Number(result.meta?.changes ?? 0) > 0;
  }
}

export type VisitRequestRepositoryLike = Pick<D1VisitRequestRepository, "createRequest">;
