import { randomBytes } from 'crypto'
import { SecretsService, SECRET_DEFS } from './secrets.service'
import { PlaybookService, PLAYBOOK_TEMPLATE } from './playbook.service'

const ctx = { actor: 'u1' }

function fakePg() {
  const secrets = new Map<string, any>()
  return {
    secrets,
    query: async (sql: string, p: any[] = []) => {
      if (/INSERT INTO horizon_agent.integration_secrets/.test(sql)) {
        secrets.set(p[1], { name: p[1], ciphertext: p[2], last4: p[3], updated_at: new Date() })
        return { rows: [], rowCount: 1 }
      }
      if (/DELETE FROM horizon_agent.integration_secrets/.test(sql)) {
        secrets.delete(p[1])
        return { rows: [], rowCount: 1 }
      }
      if (/FROM horizon_agent.integration_secrets/.test(sql)) return { rows: [...secrets.values()], rowCount: secrets.size }
      return { rows: [], rowCount: 0 }
    },
  } as any
}

describe('SecretsService', () => {
  const OLD = { ...process.env }
  beforeEach(() => {
    process.env.PILOT_DATA_KEY = randomBytes(32).toString('base64')
    delete process.env.ANTHROPIC_API_KEY
  })
  afterEach(() => { process.env = { ...OLD } })

  it('cadastra, cifra no banco, aplica no ambiente e nunca devolve o valor', async () => {
    const pg = fakePg()
    const svc = new SecretsService(pg)
    const out = await svc.set('ANTHROPIC_API_KEY', 'sk-ant-segredo-1234', ctx)
    expect(process.env.ANTHROPIC_API_KEY).toBe('sk-ant-segredo-1234')
    expect(pg.secrets.get('ANTHROPIC_API_KEY').ciphertext).toMatch(/^enc:v1:/)
    const row = out.find((s) => s.name === 'ANTHROPIC_API_KEY')!
    expect(row).toMatchObject({ configured: true, source: 'painel', last4: '1234' })
    expect(JSON.stringify(out)).not.toContain('segredo')
  })

  it('remover restaura o valor do ambiente original', async () => {
    process.env.ANTHROPIC_API_KEY = 'env-original-9999'
    const svc = new SecretsService(fakePg())
    await svc.set('ANTHROPIC_API_KEY', 'sk-painel-0000', ctx)
    expect(process.env.ANTHROPIC_API_KEY).toBe('sk-painel-0000')
    const out = await svc.remove('ANTHROPIC_API_KEY', ctx)
    expect(process.env.ANTHROPIC_API_KEY).toBe('env-original-9999')
    expect(out.find((s) => s.name === 'ANTHROPIC_API_KEY')).toMatchObject({ configured: true, source: 'ambiente' })
  })

  it('hydrate aplica chaves guardadas após reinício', async () => {
    const pg = fakePg()
    await new SecretsService(pg).set('ELEVENLABS_API_KEY', 'xi-chave-5678', ctx)
    delete process.env.ELEVENLABS_API_KEY
    await new SecretsService(pg).hydrate()
    expect(process.env.ELEVENLABS_API_KEY).toBe('xi-chave-5678')
  })

  it('recusa nome fora da lista e valor inválido', async () => {
    const svc = new SecretsService(fakePg())
    await expect(svc.set('DATABASE_URL', 'postgres://x:y@h/db', ctx)).rejects.toThrow('desconhecida')
    await expect(svc.set('PILOT_DATA_KEY', 'aaaaaaaa', ctx)).rejects.toThrow('desconhecida')
    await expect(svc.set('ANTHROPIC_API_KEY', 'com espaço', ctx)).rejects.toThrow('inválido')
    expect(SECRET_DEFS.map((d) => d.name)).not.toContain('SECRETKEY')
  })
})

