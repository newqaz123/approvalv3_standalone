# Hybrid Deployment CLI Design

## Purpose

Approval App already has Docker-based install, deploy, backup, restore, rollback, and offline deployment scripts. The current workflow works, but it is split across several shell scripts and is harder to use safely on different environments. The goal is to add one interactive manager that guides users through common operations while preserving existing data during updates from Git, GitHub zip packages, or flash drive/local folders.

## Recommended Approach

Use a hybrid CLI:

- A cross-platform Node CLI provides the interactive menu, prompts, OS detection, validation, path checks, backup discovery, and confirmations.
- Existing shell scripts continue to perform Docker-heavy operations on Linux and other Bash-capable environments.
- Windows support relies on Node for file operations and Docker Desktop for containers. Bash-only behavior should be isolated behind platform checks.

This keeps the current Docker deployment model but gives users a safer, simpler front door.

## User Experience

The main command should be something like:

```bash
npm run manage
```

or:

```bash
node tools/manage.mjs
```

The CLI should show a menu:

```text
Approval App Manager

1. First-time install
2. Update existing installation
3. Backup data
4. Restore from backup
5. Check system health
6. Edit/view environment config
7. Roll back last update
8. Exit
```

The update flow should ask for the source:

```text
Update source:
1. Git pull
2. GitHub zip/package
3. Flash drive / local folder
```

## Data Safety Model

Updates must treat these as user-owned and persistent:

- `.env.production`
- PostgreSQL Docker volume
- uploads Docker volume
- `backups/`
- any local deployment metadata needed for rollback

The CLI must never overwrite `.env.production` silently. Before editing env files it should create `.env.production.backup.<timestamp>`, then add missing keys or prompt for changed values.

Before any update, the CLI should:

1. Detect the current install and deployment mode.
2. Validate Docker and Docker Compose availability.
3. Validate `.env.production` and report missing keys.
4. Create database and uploads backups.
5. Record current version metadata for rollback.
6. Apply the selected update source.
7. Rebuild or load Docker images as needed.
8. Restart services.
9. Run health checks.

If any critical step fails after a backup is created, the CLI should show the backup location and rollback command instead of continuing blindly.

## Script Organization

Keep the existing scripts initially, but converge toward this structure:

```text
tools/manage.mjs              # interactive CLI entrypoint
scripts/lib/common.sh         # shared Docker/Compose helpers
scripts/install.sh            # Linux/Docker first-time setup
scripts/update.sh             # source-aware update runner
scripts/backup.sh             # database + uploads backup
scripts/restore.sh            # selected backup restore
scripts/health-check.sh       # containers + API verification
scripts/rollback.sh           # previous image/package rollback
```

The first implementation does not need to fully rewrite all scripts. It can wrap the existing scripts, then gradually remove duplicate logic.

## Environment Improvements

`.env.example` should become the single complete documented template. It should include every supported variable currently used by the app or scripts, including:

- `DATABASE_URL`
- `NEXTAUTH_URL`
- `NEXTAUTH_SECRET`
- `NEXT_PUBLIC_APP_URL`
- `UPLOAD_DIR`
- `CRON_SECRET`
- `POSTGRES_USER`
- `POSTGRES_PASSWORD`
- `POSTGRES_DB`
- optional SMTP settings
- optional maintenance settings such as `ARCHIVE_AFTER_DAYS`

The manager should include an env doctor that compares `.env.production` against `.env.example`, flags missing required keys, and can generate secure secrets for empty secret fields.

## Update Sources

Git update:

- Require a Git working tree.
- Warn if local source files are modified.
- Run backup first.
- Pull the selected branch.
- Rebuild and restart Docker services.

Zip or flash drive update:

- Accept a local package path.
- Validate that it looks like an Approval App package.
- Preserve `.env.production`, `backups/`, and persistent Docker volumes.
- Copy or extract app files to a staging folder.
- Run the same backup, deploy, and health-check pipeline.

Offline Docker package:

- Reuse the existing image loading behavior from `scripts/deploy-offline.sh`.
- Make package validation stricter before stopping current services.

## Error Handling

The CLI should fail closed for risky operations:

- Do not run destructive Docker volume commands from update flows.
- Require typed confirmation for restore operations.
- Refuse to update if backup fails unless the user explicitly chooses a force option.
- Print exact recovery steps after a failed update.

## Testing

Initial verification should cover:

- CLI menu renders on macOS/Linux and Windows-compatible Node.
- Env doctor detects missing keys and preserves existing values.
- Backup command creates database and uploads artifacts.
- Update flow refuses to proceed when Docker is missing.
- Update flow creates a backup before modifying app files.
- Restore requires explicit confirmation.

## Open Implementation Notes

- The current scripts use both `docker compose` and `docker-compose`; shared helper logic should standardize detection.
- `.env.example` is currently missing keys present in local and production env files.
- The upload volume path differs between compose files and should be reviewed before the backup/restore flow is finalized.
- `setup-vps.sh` writes env content directly and should eventually be replaced or wrapped by the manager.
