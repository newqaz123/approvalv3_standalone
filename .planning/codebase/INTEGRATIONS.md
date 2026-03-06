# External Integrations

**Analysis Date:** 2026-03-06

## APIs & External Services

**No external API integrations detected.**

This is a self-contained approval system with zero external service dependencies. All functionality is implemented in-house or through npm packages that run locally.

## Data Storage

**Databases:**
- PostgreSQL 15
  - Connection: `DATABASE_URL` environment variable
  - Client: Prisma ORM with @prisma/client
  - Migrations: Located in `/Users/red-copperpot/Documents/MyProjects/ApprovalAppV3_Standalone/prisma/migrations`
  - Schema: Defined in `/Users/red-copperpot/Documents/MyProjects/ApprovalAppV3_Standalone/prisma/schema.prisma`
  - Prisma Client singleton: `/Users/red-copperpot/Documents/MyProjects/ApprovalAppV3_Standalone/src/lib/prisma.ts`

**File Storage:**
- Local filesystem only
  - Upload directory: `public/uploads` (configurable via `UPLOAD_DIR` env var)
  - File attachments managed through `/Users/red-copperpot/Documents/MyProjects/ApprovalAppV3_Standalone/src/lib/files.ts`
  - No cloud storage integration (S3, Azure Blob, etc.)

**Caching:**
- None detected (no Redis, Memcached, or similar)
- Next.js built-in cache used for revalidation

## Authentication & Identity

**Auth Provider:**
- Custom implementation using NextAuth.js v5
  - Configuration: `/Users/red-copperpot/Documents/MyProjects/ApprovalAppV3_Standalone/src/lib/auth-config.ts`
  - Auth route: `/Users/red-copperpot/Documents/MyProjects/ApprovalAppV3_Standalone/src/app/api/auth/[...nextauth]/route.ts`
  - Credentials provider with bcrypt password hashing (12 salt rounds)
  - JWT-based sessions with 7-day expiry
  - Role-based access control (admin, general_dept, engineering)
  - No OAuth providers (Google, GitHub, etc.) configured

**Implementation Details:**
- Middleware-based route protection in `/Users/red-copperpot/Documents/MyProjects/ApprovalAppV3_Standalone/src/middleware.ts`
- User model with department associations
- Session data includes: id, email, name, role, departmentId, forcePasswordChange

## Monitoring & Observability

**Error Tracking:**
- None detected (no Sentry, Bugsnag, or similar)

**Logs:**
- Console-based logging only
- Prisma query logging in development mode
- Docker logs with rotation (10MB max, 3 files)
- No centralized logging service

**Health Checks:**
- `/api/health` endpoint at `/Users/red-copperpot/Documents/MyProjects/ApprovalAppV3_Standalone/src/app/api/health/route.ts`
- Docker health check configured for app container

## CI/CD & Deployment

**Hosting:**
- Self-hosted via Docker Compose
- Docker configuration in `/Users/red-copperpot/Documents/MyProjects/ApprovalAppV3_Standalone/docker-compose.yml`
- Multi-stage Dockerfile at `/Users/red-copperpot/Documents/MyProjects/ApprovalAppV3_Standalone/Dockerfile`
- No Vercel, Netlify, or cloud platform integration

**CI Pipeline:**
- None detected (no GitHub Actions, GitLab CI, etc.)
- Manual deployment via Docker Compose

**Deployment Services:**
- PostgreSQL 15 Alpine (docker-compose service: `db`)
- Multi-stage build with builder and runner stages
- Migration service runs automatically before app startup
- Optional Prisma Studio service for development

## Environment Configuration

**Required env vars:**
- `DATABASE_URL` - PostgreSQL connection string
- `NEXTAUTH_URL` - Application URL for auth callbacks
- `NEXTAUTH_SECRET` - JWT signing secret

**Optional env vars:**
- `UPLOAD_DIR` - File upload directory (default: public/uploads)
- `CRON_SECRET` - Cron job endpoint protection
- `SMTP_HOST` - SMTP server hostname for email notifications
- `SMTP_PORT` - SMTP port (default: 587)
- `SMTP_USER` - SMTP username
- `SMTP_PASS` - SMTP password
- `SMTP_FROM` - Sender email address
- `NEXT_PUBLIC_APP_URL` - Public URL for email links

**Secrets location:**
- Environment files (.env.local for dev, .env.production for prod)
- Never committed to git
- No secret management service (Vault, AWS Secrets Manager, etc.)

## Webhooks & Callbacks

**Incoming:**
- No webhook receivers detected
- Cron job endpoint at `/Users/red-copperpot/Documents/MyProjects/ApprovalAppV3_Standalone/src/app/api/cron` (protected by CRON_SECRET)

**Outgoing:**
- No webhook sending capabilities
- Email notifications via Nodemailer (optional, requires SMTP configuration)
  - SMTP implementation in `/Users/red-copperpot/Documents/MyProjects/ApprovalAppV3_Standalone/src/server-actions/notifications.ts`
  - Sends notifications for: approval_needed, approval_granted, solution_ready, final_approval_needed
  - Gracefully degrades if SMTP not configured

## Third-Party Services

**PDF Generation:**
- Puppeteer (headless Chromium) - Local PDF generation
  - Runs in Docker container with Chromium pre-installed
  - Used for approval report generation
  - No external PDF API (e.g., AWS PDF generation)

**Email Delivery:**
- Nodemailer with SMTP - Local email sending
  - Requires SMTP server configuration
  - No transactional email service (SendGrid, Mailgun, etc.)
  - Gracefully handles unconfigured state

**No Integrations With:**
- Payment processors (Stripe, PayPal)
- Cloud storage (AWS S3, Google Cloud Storage)
- Analytics platforms (Google Analytics, Mixpanel)
- A/B testing tools
- CDN services
- API gateways
- Message queues (RabbitMQ, Kafka)
- Search engines (Elasticsearch, Algolia)

---

*Integration audit: 2026-03-06*
