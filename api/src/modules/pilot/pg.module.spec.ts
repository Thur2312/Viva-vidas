import { Test } from '@nestjs/testing'
import { AuthModule } from '../auth/auth.module'
import { PanelAuthModule } from '../panel-auth/panel-auth.module'
import { VoiceModule } from '../voice/voice.module'
import { PgModule } from './pg.module'
import { PgService } from './pg.service'
import { PilotModule } from './pilot.module'

// Estrutura, nao comportamento: garante que existe UM unico pool de banco na aplicacao.
describe('PgModule (um unico pool)', () => {
  const saved = process.env.SECRETKEY
  beforeAll(() => { process.env.SECRETKEY = 'pg-module-test-secret-' + 'k'.repeat(32) }) // o JwtStrategy exige a chave para existir
  afterAll(() => { if (saved === undefined) delete process.env.SECRETKEY; else process.env.SECRETKEY = saved })

  it('so o PgModule declara PgService; Auth, PanelAuth, Pilot e Voice apenas o importam', async () => {
    const mod = await Test.createTestingModule({ imports: [AuthModule, PanelAuthModule, PilotModule, VoiceModule] }).compile()
    try {
      // O pool so abre na primeira consulta (getter preguicoso), entao compilar o modulo nao conecta a nada.
      const modules: any[] = [...(mod as any).container.getModules().values()]
      const donos = modules.filter((m) => m.providers.has(PgService)).map((m) => m.metatype.name)
      expect(donos).toEqual(['PgModule'])
    } finally {
      await mod.close()
    }
  })

  it('o mesmo objeto PgService serve a todos os modulos', async () => {
    const mod = await Test.createTestingModule({ imports: [AuthModule, PanelAuthModule, PilotModule, VoiceModule] }).compile()
    try {
      const unico = mod.select(PgModule).get(PgService)
      expect(mod.get(PgService, { strict: false })).toBe(unico)
    } finally {
      await mod.close()
    }
  })
})
