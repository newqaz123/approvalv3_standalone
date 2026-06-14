import { spawn } from 'node:child_process'

export function createCommandPlan({ command, args = [], cwd, dryRun = false }) {
  return { command, args, cwd, dryRun }
}

export function runCommand({ command, args = [], cwd, dryRun = false }) {
  const plan = createCommandPlan({ command, args, cwd, dryRun })

  if (dryRun) {
    console.log(`[dry-run] ${plan.command} ${plan.args.join(' ')}`)
    return Promise.resolve({ code: 0, plan })
  }

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    })

    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ code, plan })
      } else {
        reject(new Error(`Command failed with exit code ${code}: ${command} ${args.join(' ')}`))
      }
    })
  })
}
