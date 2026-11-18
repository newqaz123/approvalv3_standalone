# Approval App — Safe Deployment Runbook

This runbook is included in both the Git repository and offline deployment packages. Production deployment has one entry point. From a trusted checkout or extracted package, run it as an authorized deployment administrator with effective UID 0 and a trusted administrator `PATH`:

```bash
bash scripts/deploy.sh
```

Choose **Ubuntu VPS / GitHub update** or **Offline intranet package** when prompted. If you are converting an existing departments database to the organization model, follow the [legacy upgrade runbook](docs/upgrade-runbook.md) before running the coordinator.

## Safety rules

- Keep `.env.production`, the PostgreSQL volume, the uploads volume, and `backups/`.
- Routine updates start only `db migrate app`; they never run seed.
- Never improvise destructive database or volume cleanup commands on a production host.
- Migration rollback is forward-only: app rollback does not reverse database migrations.
- If migration state is `applied` or `unknown`, rollback requires an explicit compatibility decision and the exact phrase `ROLLBACK APP ONLY`.
- The three public URL variables must be the same HTTPS origin.

## Production Compose contract

Every manual production inspection uses the same project, environment file, and Compose file:

```bash
docker compose -p approval-app --env-file .env.production -f docker-compose.prod.yml ps
docker compose -p approval-app --env-file .env.production -f docker-compose.prod.yml logs -f app
```

The deployment coordinator uses:

```bash
docker compose -p approval-app --env-file .env.production -f docker-compose.prod.yml up -d db migrate app
```

Do not add `seed` to a routine update.

## Configure `.env.production`

Preserve an existing `.env.production`. When configuring a new deployment, use the matching template.

For a repository checkout:

```bash
cp .env.example .env.production
```

For an offline package:

```bash
cp .env.production.example .env.production
```

Set strong production values. These variables must all use one identical HTTPS origin, without a trailing path:

```text
AUTH_URL=https://approval.example.com
NEXTAUTH_URL=https://approval.example.com
NEXT_PUBLIC_APP_URL=https://approval.example.com
AUTH_TRUST_HOST=true
```

`DATABASE_URL` must use PostgreSQL and the internal `db` host. Its credentials and database name must match `POSTGRES_USER`, `POSTGRES_PASSWORD`, and `POSTGRES_DB`. Set `POSTGRES_DB` to a literal database name: it cannot contain `=` or begin with `postgresql://` or `postgres://`. Keep `UPLOAD_DIR=/app/uploads`.

The deploy script runs the production environment gate before it mutates images or services. It reports field names only and never prints secret values.

`SMTP_*` values are an optional fallback until an admin first saves **Admin → Email notifications**. After admin settings exist, they remain authoritative, and provider changes apply to the next outgoing email without restarting the app process or containers.

## Online Ubuntu VPS update

Requirements:

- Run as an authorized administrator (effective UID 0) from the trusted application checkout on branch `main`.
- Docker and Docker Compose v2 are installed.
- Node.js 20 or newer is installed for the production environment gate.
- `curl` is installed for the HTTP health check.
- The root deployment session can read and update the checkout and authenticate to `origin`.
- `.env.production` is already configured.

Run:

```bash
cd /opt/approval-app
bash scripts/deploy.sh
```

Choose **Ubuntu VPS / GitHub update**. If local policy requires `sudo` instead of an authorized root shell, `sudo bash scripts/deploy.sh --online` is equivalent only from a trusted checkout, with a trusted administrator `PATH` and working Git access under the elevated account. If Git refuses the checkout due to ownership, have the administrator verify the owner and, if needed, trust only this checkout's exact absolute path via Git `safe.directory` in protected configuration. Never use a wildcard or disable the ownership check globally.

The workflow permits only a fast-forward update from `origin/main`. If tracked source changes are present, the default is to abort. If you explicitly choose to preserve them, the script creates a named stash and prints its exact name. It never restores or deletes that stash automatically.

Before image mutation, the coordinator:

1. inspects the currently running app and migration image IDs;
2. tags those immutable IDs as rollback images;
3. captures database, volume, file, and attachment state;
4. creates non-empty PostgreSQL and uploads backups; and
5. verifies backup paths and SHA-256 checksums.

It then builds the new images, starts `db migrate app`, waits for the one-shot migration result, checks container and HTTP health, and verifies that users, volumes, upload files, and attachment integrity were preserved.

## Offline intranet update

On an internet-connected build machine:

```bash
bash scripts/build-package.sh <version>
```

Transfer the archive from a trusted release source via approved offline media. On the intranet server, run the coordinator from the extracted package as an authorized administrator (effective UID 0) with a trusted administrator `PATH`:

```bash
tar -xzf approval-app-<version>-<date>.tar.gz
cd approval-app-<version>-<date>
# Provision the existing production configuration securely for an update.
# Use .env.production.example only when creating a new configuration.
bash scripts/deploy.sh --offline .
```

Always use the archive's own coordinator, not a copy from another release.

The package contains:

- `images/` with app, migration, and PostgreSQL image archives;
- `scripts/` and `scripts/lib/` with the unified coordinator and safety library;
- `tools/` with the environment gate;
- `docker-compose.prod.yml`;
- `VERSION` and `SHA256SUMS`;
- `docs/upgrade-runbook.md` and `scripts/upgrade/{precheck,postcheck}.sql`; and
- this operator guide.

Offline mode requires the legacy artifacts and their manifest entries, then verifies `SHA256SUMS` before any image load, backup, or service mutation. Checksums detect corruption, not package provenance. Offline mode needs no Git or external network access.

## First installation only

The production seed service is disabled during normal deployment. After the first deployment is healthy, and only when you have confirmed this is a new empty installation, run:

```bash
docker compose -p approval-app --env-file .env.production -f docker-compose.prod.yml --profile first-install run --rm seed
```

Do not repeat this during updates.

## Manager workflow

The interactive manager remains available in a repository checkout. For a production update, start it in the same authorized root deployment session:

```bash
npm run manage
```

Option `2` delegates an existing-installation update exactly once to `bash scripts/deploy.sh` in the manager's checkout, without elevating privileges. Choose online there; for an extracted archive, start its own coordinator directly. The manager's backup, restore, health, and rollback options are separate actions.

## Backup and restore

Create a database and uploads backup:

```bash
bash scripts/backup.sh
```

The script writes artifacts under `backups/`, verifies that both are non-empty, calculates SHA-256 checksums, and reports their paths. Copy important backups to separate protected storage.

Restore is destructive and requires an explicit confirmation:

```bash
bash scripts/restore.sh backups/db_<timestamp>.sql backups/uploads_<timestamp>.tar.gz
```

When the database container is absent, restore starts only the production `db` service. It does not seed data.

## App-only rollback

Rollback requires a previously tagged rollback image:

```bash
bash scripts/rollback.sh
```

`--yes` may skip only the ordinary proceed prompt. It cannot bypass migration compatibility acknowledgement. Rollback first creates a fresh canonical database/uploads backup, retags the previous app image, and recreates only `app`.

Because database migrations are not reversed, inspect the migration state and schema compatibility first. For `applied`, missing, malformed, duplicate, or otherwise unknown state, type `ROLLBACK APP ONLY` only after confirming that the old app is compatible with the current schema. For an incompatible upgrade, use the coordinated recovery procedure in the [legacy upgrade runbook](docs/upgrade-runbook.md#recovery-and-rollback) instead.

## Health, logs, and status

```bash
bash scripts/health-check.sh
docker compose -p approval-app --env-file .env.production -f docker-compose.prod.yml ps
docker compose -p approval-app --env-file .env.production -f docker-compose.prod.yml logs -f app
docker compose -p approval-app --env-file .env.production -f docker-compose.prod.yml logs -f migrate
```

A failed migration is terminal. Do not automatically roll the app image back after an applied or unknown migration; diagnose the migration output and make an explicit compatibility decision.

## Reverse proxy

Browse the application only at the configured public origin, such as `https://approval.example.com`. `http://localhost:3000` is a host-local health check only; direct IP/container port access is unsupported. `AUTH_TRUST_HOST=true` trusts the host and protocol forwarded by this controlled Nginx proxy, not arbitrary public hosts.

Expose the app through one public HTTPS origin and forward these headers:

```nginx
client_max_body_size 15m;

location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host              $host;
    proxy_set_header X-Forwarded-Host  $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
}

location /uploads/ {
    deny all;
    return 404;
}
```

Attachments live in the private `/app/uploads` volume and are served only through authorized application routes. The app accepts files up to 10 MB; the 15 MB proxy and Server Action limits leave room for request framing while preserving application validation.

## Local development

Local Docker development is separate from production:

```bash
docker compose -f docker-compose.dev.yml up -d
```

Use `.env.local` and `http://localhost:3000` for local development. Do not use the production deployment coordinator against local development services.
