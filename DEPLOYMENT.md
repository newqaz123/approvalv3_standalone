# Approval App — VPS Deployment Entry Point

This file is retained for operators who bookmarked the older VPS guide. Production is Docker Compose only and uses the unified safe deployment workflow. Run the coordinator from a trusted checkout or extracted package as an authorized deployment administrator (effective UID 0) with a trusted administrator `PATH`. See [DEPLOY.md](DEPLOY.md#online-ubuntu-vps-update) for Git access and checkout-trust requirements when elevating privileges.

If the existing database still uses departments, follow the [legacy upgrade runbook](docs/upgrade-runbook.md) before deploying.

## Ubuntu VPS

1. Install Docker with Compose v2, Git, Node.js 20 or newer, and `curl`.
2. Use a trusted checkout on `main` that the root deployment session can update from `origin`.
3. Keep the existing `.env.production`, or create one from `.env.example` for a new deployment.
4. Set strong secrets, PostgreSQL credentials, `UPLOAD_DIR=/app/uploads`, and one shared HTTPS origin for `AUTH_URL`, `NEXTAUTH_URL`, and `NEXT_PUBLIC_APP_URL`.
5. Run:

```bash
bash scripts/deploy.sh
```

Choose **Ubuntu VPS / GitHub update**. The update is fast-forward-only from `origin/main`, preserves a dirty tracked tree only through an explicitly named stash, creates verified database and uploads backups, applies migrations, checks health, and verifies persistent data.

## Offline intranet server

Extract the approved package and provision `.env.production` securely, preserving the existing production configuration for an update. From that package directory, use its own coordinator as the authorized root administrator:

```bash
bash scripts/deploy.sh --offline .
```

Checksums are verified before image loading and detect corruption, not package provenance. Offline mode requires no Git or external network access.

## Explicit Compose files

Development only:

```bash
docker compose -f docker-compose.dev.yml up -d
```

Production deployment contract:

```bash
docker compose -p approval-app --env-file .env.production -f docker-compose.prod.yml up -d db migrate app
```

Routine updates never run seed. On a confirmed new empty installation only:

```bash
docker compose -p approval-app --env-file .env.production -f docker-compose.prod.yml --profile first-install run --rm seed
```

## Persistence and rollback

Keep `.env.production`, the PostgreSQL data volume, the private uploads volume, and `backups/`. Rollback changes only the app image and does not reverse database migrations. Applied or unknown migration state requires an explicit compatibility decision and the exact phrase `ROLLBACK APP ONLY`.

Use `https://approval.example.com` as the model public origin. `http://localhost:3000` is a host-local health check only; direct IP/container port access is unsupported. `AUTH_TRUST_HOST=true` trusts only headers from the controlled Nginx proxy.

For backup, restore, rollback, health checks, reverse-proxy configuration, and troubleshooting, follow [DEPLOY.md](DEPLOY.md).
