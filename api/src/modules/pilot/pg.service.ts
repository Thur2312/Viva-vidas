import { Injectable, OnModuleDestroy } from '@nestjs/common'
import { Pool } from 'pg'

export interface Db {
  query<T = any>(text: string, params?: any[]): Promise<{ rows: T[]; rowCount: number | null }>
}

/**
 * Acesso direto ao Postgres para o schema `horizon_agent`. O Prisma deste projeto não
 * conhece essas tabelas (elas vivem num schema isolado), então o módulo usa SQL parametrizado.
 */
@Injectable()
export class PgService implements Db, OnModuleDestroy {
  private pool?: Pool

  private get p(): Pool {
    if (!this.pool) {
      const url = process.env.PILOT_DATABASE_URL || process.env.DATABASE_URL
      if (!url) throw new Error('PILOT_DATABASE_URL (ou DATABASE_URL) não configurada')
      this.pool = new Pool({
        connectionString: url,
        max: Number(process.env.PILOT_DB_POOL_MAX ?? 5),
        ssl: /supabase\.(co|com)|sslmode=require/.test(url) ? { rejectUnauthorized: false } : undefined,
      })
    }
    return this.pool
  }

  query<T = any>(text: string, params?: any[]) {
    return this.p.query(text, params) as Promise<{ rows: T[]; rowCount: number | null }>
  }

  async onModuleDestroy() {
    await this.pool?.end()
  }
}
