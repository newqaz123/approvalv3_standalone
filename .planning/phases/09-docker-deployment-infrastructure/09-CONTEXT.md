# Phase 9: Docker Deployment Infrastructure - Context

**Gathered:** 2026-02-14
**Status:** Ready for planning

<domain>
## Phase Boundary

One-command deployment of the approval system on any Linux server (Hostinger VPS or VMware VM). Includes Docker Compose setup, database migrations, file upload persistence, and operational scripts for updates, backups, and rollback. SSL/reverse proxy is NOT in scope (user handles domain/HTTPS separately).

</domain>

<decisions>
## Implementation Decisions

### Setup experience
- Interactive setup script (`./setup.sh`) that prompts for database password, Clerk keys, domain, etc. and generates `.env` + starts containers
- Script checks for Docker/Docker Compose and installs if missing — does NOT handle system updates, firewall, or other OS-level dependencies
- App image is built on the server (clone repo, `docker compose build`). No container registry needed
- Clerk webhook setup: script prints clear step-by-step instructions ("Go to Clerk dashboard → Webhooks → Add endpoint: https://yourdomain.com/api/webhooks/clerk")

### Update & rollback workflow
- Update script (`./update.sh`) that pulls latest code, rebuilds, runs migrations, restarts containers
- Update script prompts: "Create backup before updating? (recommended) [Y/n]" — not forced, but recommended
- Restore script (`./restore.sh`) that takes a backup file and rolls back the database + reverts to previous image
- Show a simple "System updating, back shortly" maintenance page while containers restart during updates

### Backup & data safety
- Manual backup only — no automated/scheduled backups
- Backup script (`./backup.sh`) creates a single archive containing both PostgreSQL database dump AND uploaded files directory
- Keep last 2 backups, auto-delete older ones to save disk space
- Backups stored in local `./backups/` directory on the same server

### Claude's Discretion
- Docker Compose service configuration (networking, volumes, health checks)
- Dockerfile optimization (multi-stage builds, layer caching)
- Database migration strategy within containers
- Maintenance page implementation approach
- Exact prompts and output formatting in scripts

</decisions>

<specifics>
## Specific Ideas

- Target environments: Hostinger VPS and VMware VM — both running Linux
- ~30 users, single admin deploying and managing
- Build on server approach keeps things simple — no registry, no CI/CD pipeline needed
- Scripts should be bash-based and work on common Linux distros (Ubuntu/Debian primarily)

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 09-docker-deployment-infrastructure*
*Context gathered: 2026-02-14*
