# Approval System — Production Operations

The canonical beginner-safe deployment command is:

```bash
bash scripts/deploy.sh
```

The script supports an online Ubuntu VPS checkout and an extracted offline intranet package. It validates configuration, preserves persistent data, creates verified backups, handles migrations, checks health, and audits attachment integrity.

Host prerequisites are Docker with Compose v2, Node.js 20 or newer for the environment gate, and `curl` for HTTP health checks. Online mode additionally requires Git; offline mode requires a SHA-256 utility (`sha256sum` or `shasum`).

## Two explicit Compose environments

Local development:

```bash
docker compose -f docker-compose.dev.yml up -d
```

Production inspection:

```bash
docker compose -p approval-app --env-file .env.production -f docker-compose.prod.yml ps
```

Production deployment starts only the database, one-shot migration, and application services:

```bash
docker compose -p approval-app --env-file .env.production -f docker-compose.prod.yml up -d db migrate app
```

Routine updates do not run seed. Seed is available only through the `first-install` profile:

```bash
docker compose -p approval-app --env-file .env.production -f docker-compose.prod.yml --profile first-install run --rm seed
```

Use that command only after confirming a new empty installation.

## Production environment

Create `.env.production` from `.env.example` in a repository checkout or `.env.production.example` in an offline package.

The public URL values must share one exact HTTPS origin:

```text
AUTH_URL=https://approval.example.com
NEXTAUTH_URL=https://approval.example.com
NEXT_PUBLIC_APP_URL=https://approval.example.com
AUTH_TRUST_HOST=true
```

Use a PostgreSQL `DATABASE_URL` with the internal host `db`. Match its user, password, and database to the `POSTGRES_*` values. Keep private attachments at `UPLOAD_DIR=/app/uploads`. Generate strong values for `NEXTAUTH_SECRET` and `CRON_SECRET`.

The environment checker fails before deployment if required values are missing, insecure, malformed, or inconsistent. It never prints secret values.

## Online VPS updates

1. Keep the server checkout on `main`.
2. Ensure `.env.production` is configured.
3. Run `bash scripts/deploy.sh`.
4. Choose **Ubuntu VPS / GitHub update**.

The update is fast-forward-only from `origin/main`. A dirty tracked tree aborts by default. If the operator explicitly requests preservation, deployment creates a uniquely named stash and prints recovery instructions. It never automatically applies or deletes the stash.

The coordinator tags rollback images from the running container image IDs before building. It then captures state, audits attachments, and creates verified database and uploads backups before changing images or services.

## Offline intranet updates

Build the package on an internet-connected development machine:

```bash
bash scripts/build-package.sh <version>
```

After transferring and extracting the archive on the intranet server:

```bash
cp .env.production.example .env.production
# Edit production values.
bash scripts/deploy.sh
```

Choose **Offline intranet package**. The coordinator verifies `SHA256SUMS` before any image load or safety mutation. Offline mode does not invoke Git or network commands.

## Manager

```bash
npm run manage
```

Option `2` delegates an existing-installation update exactly once to `bash scripts/deploy.sh`; select online or offline mode there. Backup, restore, health check, and rollback remain separate manager actions.

## Persistence guarantees

The deployment workflow preserves and verifies:

- `.env.production`;
- the PostgreSQL data volume;
- the private uploads volume;
- `backups/` and its verified artifacts;
- user and upload-file counts; and
- existing attachment gaps while rejecting any newly missing attachment path.

If required volumes are missing or only partially present, deployment fails closed instead of treating the host as a fresh installation.

## Backup and restore

```bash
bash scripts/backup.sh
bash scripts/restore.sh backups/db_<timestamp>.sql backups/uploads_<timestamp>.tar.gz
```

Backup must produce non-empty database and uploads artifacts with checksums. Restore is destructive and prompts before replacing data. If the database container is absent, restore starts only `db` through the explicit production Compose contract.

## Migration-aware rollback

```bash
bash scripts/rollback.sh
```

Rollback always creates a fresh canonical backup before retagging and recreates only `app`. It does not reverse migrations.

When migration state is `applied` or `unknown`—including missing, malformed, or duplicate state—the operator must evaluate old-app/current-schema compatibility and type the exact phrase `ROLLBACK APP ONLY`. The `--yes` option skips only the ordinary confirmation and cannot bypass this gate.

A migration failure is terminal. Do not automatically change app images after an applied or unknown migration.

## Health and diagnostics

```bash
bash scripts/health-check.sh
docker compose -p approval-app --env-file .env.production -f docker-compose.prod.yml ps
docker compose -p approval-app --env-file .env.production -f docker-compose.prod.yml logs -f app
docker compose -p approval-app --env-file .env.production -f docker-compose.prod.yml logs -f migrate
```

If deployment stops, read the first reported failed stage. Preserve the generated backup paths, deployment-state file, rollback tags, and any named dirty-tree stash before troubleshooting.

## Reverse proxy and uploads

Browse the application only at the configured public origin, such as `https://approval.example.com`. `http://localhost:3000` is a host-local health check only; direct IP/container port access is unsupported. `AUTH_TRUST_HOST=true` trusts the host and protocol forwarded by this controlled Nginx proxy, not arbitrary public hosts.

Forward the public host and protocol to port 3000:

```nginx
client_max_body_size 15m;
proxy_set_header Host              $host;
proxy_set_header X-Forwarded-Host  $host;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header X-Real-IP         $remote_addr;
proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
```

Do not serve `/uploads/` directly. Attachments are private files under `/app/uploads` and must flow through authenticated application routes. The application file limit is 10 MB; the 15 MB transport limit allows request overhead without bypassing application validation.

See the package-facing [../DEPLOY.md](../DEPLOY.md) for the full step-by-step operator runbook.
