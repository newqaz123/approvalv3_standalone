# Approval System - Deployment Guide

**Target Audience:** System administrators and developers deploying on Hostinger VPS or VMware/Linux VMs
**Architecture:** Docker Compose with multi-stage Dockerfile
**One-command deployment:** `./scripts/deploy.sh`

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Initial Setup](#initial-setup)
3. [Deployment](#deployment)
4. [Updates](#updates)
5. [Backups](#backups)
6. [Monitoring & Health Checks](#monitoring--health-checks)
7. [Troubleshooting](#troubleshooting)

---

## Prerequisites

### System Requirements

- **Operating System:** Linux (Ubuntu 20.04+, Debian 11+, or Alpine 3.15+)
- **RAM:** Minimum 2GB, Recommended 4GB
- **Storage:** Minimum 20GB (database + uploads grow over time)
- **CPU:** 2 cores minimum

### Required Software

| Tool | Minimum Version | How to Install |
|-------|-----------------|-----------------|
| Docker | 20.10+ | `curl -fsSL https://get.docker.com -o get-docker.sh && sh get-docker.sh` |
| Docker Compose | v2 | Included with Docker v20.10+ or install separately |
| Git | 2.x | `sudo apt install git` (Ubuntu) or `sudo yum install git` (CentOS) |

### Verify Installation

```bash
# Check Docker
docker --version
# Should output: Docker version 24.x.x or higher

# Check Docker Compose
docker compose version
# Should output: Docker Compose version v2.x.x
```

---

## Initial Setup

### Step 1: Clone Repository

Clone the repository to your server:

```bash
git clone https://github.com/your-org/approval-app-v2.git
cd approval-app-v2
```

### Step 2: Run Setup Script

The setup script initializes the environment:

```bash
chmod +x scripts/setup.sh
./scripts/setup.sh
```

**What setup.sh does:**
- Creates `.env.production` from `.env.production.example` template
- Creates `uploads/` directory for file uploads
- Creates `backups/` directory for backup storage
- Sets proper permissions on `uploads/` directory
- Makes all scripts executable

### Step 3: Configure Environment Variables

Edit `.env.production` with your actual values:

```bash
nano .env.production
```

**Required variables:**

| Variable | Description | Where to Get |
|----------|-------------|---------------|
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk public key for frontend auth | [Clerk Dashboard → Apps → API Keys](https://dashboard.clerk.com) |
| `CLERK_SECRET_KEY` | Clerk secret key for backend auth | Same as above (Secret key) |
| `CLERK_WEBHOOK_SECRET` | Webhook signing secret | Clerk Dashboard → Webhooks (after deployment) |
| `POSTGRES_PASSWORD` | Database password | Choose a secure password |
| `NEXTAUTH_URL` | Your application's public URL | e.g., `https://approval.yourdomain.com` |
| `NEXTAUTH_SECRET` | JWT encryption secret | Generate with: `openssl rand -base64 32` |
| `CRON_SECRET` | Cron job security secret | Generate with: `openssl rand -base64 32` |

**Database variables (internal Docker networking):**

```bash
POSTGRES_USER=postgres
POSTGRES_DB=app_db
DATABASE_URL=postgresql://postgres:${POSTGRES_PASSWORD}@db:5432/app_db
```

**Note:** In Docker Compose, `db` is the internal service name. Do not use `localhost` or an IP address.

---

## Deployment

### One-Command Deployment

Deploy the application with a single command:

```bash
./scripts/deploy.sh
```

**What deploy.sh does:**
1. Pulls latest changes from Git (if in a Git repository)
2. Rebuilds Docker images from source
3. Stops and removes old containers
4. Starts new containers
5. Waits for services to become healthy
6. Displays service status

### Manual Deployment (Alternative)

If you prefer manual control:

```bash
# 1. Build images
docker compose build --no-cache

# 2. Start services
docker compose up -d

# 3. Check status
docker compose ps
```

### Verify Deployment

After deployment, verify the application is running:

```bash
# Run health check script
./scripts/health-check.sh
```

Expected output:
```
✓ Database (approval-db): running
✓ Application (approval-app): running
✓ Database health: healthy
✓ Application health: healthy
✓ API health endpoint: responding (200 OK)

============================================
✓ All systems healthy
============================================
```

Access the application at: `http://your-server-ip:3000`

**Note:** If deploying to a production domain, configure a reverse proxy (Nginx/Apache) to forward HTTP/HTTPS traffic to port 3000. This is outside the scope of this Docker deployment guide.

---

## Updates

### Update with Deploy Script

To update the application with zero downtime:

```bash
./scripts/deploy.sh
```

**Update process:**
1. Pulls latest code from Git
2. Rebuilds Docker images
3. Gracefully stops old containers
4. Starts new containers
5. Migrations run automatically before app starts
6. Data persists across updates

**Downtime:** ~5-10 seconds (depends on build time)

### Manual Update Process

If you need more control:

```bash
# 1. Stop services
docker compose down

# 2. Pull latest code
git pull origin main

# 3. Rebuild
docker compose build

# 4. Start services
docker compose up -d

# 5. Check logs
docker compose logs -f
```

---

## Backups

### Automated Backup

Run the backup script manually or schedule via cron:

```bash
./scripts/backup.sh
```

**What backup.sh does:**
1. Dumps PostgreSQL database to SQL file
2. Archives uploads directory as tar.gz
3. Stores backups in `./backups/`
4. Applies retention policy (keeps last 5 backups)
5. Reports backup file sizes

**Backup files created:**
- `backups/db_YYYYMMDD_HHMMSS.sql` - Database dump
- `backups/uploads_YYYYMMDD_HHMMSS.tar.gz` - Uploads archive

### Schedule Automated Backups (Cron)

Add a cron job to run daily backups:

```bash
# Edit crontab
crontab -e

# Add line to run backup daily at 2 AM
0 2 * * * cd /path/to/approval-app-v2 && ./scripts/backup.sh >> backups/cron.log 2>&1
```

### Restore from Backup

To restore from a backup:

```bash
# Restore database only
./scripts/restore.sh backups/db_20260214_120000.sql

# Restore database and uploads
./scripts/restore.sh backups/db_20260214_120000.sql backups/uploads_20260214_120000.tar.gz
```

**What restore.sh does:**
1. Validates backup file format
2. Confirms restore operation (safety check)
3. Restores database from SQL dump
4. Restores uploads from tar.gz (if specified)
5. Restarts application services

**Warning:** Database restore is destructive—it replaces the current database.

---

## Monitoring & Health Checks

### Health Check Script

Monitor system health at any time:

```bash
./scripts/health-check.sh
```

**Health checks performed:**
1. Docker Compose availability
2. Container running status (db, app)
3. Docker health status (internal healthcheck)
4. HTTP API endpoint response

**Exit codes:**
- `0` = All systems healthy
- `1` = One or more systems unhealthy

### View Logs

Follow real-time logs:

```bash
# All services
docker compose logs -f

# Specific service
docker compose logs -f app
docker compose logs -f db
```

**Log rotation:**
Docker Compose is configured to rotate logs automatically:
- Maximum file size: 10MB per log file
- Maximum files: 3 per service

This prevents disk space exhaustion from log accumulation.

---

## Troubleshooting

### Containers Won't Start

**Check service status:**

```bash
docker compose ps
```

**View startup logs:**

```bash
docker compose logs
```

**Common causes:**
1. Missing `.env.production` → Run `./scripts/setup.sh`
2. Invalid environment variables → Check `.env.production` syntax
3. Port 3000 already in use → Stop other services or change port mapping

### Database Connection Errors

**Symptoms:** App logs show "connection refused" or "ECONNREFUSED"

**Solutions:**

1. Check database health:
```bash
docker compose logs db
```

2. Verify DATABASE_URL format:
```bash
# Correct (Docker internal networking)
DATABASE_URL=postgresql://postgres:password@db:5432/app_db

# Incorrect (localhost won't work in Docker)
DATABASE_URL=postgresql://postgres:password@localhost:5432/app_db
```

3. Check database health status:
```bash
docker compose exec db pg_isready -U postgres
```

### File Upload Permission Errors

**Symptoms:** Logs show "EACCES: permission denied" when saving uploads

**Cause:** Container runs as UID 1001 (nextjs user), but host `uploads/` directory is owned by root.

**Solution:**

```bash
# Fix permissions on host
sudo chown -R 1001:1001 uploads/
sudo chmod -R 755 uploads/
```

**Preventative measure:** The `setup.sh` script sets permissions automatically. Run it again if you encounter this issue.

### Container Health is Unhealthy

**Check health status:**

```bash
docker compose ps
```

If health status shows "unhealthy":

1. Check healthcheck logs:
```bash
docker compose logs app | grep "healthcheck"
```

2. Restart the service:
```bash
docker compose restart app
```

3. If persistent, rebuild:
```bash
docker compose down
docker compose build --no-cache
docker compose up -d
```

### Disk Space Issues

**Check disk usage:**

```bash
# Docker system usage
docker system df

# Container disk usage
du -sh .next/ uploads/
```

**Free space:**

```bash
# Remove unused images
docker image prune -a

# Remove unused containers
docker container prune

# Remove unused volumes (WARNING: deletes data)
docker volume prune
```

**Backup cleanup:** The backup script automatically removes old backups (retention: 5 files). Manually remove if needed:

```bash
# List backups
ls -lh backups/

# Remove specific backup
rm backups/db_20260101_120000.sql
```

### Migration Failures

**Symptoms:** `migrate` service exits with error, `app` service won't start

**Check migration logs:**

```bash
docker compose logs migrate
```

**Common migration issues:**

1. **Database not ready when migrations run**
   - Solution: Wait longer, migrations will retry automatically
   - Check db health: `docker compose ps`

2. **Schema conflict**
   - Solution: Manual database reset (WARNING: data loss):
     ```bash
     docker compose down -v
     docker compose up -d
     ```

3. **Prisma client not generated**
   - Solution: Rebuild image (Prisma generation happens during build):
     ```bash
     docker compose build --no-cache
     ```

### Reset Application (Data Loss Warning)

**Warning:** This deletes all data (database and uploads). Only use for testing or catastrophic recovery.

```bash
# Stop and remove all containers and volumes
docker compose down -v

# Restart (fresh database)
docker compose up -d
```

---

## Architecture Reference

### Docker Services

| Service | Image | Purpose | Ports | Volumes |
|---------|--------|---------|--------|----------|
| `db` | postgres:15-alpine | PostgreSQL database | 5432 (internal) | db_data |
| `migrate` | Custom (builder stage) | Run migrations | - | - |
| `app` | Custom (runner stage) | Next.js application | 3000 | uploads_data |

### Volumes

| Volume | Purpose | Backup Strategy |
|--------|---------|-----------------|
| `db_data` | Persistent PostgreSQL data | `pg_dump` via backup.sh |
| `uploads_data` | Persistent file uploads | `tar` archive via backup.sh |

### Multi-Stage Dockerfile

The Dockerfile uses three stages:

1. **base:** Alpine base with Prisma dependencies
2. **deps:** Installs npm dependencies (cached layer)
3. **builder:** Builds Next.js and generates Prisma client
4. **runner:** Minimal production image with built artifacts

This results in a smaller final image (~110MB vs 300MB+ without stages).

---

## Hostinger VPS Deployment Notes

### Default Setup

Hostinger VPS provides:
- Ubuntu 20.04 or 22.04
- SSH access
- 1-4GB RAM options
- 40-80GB SSD storage

### Quick Start on Hostinger

```bash
# 1. SSH to your VPS
ssh root@your-hostinger-ip

# 2. Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sh get-docker.sh

# 3. Install Git
apt update && apt install -y git

# 4. Clone repository
git clone https://github.com/your-org/approval-app-v2.git
cd approval-app-v2

# 5. Run setup
./scripts/setup.sh

# 6. Configure environment
nano .env.production

# 7. Deploy
./scripts/deploy.sh
```

### Configure Firewall

Hostinger uses UFW (Uncomplicated Firewall). Allow necessary ports:

```bash
# Allow SSH
ufw allow 22/tcp

# Allow HTTP/HTTPS (if using reverse proxy)
ufw allow 80/tcp
ufw allow 443/tcp

# Enable firewall
ufw enable

# Check status
ufw status
```

**Note:** Port 3000 is exposed via Docker but typically not exposed to the internet directly. Configure a reverse proxy (Nginx) to forward `yourdomain.com` → `localhost:3000`.

---

## VMware/Internal VM Deployment Notes

### Network Configuration

For VMware VMs on internal networks:

1. **Static IP:** Assign a static IP to the VM
2. **DNS:** Configure internal DNS to point `approval.internal.yourcompany.com` to the VM IP
3. **Firewall:** Open port 3000 on the VM firewall

### VMware Tools

Install VMware Tools for better performance:

```bash
# On Ubuntu/Debian
sudo apt install open-vm-tools-desktop

# Verify
vmware-toolbox-cmd -v
```

### Resource Allocation

| Component | Minimum | Recommended |
|------------|-----------|--------------|
| vCPU | 2 | 4 |
| RAM | 2GB | 4GB |
| Disk | 20GB | 50GB+ |

---

## Security Checklist

- [ ] Changed default PostgreSQL password in `.env.production`
- [ ] Generated strong secrets for `NEXTAUTH_SECRET` and `CRON_SECRET`
- [ ] Configured Clerk webhook secret after deployment
- [ ] Set up firewall rules to limit access
- [ ] Configured automatic backups (cron job)
- [ ] Verified backup restoration works
- [ ] Set log rotation (already configured in docker-compose.yml)
- [ ] Monitor disk space regularly
- [ ] Review Docker logs for security events

---

## Support

For issues or questions:

1. Check [Troubleshooting](#troubleshooting) section
2. Review Docker logs: `docker compose logs`
3. Run health check: `./scripts/health-check.sh`
4. Check project issues: [GitHub Issues](https://github.com/your-org/approval-app-v2/issues)

---

**Last Updated:** 2026-02-14
**Version:** 1.0
**Compatibility:** Approval App v0.1.0+
