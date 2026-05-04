# Approval App — Deployment Guide

## What's in this package

| File | Purpose |
|------|---------|
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
|----------|---------|-------|
| `NEXTAUTH_URL` | `http://192.168.1.100:3000` | Your server URL |
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

### 5. Login
- URL: `http://your-server-ip:3000`
- Email: `admin@example.com`
- Password: `changeme`
- **Change the password immediately after first login**

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
# Access at http://your-server-ip:5555
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
