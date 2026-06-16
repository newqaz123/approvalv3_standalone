import path from 'node:path'
import { fileURLToPath } from 'node:url'

export function getProjectRoot() {
  const currentFile = fileURLToPath(import.meta.url)
  return path.resolve(path.dirname(currentFile), '..', '..')
}

export function resolveManagerPaths(root = getProjectRoot()) {
  const backups = path.join(root, 'backups')

  return {
    root,
    envExample: path.join(root, '.env.example'),
    envProduction: path.join(root, '.env.production'),
    backups,
    backupsDir: backups,
    scripts: {
      backup: path.join(root, 'scripts', 'backup.sh'),
      restore: path.join(root, 'scripts', 'restore.sh'),
      deploy: path.join(root, 'scripts', 'deploy.sh'),
      offlineDeploy: path.join(root, 'scripts', 'deploy-offline.sh'),
      health: path.join(root, 'scripts', 'health-check.sh'),
      rollback: path.join(root, 'scripts', 'rollback.sh'),
    },
  }
}

export function isWindows() {
  return process.platform === 'win32'
}
