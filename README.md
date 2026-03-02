# Approval System

An internal document approval workflow system for tracking requests with full visibility and accountability. Replace email-based tracking with centralized status management, approval chains, and audit trails.

## Quick Start

```bash
# 1. Clone repository
git clone https://github.com/your-org/approval-app-v2.git
cd approval-app-v2

# 2. Run setup script
chmod +x scripts/setup.sh
./scripts/setup.sh

# 3. Configure environment
nano .env.production

# 4. Deploy
./scripts/deploy.sh
```

Access the application at: `http://localhost:3000`

## Documentation

- [Deployment Guide](docs/DEPLOY.md) - Complete Docker deployment instructions
- [Admin Features](docs/ADMIN-DELETE-FEATURE.md) - Administrative controls and data management

## Features

- **User Management:** Role-based access (Admin, Engineering, General Department)
- **Department Management:** Create and manage approval hierarchies per department
- **Request Workflow:** Create requests with file attachments and route through approval chains
- **Level-Based Approvals:** Configurable approval hierarchies with any-one-per-level logic
- **Engineering Solutions:** Submit solutions with custom approval chains
- **Dashboard Views:** My Requests, Pending Approval, All Requests
- **Search & Filter:** Filter by department, status, and date range
- **Activity Timeline:** Complete audit trail of all request actions
- **Drag-and-Drop Builder:** Visual hierarchy configuration

## Tech Stack

- **Frontend:** Next.js 15 with TypeScript
- **Backend:** Next.js Server Actions with Prisma ORM
- **Database:** PostgreSQL 15
- **Authentication:** Clerk
- **UI:** shadcn/ui components with Tailwind CSS
- **Deployment:** Docker Compose with multi-stage Dockerfile

## Development

```bash
# Install dependencies
npm install

# Copy environment template
cp .env.example .env.local

# Start development server
npm run dev
```

## Deployment

For production deployment on Hostinger VPS or VMware/internal VMs, see the [Deployment Guide](docs/DEPLOY.md).

**Quick deployment:**

```bash
# One-command deployment
./scripts/deploy.sh

# Health check
./scripts/health-check.sh

# Backup
./scripts/backup.sh
```

## Scripts

| Script | Purpose |
|---------|---------|
| `scripts/setup.sh` | First-time environment setup |
| `scripts/deploy.sh` | Update and deploy application |
| `scripts/backup.sh` | Backup database and uploads |
| `scripts/restore.sh` | Restore from backup |
| `scripts/health-check.sh` | Verify service health |

## Architecture

```
┌─────────────────────────────────────────────────┐
│          Docker Compose Orchestration        │
└─────────────────────────────────────────────────┘
                     │
        ┌────────────┴────────────┐
        │                         │
   ┌────▼────┐         ┌─────▼──────┐
   │   App    │         │  Database   │
   │ (Next.js)│◄──────►│ (PostgreSQL) │
   │ Port 3000│         │   Port 5432  │
   └───────────┘         └─────────────┘
        │
   Persistent Volumes:
   - uploads_data (file attachments)
   - db_data (database)
```

## Security

- Authentication via Clerk with role-based access control
- JWT session tokens with refresh rotation
- Immutable audit trail via PostgreSQL triggers
- Containerized deployment with non-root user
- Environment variable isolation

## License

Internal use only.

---

**Version:** 0.1.0
**Last Updated:** 2026-02-14
