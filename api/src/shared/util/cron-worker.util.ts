// Fonte única: cluster.config.js → ecosystem.config.js injeta CRON_WORKERS no env dos workers PM2.
// Default 3 p/ dev/testes (sem PM2): aí NODE_APP_INSTANCE é undefined e shouldRunCron já retorna
// true p/ todos, então o valor é inócuo fora do cluster. Mudar o nº de instâncias só em cluster.config.js.
const CRON_WORKERS = Number(process.env.CRON_WORKERS) || 3

function hashCronName(name: string): number {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) - hash) + name.charCodeAt(i)
    hash |= 0
  }
  return Math.abs(hash)
}

/**
 * Retorna true se o worker atual deve executar este cron.
 * Distribui deterministicamente entre os primeiros CRON_WORKERS workers.
 * Em dev (sem NODE_APP_INSTANCE), retorna true para todos.
 */
export function shouldRunCron(cronName: string): boolean {
  const instance = process.env.NODE_APP_INSTANCE
  if (instance === undefined) return true
  const workerId = parseInt(instance, 10)
  if (workerId >= CRON_WORKERS) return false
  return hashCronName(cronName) % CRON_WORKERS === workerId
}
