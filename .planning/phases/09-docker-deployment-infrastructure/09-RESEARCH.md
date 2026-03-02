# Phase 09: Docker Deployment Infrastructure - Research

**Researched:** 2026-02-14
**Domain:** Docker / Next.js / DevOps
**Confidence:** HIGH

## Summary

This phase implements a "one-command" deployment strategy for a Hostinger VPS or VMware VM. The core solution utilizes **Docker Compose** to orchestrate the Next.js application and PostgreSQL database.

To achieve the "Update without data loss" and "Automatic migrations" goals, we will use a **multi-stage Dockerfile** that supports both a minimal production runner (standalone mode) and a feature-rich builder stage for running migrations. We will avoid a complex reverse proxy setup (out of scope) and rely on Docker's restart policies and simple bash scripts for lifecycle management.

**Primary recommendation:** Use a multi-stage Dockerfile with `target` stages in Docker Compose to run migrations using the `builder` stage (with full deps) while deploying the `runner` stage (minimal standalone) for the app.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| **Docker** | 24+ | Container Runtime | Universal deployment standard |
| **Docker Compose** | v2 | Orchestration | Simple multi-container definition |
| **Node.js** | 20-alpine | Base Image | Small footprint (~40MB), active LTS |
| **Prisma** | v5/v6 | ORM/Migrations | Type-safe DB interactions |
| **PostgreSQL** | 15/16-alpine | Database | Standard reliable SQL DB |

### Supporting
| Tool | Purpose | When to Use |
|------|---------|-------------|
| **OpenSSL** | Crypto lib | Required by Prisma on Alpine |
| **libc6-compat** | Compatibility | Required by Next.js/Prisma on Alpine |
| **bash** | Scripting | Automation of setup/update/backup |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| **Alpine** | `node:slim` | Larger size (+100MB) but better glibc compatibility. Alpine is preferred for ~110MB target if configured correctly. |
| **Shell Scripts** | Ansible | Overkill for single-server deployment. |
| **Docker Compose** | Kubernetes | Massive complexity overhead for single server. |

## Architecture Patterns

### Recommended Project Structure
```
.
├── docker-compose.yml       # Service definitions
├── Dockerfile               # Multi-stage definition
├── .dockerignore           # Exclude node_modules, .git, .next
├── scripts/
│   ├── setup.sh            # First-time init
│   ├── update.sh           # Pull, build, migrate, restart
│   ├── backup.sh           # Dump DB + Tar files
│   └── restore.sh          # Restore DB + Untar files
└── prisma/
    └── migrations/         # SQL migrations
```

### Pattern 1: The Migration Service
**What:** A temporary Docker Compose service that runs solely to execute migrations before the app starts.
**Why:** The production app image (Next.js Standalone) strips out `node_modules` and dev dependencies (like Prisma CLI), making it impossible to run `prisma migrate deploy` inside the final container.
**Solution:** Define a `migrate` service in `docker-compose.yml` that targets the `builder` stage of the Dockerfile (which has full dependencies).

```yaml
services:
  app:
    build:
      context: .
      target: runner  # The minimal production image
    depends_on:
      db:
        condition: service_healthy
      migrate:
        condition: service_completed_successfully

  migrate:
    build:
      context: .
      target: builder # The stage with full node_modules
    command: npx prisma migrate deploy
    env_file: .env
    depends_on:
      db:
        condition: service_healthy
```

### Pattern 2: Standalone Output
**What:** Next.js `output: 'standalone'` creates a minimal server folder.
**Pitfall:** It does NOT copy `public` or `.next/static` by default. You must copy them manually in the Dockerfile.
**Example:**
```dockerfile
# In Dockerfile runner stage
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/.next/standalone ./
```

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| **DB Health** | Custom scripts | `pg_isready` | Built-in Postgres tool, reliable |
| **Log Rotation** | Custom cron | Docker `json-file` | Built-in rotation Configurable in compose |
| **Backups** | Copying /data | `pg_dump` | Copying raw data files while running corrupts DB |

## Common Pitfalls

### Pitfall 1: Alpine & Prisma Compatibility
**What goes wrong:** Container crashes with "Shared object not found" or OpenSSL errors.
**Why it happens:** Alpine uses `musl` instead of `glibc`. Prisma relies on native binaries.
**How to avoid:**
1. Use `node:20-alpine`.
2. Install `libc6-compat` and `openssl`.
3. Explicitly set `PRISMA_CLI_BINARY_TARGETS` in `schema.prisma` if needed (usually auto-detected, but `binaryTargets = ["native", "linux-musl-openssl-3.0.x"]` helps).

### Pitfall 2: Uploads Permissions
**What goes wrong:** App crashes with "EACCES: permission denied" when trying to save uploads.
**Why it happens:** Docker container runs as non-root (recommended), but host mounted directory is owned by root.
**How to avoid:**
1. Create the `./uploads` directory on the host in `setup.sh`.
2. `chown` it to the UID used in the Dockerfile (standard `node` image uses UID 1000 or 1001).
3. OR use a named volume (Docker manages permissions) - but this makes direct file backup slightly harder (requires `docker cp`).
**Recommendation:** Use a bind mount `./uploads` but ensure `setup.sh` sets permissions: `chown -R 1001:1001 ./uploads`.

### Pitfall 3: Missing Environment Variables
**What goes wrong:** Build fails or App starts but errors out.
**Why it happens:** `NEXT_PUBLIC_` variables are baked in at **BUILD time**. Server-side variables are needed at **RUNTIME**.
**How to avoid:**
1. Pass `NEXT_PUBLIC_` vars as `ARG` in Dockerfile if they differ per env (rare for this phase).
2. Ensure `.env` is mounted or passed to `docker compose`.

## Code Examples

### Multi-Stage Dockerfile (Verified)
```dockerfile
# Source: Vercel / Context7
FROM node:20-alpine AS base
# Check https://github.com/nodejs/docker-node/tree/b4117f9333da4138b03a546ec926ef50a31506c3#nodealpine to understand why libc6-compat might be needed.
RUN apk add --no-cache libc6-compat openssl

FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED 1
RUN npx prisma generate
RUN npm run build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV production
ENV NEXT_TELEMETRY_DISABLED 1
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
# Set the correct permission for prerender cache
mkdir .next
chown nextjs:nodejs .next

# Automatically leverage output traces to reduce image size
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
# Copy uploads folder structure if needed
RUN mkdir -p uploads && chown nextjs:nodejs uploads

USER nextjs
EXPOSE 3000
ENV PORT 3000
CMD ["node", "server.js"]
```

### Script: Backup (Simplified)
```bash
#!/bin/bash
# Backup Database and Uploads
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="./backups"
mkdir -p $BACKUP_DIR

# 1. Dump Database
docker compose exec -T db pg_dump -U postgres app_db > "$BACKUP_DIR/db_$TIMESTAMP.sql"

# 2. Archive Uploads
tar -czf "$BACKUP_DIR/uploads_$TIMESTAMP.tar.gz" ./uploads

# 3. Cleanup (Keep last 2)
ls -dt "$BACKUP_DIR"/* | tail -n +5 | xargs rm -f
```

## Open Questions

1.  **Maintenance Page during Update:**
    *   **Context:** "Show a simple... maintenance page".
    *   **Problem:** Without a reverse proxy (Nginx/Traefik) in front, we cannot switch traffic to a maintenance page while the main app container restarts (port 3000 will be down).
    *   **Workaround:** We can spin up a temporary lightweight container on port 3000 *before* bringing down the app? No, port conflict.
    *   **Recommendation:** Accept momentary "Connection Refused" (5-10s) or investigate running a temporary Nginx on port 3000 during the `docker compose up -d` phase if downtime is longer. Given the scope, a simple downtime is likely acceptable, but we will document this limitation.

## Sources

### Primary (HIGH confidence)
- Context7: `/vercel/next.js` (Standalone mode configuration)
- Context7: `/prisma/docs` (Docker deployment & migrations)
- Next.js Official Docs: `deployment.mdx#docker-image`

### Secondary (MEDIUM confidence)
- GitHub Discussions: `prisma/prisma` issues regarding Alpine + OpenSSL (verified fix: install openssl)
- Docker Documentation: Best practices for Node.js web apps

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Industry standard
- Architecture: HIGH - Verified multi-stage pattern
- Pitfalls: HIGH - Known issues with Alpine/Permissions

**Research date:** 2026-02-14
