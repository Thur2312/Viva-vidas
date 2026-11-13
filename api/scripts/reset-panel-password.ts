/**
 * Redefine a senha de um usuario do painel (so quem administra o servidor roda isto).
 *
 *   npm run panel:reset-password -- --email a@b.com
 *
 * O que faz, tudo na MESMA transacao:
 *  1. grava o hash da senha nova (scrypt);
 *  2. zera as tentativas falhas e libera a conta bloqueada;
 *  3. revoga TODOS os refresh tokens do usuario e aumenta `token_version`: os access tokens (JWT) ja emitidos
 *     deixam de valer. A API confere a versao a cada requisicao, com cache de PANEL_SESSION_CACHE_MS (padrao 5 s),
 *     entao quem tinha a senha antiga sai em poucos segundos (exige a migration 009);
 *  4. registra o fato na trilha de auditoria (sem a senha), com o usuario do sistema que rodou o script.
 *
 * Senha: variavel de ambiente PANEL_USER_PASSWORD ou prompt oculto. Nunca por argumento (apareceria no historico).
 * Entregue a senha nova ao usuario por um canal seguro, nao por e-mail ou mensagem aberta.
 * Conexao: PILOT_DATABASE_URL ou DATABASE_URL.
 */
import 'dotenv/config'
import { userInfo } from 'os'
import { Client } from 'pg'
import { hashPassword, passwordProblems } from '../src/modules/panel-auth/password.util'
import { pgSsl } from '../src/modules/pilot/pg.service'
import { arg, promptHidden } from './cli-util'

async function main() {
  const email = (arg('email') ?? '').trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new Error('--email invalido')

  // Pelo prompt, pede duas vezes: um erro de digitacao deixaria o usuario trancado para fora.
  let password = process.env.PANEL_USER_PASSWORD
  if (!password) {
    password = await promptHidden('Senha nova (oculta): ')
    if ((await promptHidden('Repita a senha: ')) !== password) throw new Error('As senhas nao conferem (nada foi alterado).')
  }
  const problems = passwordProblems(password, email)
  if (problems.length) throw new Error(`Senha recusada: ${problems.join('; ')}`)

  const url = process.env.PILOT_DATABASE_URL || process.env.DATABASE_URL
  if (!url) throw new Error('PILOT_DATABASE_URL (ou DATABASE_URL) nao configurada')
  const client = new Client({ connectionString: url, ssl: pgSsl(url) })
  await client.connect()
  try {
    const hash = await hashPassword(password)
    await client.query('BEGIN')
    const u = await client.query(
      `UPDATE horizon_agent.panel_users
          SET password_hash = $2, failed_attempts = 0, locked_until = NULL, token_version = token_version + 1
        WHERE lower(email) = $1
        RETURNING id`,
      [email, hash],
    )
    if (!u.rows[0]) throw new Error('Nenhum usuario com esse e-mail (nada foi alterado).')
    const id = u.rows[0].id as string
    const s = await client.query(`UPDATE horizon_agent.panel_refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [id])
    await client.query(
      `INSERT INTO horizon_agent.audit_log (actor, action, entity, entity_id, details) VALUES ($1, 'panel.password_reset', 'panel_user', $2, $3::jsonb)`,
      [`cli:${userInfo().username}`.slice(0, 120), id, JSON.stringify({ sessionsRevoked: s.rowCount ?? 0 })],
    )
    await client.query('COMMIT')
    console.log(`Senha redefinida: ${email} (id=${id}). Sessoes revogadas: ${s.rowCount ?? 0}. Conta liberada.`)
    console.log('Sessoes abertas caem em poucos segundos (cache da API, PANEL_SESSION_CACHE_MS).')
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw e
  } finally {
    await client.end()
  }
}

main().catch((e) => {
  console.error(`Erro: ${e.message}`)
  process.exit(1)
})
