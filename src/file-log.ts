import { appendFile, mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export interface FileLogger {
  readonly path: string
  info(message: string): void
  warn(message: string): void
  error(message: string): void
}

function logPath(): string {
  const dshHome = process.env.DSH_HOME?.trim() || join(homedir(), '.dsh')
  return join(dshHome, 'gtrace-hooks.log')
}

/** Best-effort file logger; diagnostics must never block or fail the Agent. */
export function createFileLogger(): FileLogger {
  const path = logPath()
  let pending: Promise<void> = Promise.resolve()

  function write(level: string, message: string): void {
    const line = `${new Date().toISOString()} ${level} ${message}\n`
    pending = pending.then(async () => {
      try {
        await mkdir(dirname(path), { recursive: true })
        await appendFile(path, line, 'utf8')
      } catch {
        // Logging is strictly best-effort and must not affect the Agent.
      }
    })
  }

  return {
    path,
    info: message => write('INFO', message),
    warn: message => write('WARN', message),
    error: message => write('ERROR', message),
  }
}
