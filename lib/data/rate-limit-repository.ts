import { getD1Binding } from "@/db";

export type RateLimitDecision = Readonly<{
  hits: number;
}>;

export type RateLimitRepositoryLike = Pick<
  D1RateLimitRepository,
  "hit" | "removeExpired"
>;

/**
 * Contador por ventana fija persistido en D1: ningún isolate del Worker
 * guarda estado en memoria y dos instancias concurrentes ven el mismo
 * contador. La fila vence con la ventana y se depura por antigüedad.
 */
export class D1RateLimitRepository {
  constructor(private readonly d1: D1Database = getD1Binding()) {}

  async hit(input: {
    key: string;
    resource: string;
    expiresAt: string;
  }): Promise<RateLimitDecision> {
    const row = await this.d1
      .prepare(
        // Postgres considera ambigua una referencia a "hits" sin calificar
        // dentro de ON CONFLICT DO UPDATE SET cuando el valor depende de la
        // fila existente (a diferencia de excluded.columna, que nunca es
        // ambiguo); el alias de tabla lo saca de duda.
        `INSERT INTO rate_limit_window AS w (key, resource, expires_at, hits)
         VALUES (?, ?, ?, 1)
         ON CONFLICT(key) DO UPDATE SET hits = w.hits + 1
         RETURNING hits`,
      )
      .bind(input.key, input.resource, input.expiresAt)
      .first<{ hits: number }>();
    return { hits: Number(row?.hits ?? 1) };
  }

  async removeExpired(nowIso: string): Promise<void> {
    await this.d1
      .prepare("DELETE FROM rate_limit_window WHERE expires_at <= ?")
      .bind(nowIso)
      .run();
  }
}
