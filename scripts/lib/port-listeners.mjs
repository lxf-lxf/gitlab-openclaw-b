import { execSync } from 'node:child_process'

/** 查找监听指定端口的进程 PID（尽力而为，跨平台） */
export function findListeningPids(port) {
  const pids = new Set()

  try {
    if (process.platform === 'win32') {
      const out = execSync(`netstat -ano -p tcp | findstr :${port}`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] })
      for (const line of out.split('\n')) {
        if (!/LISTENING/i.test(line)) continue
        const parts = line.trim().split(/\s+/)
        const pid = Number(parts[parts.length - 1])
        if (Number.isFinite(pid) && pid > 0) pids.add(pid)
      }
      return [...pids]
    }

    if (commandExists('ss')) {
      const out = execSync(`ss -ltnp 'sport = :${port}'`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] })
      for (const m of out.matchAll(/pid=(\d+)/g)) {
        pids.add(Number(m[1]))
      }
    } else if (commandExists('lsof')) {
      const out = execSync(`lsof -ti :${port}`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] })
      for (const line of out.split('\n')) {
        const pid = Number(line.trim())
        if (Number.isFinite(pid) && pid > 0) pids.add(pid)
      }
    }
  } catch { /* ignore */ }

  return [...pids]
}

function commandExists(cmd) {
  try {
    execSync(process.platform === 'win32' ? `where ${cmd}` : `command -v ${cmd}`, { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}
