/** Ajudantes dos scripts de administração (criar usuário, redefinir senha). */

export function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

/** Pede um valor sem ecoar no terminal. Sem TTY (ex.: CI) falha: nesse caso use a variável de ambiente. */
export function promptHidden(question: string, envHint = 'PANEL_USER_PASSWORD'): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin
    if (!stdin.isTTY) return reject(new Error(`Sem TTY: defina ${envHint} no ambiente.`))
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
