# Technology Stack

**Analysis Date:** 2026-03-06

## Languages

**Primary:**
- TypeScript 5 - All source files (192 .ts/.tsx files in `/Users/red-copperpot/Documents/MyProjects/ApprovalAppV3_Standalone/src`)

**Secondary:**
- JavaScript - Configuration files and test utilities
- SQL (Prisma migrations) - Database schema definitions in `/Users/red-copperpot/Documents/MyProjects/ApprovalAppV3_Standalone/prisma/migrations`

## Runtime

**Environment:**
- Node.js 20 Alpine (Docker base image in `/Users/red-copperpot/Documents/MyProjects/ApprovalAppV3_Standalone/Dockerfile`)

**Package Manager:**
- npm (package-lock.json present)

## Frameworks

**Core:**
- Next.js 15.1.4 - React framework with App Router architecture
- React 19.0.0 - UI library
- React DOM 19.0.0 - DOM rendering

**Authentication:**
- NextAuth.js 5.0.0-beta.30 - Credentials provider with JWT sessions
- @auth/prisma-adapter 2.11.1 - Prisma integration for NextAuth

**Testing:**
- @playwright/test 1.58.2 - E2E testing framework
- Playwright configuration in `/Users/red-copperpot/Documents/MyProjects/ApprovalAppV3_Standalone/playwright.config.ts`

**Build/Dev:**
- TypeScript 5 - Type checking and compilation
- Tailwind CSS 3.4.1 - Utility-first CSS framework
- PostCSS 8.4.49 - CSS processing
- Autoprefixer 10.4.20 - CSS vendor prefixing
- ESLint 9 - Code linting with Next.js config

## Key Dependencies

**Critical:**
- Prisma 6.1.0 - Type-safe ORM for database access
- @prisma/client 6.1.0 - Prisma client for database queries
- Zod 4.3.6 - Schema validation and type inference

**UI Components:**
- Radix UI primitives - Headless UI components (@radix-ui/react-*)
  - Dialog, Dropdown Menu, Popover, Select, Tabs, etc.
- @dnd-kit/core 6.3.1, @dnd-kit/sortable 10.0.0, @dnd-kit/utilities 3.2.2 - Drag and drop functionality
- lucide-react 0.563.0 - Icon library
- Vaul 1.1.2 - Drawer/sheet component

**Data & Forms:**
- @tanstack/react-table 8.21.3 - Headless table for data grids
- @hookform/resolvers 5.2.2 - Form validation integration
- react-hook-form 7.71.1 - Form state management
- Recharts 2.15.4 - Charting library for analytics dashboard

**Styling:**
- tailwindcss-animate 1.0.7 - Animation utilities
- class-variance-authority 0.7.1 - Component variant management
- clsx 2.1.1 - Conditional class names
- tailwind-merge 3.4.0 - Tailwind class merging

**Utilities:**
- date-fns 4.1.0 - Date manipulation and formatting
- cmdk 1.1.1 - Command palette component
- sonner 2.0.7 - Toast notifications

**Infrastructure:**
- bcryptjs 3.0.3 - Password hashing
- nodemailer 7.0.13 - Email sending (optional SMTP)
- puppeteer 23.11.1 - PDF generation via headless Chromium
- json2csv 6.0.0-alpha.2 - CSV export functionality
- dotenv 17.2.3 - Environment variable loading

## Configuration

**Environment:**
- Environment variables configured via .env.local (dev) and .env.production (prod)
- Template provided in `/Users/red-copperpot/Documents/MyProjects/ApprovalAppV3_Standalone/.env.example`

**Build:**
- next.config.ts - Standalone output mode for Docker deployment
- Optimizes lucide-react imports for bundle size reduction
- tsconfig.json - ES2017 target, strict mode enabled, path aliases (@/*)

**Styling:**
- tailwind.config.ts - Custom color scheme using HSL variables, dark mode support
- postcss.config.mjs - PostCSS configuration

**Database:**
- prisma.config.ts - Prisma CLI configuration
- Schema defined in `/Users/red-copperpot/Documents/MyProjects/ApprovalAppV3_Standalone/prisma/schema.prisma`
- Seed script at `/Users/red-copperpot/Documents/MyProjects/ApprovalAppV3_Standalone/prisma/seed.ts`

**Testing:**
- playwright.config.ts - E2E test configuration
- Single worker, serial execution to avoid auth conflicts

## Platform Requirements

**Development:**
- Node.js 20+
- PostgreSQL 15 (or Docker with postgres:15-alpine)
- npm for package management
- 4GB RAM minimum for development

**Production:**
- Docker Compose or compatible container runtime
- 1GB RAM allocated to app container
- PostgreSQL 15 with persistent storage
- 512MB RAM allocated to database

---

*Stack analysis: 2026-03-06*
