# Approval App — Deployment Guide

## What's in this package

| File | Purpose |
| ------ | --------- |
| `docker-compose.prod.yml` | All service definitions |
| `images/` | Pre-built Docker images (no internet needed) |
| `deploy-offline.sh` | Full deploy script (load images + start) |
| `rollback.sh` | Revert to previous version |
| `db-backup.sh` | Backup database |
| `health-check.sh` | Check service health |
| `setup.sh` | First-time directory setup |
| `.env.production.example` | Environment variable template |

## Quick Start (first-time deploy)

### 1. Extract package

```bash
cd /opt/approval-app
tar -xzf approval-app-v1.0-*.tar.gz
cd approval-app-v1.0-*/
```

### 2. Configure environment

```bash
cp .env.production.example .env.production
nano .env.production
```

**Required settings — edit these:**

| Variable | Example | Notes |
| ---------- | --------- | ------- |
| `AUTH_URL` | `https://approval.example.com` | Canonical Auth.js v5 origin |
| `NEXTAUTH_URL` | `https://approval.example.com` | Same public origin (backward compatible) |
| `NEXT_PUBLIC_APP_URL` | `https://approval.example.com` | App API base — must match the other two |
| `AUTH_TRUST_HOST` | `true` | Trust host/protocol forwarded by Nginx |
| `NEXTAUTH_SECRET` | (run `openssl rand -base64 32`) | Random secret |
| `DATABASE_URL` | `postgresql://postgres:StrongPass@db:5432/app_db` | Must use `@db:5432` |
| `POSTGRES_PASSWORD` | `StrongPass` | **Must match DATABASE_URL password** |
| `CRON_SECRET` | any random text | For cron endpoint |

### 3. Load images and start

```bash
docker load -i images/postgres.tar
docker load -i images/approval-migrate.tar
docker load -i images/approval-app.tar
docker compose --env-file .env.production -f docker-compose.prod.yml up -d
```

### 4. Verify

```bash
docker compose -f docker-compose.prod.yml ps
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000
```

`http://localhost:3000` is a host-local health check only — it confirms the
container is up on the server itself and is not the Auth.js public origin.

### 5. Login

- URL: the configured public HTTPS origin (e.g. `https://approval.example.com`)
- Email: `admin@example.com`
- Password: `changeme`
- **Change the password immediately after first login**

Once the DNS proxy contract is enabled, browse the app through the public
HTTPS origin only — direct IP/container port access is unsupported.

---

## Common Commands

All commands must be run from the package directory:

```bash
cd /opt/approval-app/approval-app-v1.0-*/
```

**Start / Stop / Restart:**

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml up -d     # start
docker compose --env-file .env.production -f docker-compose.prod.yml down       # stop
docker compose --env-file .env.production -f docker-compose.prod.yml restart    # restart
```

**View logs:**

```bash
docker compose -f docker-compose.prod.yml logs -f               # all services
docker compose -f docker-compose.prod.yml logs -f app            # app only
docker compose -f docker-compose.prod.yml logs -f db             # database only
```

**Check status:**

```bash
docker compose -f docker-compose.prod.yml ps
```

**Open Prisma Studio (database browser):**

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml --profile tools up -d studio
# Access at http://your-server-ip:5555 (host-local admin tool — not the app origin)
# To stop: docker compose -f docker-compose.prod.yml --profile tools stop studio
```

**Backup database:**

```bash
bash db-backup.sh
```

**Rollback to previous version:**

```bash
bash rollback.sh
```

---

## Update to new version

1. Transfer new package to server:

    ```bash
    scp deploy/approval-app-*.tar.gz root@server:/opt/approval-app/
    ```

2. On server:

    ```bash
    cd /opt/approval-app
    tar -xzf approval-app-v1.0-NEWDATE.tar.gz
    cd approval-app-v1.0-NEWDATE/

    # Copy config from previous deploy
    cp /opt/approval-app/approval-app-v1.0-OLDDATE/.env.production .

    # Load new images and deploy
    docker load -i images/approval-app.tar
    docker load -i images/approval-migrate.tar
    docker compose --env-file .env.production -f docker-compose.prod.yml up -d
    ```

Database and uploads are preserved in Docker volumes — they persist across updates.

---

## Architecture

```
                    ┌─────────────────┐
                    │   Your Browser   │
                    └────────┬────────┘
                             │ :3000
                    ┌────────▼────────┐
                    │  approval-app    │  ← Next.js production
                    │  (port 3000)     │
                    └────────┬────────┘
                             │ internal
                    ┌────────▼────────┐
                    │  approval-db     │  ← PostgreSQL 15
                    │  (port 5432)     │
                    └─────────────────┘
```

Optional services (start with `--profile tools`):

- `approval-studio` — Prisma Studio DB browser on port 5555

---

## Reverse Proxy (Production Nginx)

Put Nginx (or another reverse proxy) in front of the container on production
domains and forward traffic to the host port the app publishes (3000).

```nginx
server {
    listen 80;
    server_name approval.example.com;

    # Server Action transport limit. The app itself rejects attachments over
    # 10 MB (see below); 15 MB here keeps the transport from clipping a valid
    # upload before the app's own validation runs.
    client_max_body_size 15m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Forwarded-Host  $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade           $http_upgrade;
        proxy_set_header Connection        "upgrade";
    }

    # Attachments now live in the private /app/uploads volume and are streamed
    # only by the authenticated app route. Direct serving from /uploads/ is
    # obsolete — deny it so files are never exposed without authorization.
    location /uploads/ {
        deny all;
        return 404;
    }
}
```

**Upload limits — 10 MB app / 15 MB transport:** The application rejects any
attachment larger than **10 MB** (its own policy). The Next.js Server Action
transport and this reverse proxy both allow up to **15 MB**, so the
application's validation — not the network layer — is the gatekeeper that
rejects oversized uploads.

**Auth.js origin and logout:** The app runs behind this reverse proxy, so the
three Auth.js environment variables must all point at the public HTTPS origin
that browsers use — `AUTH_URL`, `NEXTAUTH_URL`, and `NEXT_PUBLIC_APP_URL`
(e.g. `https://approval.example.com`). All three must match each other
exactly; a mismatch between the Auth.js callback base and the app API base
causes cookie/session mismatches and wrong redirects.

`AUTH_TRUST_HOST=true` permits Auth.js to trust the `Host` /
`X-Forwarded-Host` and `X-Forwarded-Proto` headers forwarded by this
controlled Nginx proxy. Without it, Auth.js derives its base URL from the
internal container host and redirects (including sign out) to
`http://localhost:3000` instead of the public domain.

Sign out uses the relative `/sign-in` callback, so the browser stays on the
public origin it is already talking to — no absolute URL is baked into the
client. If sign out lands on `localhost` or a wrong host, verify the three
URL variables match the public HTTPS origin, confirm the forwarded headers
above are present, and restart the app container.
