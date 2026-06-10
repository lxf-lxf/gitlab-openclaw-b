#!/usr/bin/env node
const sub = process.argv[2]
const extraArgs = new Set(process.argv.slice(3))

if (sub === 'init' || sub === '--init') {
  const { runInitCli } = await import('./init-env.mjs')
  await runInitCli()
  process.exit(0)
}

if (sub === 'setup' || sub === 'configure') {
  const { runSetupWizard } = await import('./setup-wizard.mjs')
  await runSetupWizard({ force: extraArgs.has('--force') })
  process.exit(0)
}

const SERVICE_CMDS = new Set(['start', 'stop', 'restart', 'status', 'fg', 'foreground', 'help', '-h', '--help'])

if (sub && SERVICE_CMDS.has(sub)) {
  const { runServiceCli } = await import('./service-cli.mjs')
  await runServiceCli(sub)
  process.exit(process.exitCode ?? 0)
}

if (sub === 'run' || !sub) {
  const { runServer } = await import('./service-cli.mjs')
  await runServer()
} else {
  console.error(`未知参数: ${sub}`)
  const { runServiceCli } = await import('./service-cli.mjs')
  await runServiceCli('help')
  process.exit(1)
}
