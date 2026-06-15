# Approval System (Standalone)

A fully self-contained internal document approval workflow system. No external services required — just clone, configure, and run. Replaces email-based tracking with centralized status management, approval chains, and audit trails.

## Quick Start

### Development

```bash
# 1. Clone and install
git clone <your-repo-url>
cd ApprovalAppV3_Standalone
npm install

# 2. Configure environment
cp .env.example .env.local
# Edit .env.local — set DATABASE_URL and NEXTAUTH_SECRET

# 3. Set up database
npx prisma migrate deploy
npx prisma db seed

# 4. Start dev server
npm run dev
```

Open `http://localhost:3000` and sign in:
- **Email:** `admin@example.com`
- **Password:** `changeme`

### Docker (Production)

```bash
# 1. Configure
cp .env.example .env.production
# Edit .env.production with your database credentials and secrets

# 2. Deploy
docker compose up -d

# 3. Verify
curl http://localhost:3000/api/health
```

## Interactive Deployment Manager

The project includes an operator menu for Docker-based install, update, backup, restore, health check, and rollback tasks:

```bash
npm run manage
```

Use this before updating a live installation. The manager checks `.env.production`, creates backups before update operations, wraps the existing Docker scripts, and runs a health check after deployment.

Supported update sources:

- Existing Git checkout
- Extracted GitHub zip/package
- Flash drive or local package folder

Persistent data is kept outside source updates:

- `.env.production`
- PostgreSQL Docker volume
- uploads Docker volume
- `backups/`

## Features

- **Request Workflow** — Create requests with file attachments, route through configurable approval chains
- **Level-Based Approvals** — Any-one-per-level logic with sequential routing through configured levels
- **Engineering Solutions** — Submit solutions with cost estimates and custom approval chains
- **Role-Based Access** — Admin, Engineering, and General Department roles
- **Drag-and-Drop Hierarchy Builder** — Visual approval chain configuration
- **Dashboard Views** — My Requests, Pending Approval, All Requests with search and filters
- **Activity Timeline** — Immutable audit trail with day-grouped chronological events
- **PDF Reports** — Generate A4 approval reports with full history
- **Analytics Dashboard** — Pipeline charts, approval time metrics, department breakdowns
- **Request Templates** — Predefined templates for common submissions
- **Mobile-Responsive** — Touch-friendly UI across all screen sizes
- **Email Notifications** — Optional SMTP-based notifications (works without configuration)

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Framework** | Next.js 15 (App Router) |
| **Language** | TypeScript |
| **Authentication** | NextAuth.js v5 (Credentials + JWT) |
| **Database** | PostgreSQL 15 |
| **ORM** | Prisma |
| **UI** | shadcn/ui + Tailwind CSS + Radix UI |
| **Data Tables** | TanStack Table |
| **Charts** | Recharts |
| **PDF** | Puppeteer (headless Chromium) |
| **Email** | Nodemailer (optional SMTP) |
| **Deployment** | Docker Compose |

**Zero external service dependencies.** Authentication, database, file storage, and email are all self-hosted.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `NEXTAUTH_URL` | Yes | App URL (e.g., `http://localhost:3000`) |
| `NEXTAUTH_SECRET` | Yes | JWT secret — generate with `openssl rand -base64 32` |
| `UPLOAD_DIR` | No | File upload directory (default: `public/uploads`) |
| `CRON_SECRET` | No | Secret for cron job endpoints |
| `SMTP_HOST` | No | SMTP server for email notifications |
| `SMTP_PORT` | No | SMTP port (default: `587`) |
| `SMTP_USER` | No | SMTP username |
| `SMTP_PASS` | No | SMTP password |
| `SMTP_FROM` | No | Sender email address |

## User Roles

| Role | Capabilities |
|------|-------------|
| **Admin** | System configuration, user/department management, hierarchy builder, audit export |
| **General Department** | Create requests, approve within hierarchy, view dashboards |
| **Engineering** | Submit solutions with cost estimates, approve within hierarchy |

All users can view dashboards, search/filter requests, and track status.

## Approval Workflow

```
Request Created → Approval Chain (Level 1 → 2 → 3)
    → Sent to Engineering → Solution Submitted
    → Solution Approval Chain → Final Approval
    → Sent Back to Requester → Completed
```

- Approval hierarchies are configurable per department via drag-and-drop UI
- Any one approver per level can approve (any-one-per-level logic)
- Engineering solutions support custom approval chains
- Requesters and engineers can cancel at appropriate stages

## Project Structure

```
├── prisma/
│   ├── schema.prisma          # Database schema
│   ├── seed.ts                # Default admin + departments
│   └── migrations/            # Database migrations
├── src/
│   ├── app/                   # Next.js App Router pages
│   │   ├── (admin)/           # Admin pages
│   │   ├── (auth)/            # Sign-in/sign-up
│   │   ├── (dashboard)/       # Dashboard, requests, engineering
│   │   └── api/               # API routes (auth, upload, health)
│   ├── components/            # React components (shadcn/ui based)
│   ├── lib/                   # Auth config, Prisma client, utilities
│   ├── server-actions/        # Server-side business logic
│   └── middleware.ts          # Route protection
├── docker-compose.yml         # Production deployment
├── Dockerfile                 # Multi-stage build
└── .env.example               # Environment template
```

## Development Scripts

```bash
npm run dev              # Start development server
npm run build            # Production build
npm run start            # Start production server
npm run lint             # Run ESLint
npx prisma studio        # Visual database browser
npx prisma migrate dev   # Create new migration
npx prisma db seed       # Seed database
```

## Docker Deployment

The Docker setup includes:
- **PostgreSQL 15** with persistent volume
- **Next.js** standalone build (~110MB image)
- **Auto-migrations** via migration service
- **Health checks** for app and database
- **Log rotation** and resource limits

```bash
docker compose up -d          # Start all services
docker compose logs -f app    # View app logs
docker compose down           # Stop services
docker compose down -v        # Stop + remove volumes (⚠️ deletes data)
```

## Security

- Password hashing with bcrypt (12 salt rounds)
- JWT session tokens (7-day expiry)
- Role-based middleware route protection
- Database-backed admin verification (defense-in-depth)
- Immutable audit trail
- Non-root Docker user
- CSRF protection via NextAuth.js

## Documentation

- [Deployment Guide](docs/DEPLOY.md) — Docker deployment instructions
- [Admin Features](docs/ADMIN-DELETE-FEATURE.md) — Administrative controls

## License

Internal use only.

---

**Version:** 1.0.0-standalone
**Last Updated:** 2026-03-02
