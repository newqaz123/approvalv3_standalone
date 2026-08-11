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
# Edit .env.local — set DATABASE_URL and NEXTAUTH_SECRET, and override the
# application URL variables (AUTH_URL, NEXTAUTH_URL, NEXT_PUBLIC_APP_URL)
# with http://localhost:3000 for local development

# 3. Set up database
npx prisma migrate deploy
npx prisma db seed

# 4. Start dev server
npm run dev
```

Open `http://localhost:3000` and sign in:

- **Email:** `admin@example.com`
- **Password:** `changeme`

### Docker development

Use the development Compose file explicitly:

```bash
docker compose -f docker-compose.dev.yml up -d
```

### Production deployment

Production has one beginner-safe entry point for both an online Ubuntu VPS and an offline intranet package:

```bash
cp .env.example .env.production
# Set production credentials and one shared HTTPS origin for AUTH_URL,
# NEXTAUTH_URL, and NEXT_PUBLIC_APP_URL.
bash scripts/deploy.sh
```

Choose **Ubuntu VPS / GitHub update** for a routine update from `main`, or **Offline intranet package** for an extracted package. The script validates the environment and checksums, tags the running images for rollback, records data state, backs up PostgreSQL and uploads, applies migrations, verifies health, and checks that data and attachments were preserved.

The production Compose contract is always explicit:

```bash
docker compose -p approval-app --env-file .env.production -f docker-compose.prod.yml up -d db migrate app
```

Routine deployment never runs the seed service. On a confirmed first installation only, seed is separately profile-gated:

```bash
docker compose -p approval-app --env-file .env.production -f docker-compose.prod.yml --profile first-install run --rm seed
```

## Interactive Deployment Manager

```bash
npm run manage
```

Choose option `2` to update an existing installation; the manager delegates once to `bash scripts/deploy.sh`, where you choose online or offline mode. Backup, restore, health, and rollback remain separate manager options.

Online deployment requires the checked-out `main` branch and a fast-forward-only update. If tracked source changes are present, deployment aborts by default or offers an explicitly named stash. The stash is never automatically restored or deleted; recover it later with the exact name printed by the script.

Offline deployment verifies `SHA256SUMS` before loading any image and performs no Git or network operation.

Every update preserves and verifies:

- `.env.production`;
- the PostgreSQL data volume;
- the private uploads volume;
- verified database and uploads backups; and
- pre-existing attachment gaps without allowing new missing files.

Rollback restores only the previous app image. It does not reverse database migrations; when migration state is applied or unknown, the operator must type `ROLLBACK APP ONLY` after confirming schema compatibility.

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
| ------- | ----------- |
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
| ---------- | ---------- | ------------- |
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `AUTH_URL` | Yes | Canonical Auth.js v5 origin — must match `NEXTAUTH_URL` (e.g., `https://approval.example.com`; `http://localhost:3000` in `.env.local`) |
| `NEXTAUTH_URL` | Yes | App URL — must match `AUTH_URL` (e.g., `https://approval.example.com`; `http://localhost:3000` in `.env.local`) |
| `NEXT_PUBLIC_APP_URL` | Yes | App API base — must match `AUTH_URL` / `NEXTAUTH_URL` |
| `AUTH_TRUST_HOST` | Yes (production) | `true` so Auth.js trusts the host/protocol forwarded by the Nginx proxy |
| `NEXTAUTH_SECRET` | Yes | JWT secret — generate with `openssl rand -base64 32` |
| `UPLOAD_DIR` | No | File upload directory (default: `public/uploads`) |
| `CRON_SECRET` | No | Secret for cron job endpoints |
| `SMTP_HOST` | No | SMTP server for email notifications |
| `SMTP_PORT` | No | SMTP port (default: `587`) |
| `SMTP_USER` | No | SMTP username |
| `SMTP_PASS` | No | SMTP password |
| `SMTP_FROM` | No | Sender email address |

### Authentication Origin and Logout

In production the app runs behind a controlled Nginx reverse proxy that
forwards the public host and protocol to the app container:

```nginx
proxy_set_header Host              $host;
proxy_set_header X-Forwarded-Host  $host;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
```

All three URL variables (`AUTH_URL`, `NEXTAUTH_URL`, `NEXT_PUBLIC_APP_URL`)
must match the public HTTPS origin, and `AUTH_TRUST_HOST=true` permits Auth.js
to trust the forwarded host/protocol. Local development overrides the three
URL variables to `http://localhost:3000` in `.env.local`; the production
template keeps the HTTPS origin. Sign out uses a relative `/sign-in` callback
so the browser stays on the trusted origin — no absolute URL is baked into
the client. If sign out redirects to `localhost`, check that the three URL
variables match the public origin and that the forwarded headers above are
present. See [docs/DEPLOY.md](docs/DEPLOY.md) for the full deployment guide.

## User Roles

| Role | Capabilities |
| ------ | ------------- |
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
├── docker-compose.dev.yml     # Local Docker development
├── docker-compose.prod.yml    # Production and offline deployment
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

The Docker setup includes PostgreSQL 15, a persistent private uploads volume, a standalone Next.js image, a one-shot migration service, health checks, log rotation, and resource limits.

- Development: `docker compose -f docker-compose.dev.yml up -d`
- Production: `bash scripts/deploy.sh`
- Production status: `docker compose -p approval-app --env-file .env.production -f docker-compose.prod.yml ps`
- Application logs: `docker compose -p approval-app --env-file .env.production -f docker-compose.prod.yml logs -f app`

See [DEPLOY.md](DEPLOY.md) for the safe update, backup, restore, and rollback runbook.

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
