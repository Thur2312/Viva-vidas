/**
 * Cria (ou NAO sobrescreve) um usuario do painel.
 *
 *   npm run panel:create-user -- --email a@b.com --name "Fulano" --role owner [--tenant alberto]
 *
 * Senha: variavel de ambiente PANEL_USER_PASSWORD ou prompt oculto no terminal. Nunca por argumento
 * (apareceria no historico/ps) e nunca com valor padrao. Conexao: PILOT_DATABASE_URL ou DATABASE_URL.
 * Tenant: --tenant, ou PILOT_TENANT, ou 'alberto' (mesmo default do PilotService).
 */
import 'dotenv/config'
import { Client } from 'pg'
import { hashPassword, passwordProblems } from '../src/modules/panel-auth/password.util'
import { PANEL_ROLES } from '../src/modules/panel-auth/panel-roles'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

function promptHidden(question: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin
    if (!stdin.isTTY) return reject(new Error('Sem TTY: defina PANEL_USER_PASSWORD no ambiente.'))
    process.stdout.write(question)
    let value = ''
    stdin.setRawMode(true)
    stdin.resume()
    stdin.setEncoding('utf8')
    const onData = (ch: string) => {
      for (const c of ch) {
        if (c === '\r' || c === '\n' || c === '\u0004') {
          stdin.setRawMode(false)
          stdin.pause()
          stdin.off('data', onData)
          process.stdout.write('\n')
          return resolve(value)
        }
        if (c === '\u0003') process.exit(130)
        if (c === '\u007f' || c === '\b') value = value.slice(0, -1)
        else value += c
      }
    }
    stdin.on('data', onData)
  })
}

async function main() {
  const email = (arg('email') ?? '').trim().toLowerCase()
  const name = (arg('name') ?? '').trim()
  const role = arg('role') ?? ''
  const tenant = (arg('tenant') ?? process.env.PILOT_TENANT ?? 'alberto').trim()

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new Error('--email invalido')
  if (!name || name.length > 120) throw new Error('--name obrigatorio (ate 120 caracteres)')
  if (!(PANEL_ROLES as readonly string[]).includes(role)) throw new Error(`--role deve ser um de: ${PANEL_ROLES.join(', ')}`)

  const password = process.env.PANEL_USER_PASSWORD || (await promptHidden('Senha (oculta): '))
  const problems = passwordProblems(password, email)
  if (problems.length) throw new Error(`Senha recusada: ${problems.join('; ')}`)

  const url = process.env.PILOT_DATABASE_URL || process.env.DATABASE_URL
  if (!url) throw new Error('PILOT_DATABASE_URL (ou DATABASE_URL) nao configurada')
  const client = new Client({
    connectionString: url,
    ssl: /supabase\.(co|com)|sslmode=require/.test(url) ? { rejectUnauthorized: false } : undefined,
  })
  await client.connect()
  try {
    const hash = await hashPassword(password)
    const r = await client.query(
      `INSERT INTO horizon_agent.panel_users (tenant, email, name, role, password_hash)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING RETURNING id`,
      [tenant, email, name, role, hash],
    )
    if (!r.rows[0]) throw new Error('Ja existe usuario com esse e-mail (nada foi alterado).')
    console.log(`Usuario criado: ${email} (${role}, tenant ${tenant}) id=${r.rows[0].id}`)
  } finally {
    await client.end()
  }
}

main().catch((e) => {
  console.error(`Erro: ${e.message}`)
  process.exit(1)
})
