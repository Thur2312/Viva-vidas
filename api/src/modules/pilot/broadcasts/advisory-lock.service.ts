import { Injectable, OnModuleDestroy } from '@nestjs/common'
import { Pool } from 'pg'

/**
 * Trava consultiva de SESSÃO do Postgres (pg_try_advisory_lock) para que só uma instância rode o worker.
 * Usa uma conexão dedicada (pool de 1): travas de sessão não funcionam no pool compartilhado.
 * Se a instância cair, a conexão fecha e a trava é liberada sozinha. Exige conexão direta (não pgbouncer em modo transação).
 */
@Injectable()
export class AdvisoryLockService implements OnModuleDestroy {
  private pool?: Pool

  private get p(): Pool {
    if (!this.pool) {
      const url = process.env.PILOT_DATABASE_URL || process.env.DATABASE_URL
      if (!url) throw new Error('PILOT_DATABASE_URL (ou DATABASE_URL) não configurada')
      this.pool = new Pool({
        connectionString: url, max: 1,
        ssl: /supabase\.(co|com)|sslmode=require/.test(url) ? { rejectUnauthorized: false } : undefined,
      })
    }
    return this.pool
  }

  /** Executa `fn` só se conseguir a trava. Devolve `{ ran: false }` quando outra instância a detém. */
  async withLock<T>(key: number, fn: () => Promise<T>): Promise<{ ran: boolean; result?: T }> {
    const client = await this.p.connect()
    let locked = false
    try {
      const r = await client.query('SELECT pg_try_advisory_lock($1) AS ok', [key])
      locked = r.rows[0]?.ok === true
      if (!locked) return { ran: false }
      return { ran: true, result: await fn() }
    } finally {
      if (locked) await client.query('SELECT pg_advisory_unlock($1)', [key]).catch(() => undefined)
      client.release()
    }
  }

  async onModuleDestroy() {
    await this.pool?.end()
  }
}
