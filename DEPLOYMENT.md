# Approval App — VPS Deployment Entry Point

This file is retained for operators who bookmarked the older VPS guide. Production is Docker Compose only and now uses the unified safe deployment workflow.

## Ubuntu VPS

1. Install Docker with Compose v2 and Git.
2. Clone the repository and keep the production checkout on `main`.
3. Create `.env.production` from `.env.example`.
4. Set strong secrets, PostgreSQL credentials, `UPLOAD_DIR=/app/uploads`, and one shared HTTPS origin for `AUTH_URL`, `NEXTAUTH_URL`, and `NEXT_PUBLIC_APP_URL`.
5. Run:

```bash
bash scripts/deploy.sh
```

Choose **Ubuntu VPS / GitHub update**. The update is fast-forward-only from `origin/main`, preserves a dirty tracked tree only through an explicitly named stash, creates verified database and uploads backups, applies migrations, checks health, and verifies persistent data.

## Offline intranet server

Extract the approved package, copy `.env.production.example` to `.env.production`, set production values, then run:

```bash
bash scripts/deploy.sh
```

Choose **Offline intranet package**. Checksums are verified before image loading, and offline mode does not use Git or the network.

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
