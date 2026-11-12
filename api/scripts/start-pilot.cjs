// Sobe a API em modo "so piloto" (sem Redis/RabbitMQ). Multiplataforma, sem cross-env.
// Uso: npm run start:pilot [-- --watch]
const { spawn } = require('child_process')
const path = require('path')

const nestBin = require.resolve('@nestjs/cli/bin/nest.js')
const args = [nestBin, 'start', ...process.argv.slice(2)]
const child = spawn(process.execPath, args, {
  stdio: 'inherit',
  cwd: path.resolve(__dirname, '..'),
  env: { ...process.env, PILOT_ONLY: 'true' },
})
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)))
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig))
