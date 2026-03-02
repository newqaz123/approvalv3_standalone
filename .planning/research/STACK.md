# Technology Stack - v1.1 Additions

**Project:** Approval Flow System v1.1
**Focus:** Docker deployment, analytics dashboard, PDF/Excel reporting, request templates, mobile-responsive design
**Researched:** 2026-02-13
**Overall Confidence:** HIGH

---

## Executive Summary

v1.1 requires minimal new dependencies. The existing Next.js 15 + shadcn/ui stack already provides most capabilities. Add 3 core libraries (Recharts, @react-pdf/renderer, ExcelJS), configure Next.js standalone mode, and write Docker Compose configuration. Mobile responsiveness requires no new dependencies - Tailwind CSS v3.4+ already provides everything needed.

**Key Principle:** Extend, don't replace. Integrate new capabilities with existing patterns (shadcn/ui components, Server Actions, Prisma ORM).

---

## 1. Docker Deployment Infrastructure

### Core Technologies

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| **Docker** | 27+ | Container runtime | Industry standard, reliable, well-documented |
| **Docker Compose** | v2.x | Multi-container orchestration | Simplifies PostgreSQL + Next.js + volume management |
| **Node.js Alpine** | 22-alpine | Base image for Next.js | Minimal size, Prisma 7.0+ compatible, production-ready |
| **PostgreSQL** | 17-alpine | Database container | Current stable, matches Prisma compatibility |

### Next.js Standalone Mode (CRITICAL)

**Configuration Required:**

Add to `next.config.ts`:

```typescript
const nextConfig: NextConfig = {
  output: 'standalone', // Enable Docker optimization
};
```

**What This Does:**
- Creates `.next/standalone` folder with only required files
- Reduces Docker image from ~1GB to ~110MB (85% smaller)
- Auto-generates minimal `server.js` for production
- Copies only necessary node_modules files

**Source:** [Next.js Standalone Mode & Docker Optimization](https://javascript.plainenglish.io/next-js-15-self-hosting-with-docker-complete-guide-0826e15236da), [Next.js Official Docs](https://nextjs.org/docs/pages/api-reference/config/next-config-js/output)

### Multi-Stage Dockerfile Pattern

**Recommended 4-Stage Build:**

1. **Base Stage:** `node:22-alpine`, add `libc6-compat`, set `NODE_ENV=production`, `NEXT_TELEMETRY_DISABLED=1`
2. **Dependencies Stage:** `npm ci --omit=dev` (production deps only)
3. **Builder Stage:** Build Next.js, generate `.next` folder
4. **Runtime Stage:** Copy standalone output + static files + public folder, run as non-root user

**Security Best Practices:**
- Always run as non-root user (create `nextjs` user with UID 1001)
- Use `.dockerignore` to exclude `node_modules`, `.git`, `.env*`, `test-results/`, `.planning/`
- Set `PORT=3000` and `HOSTNAME=0.0.0.0` for container networking

**Source:** [Next.js Docker Multi-Stage Guide](https://ketan-chavan.medium.com/next-js-15-self-hosting-with-docker-complete-guide-0826e15236da), [Docker Multi-Stage Best Practices](https://johnnymetz.com/posts/dockerize-nextjs-app/)

### Docker Compose Configuration

**Services Architecture:**

```yaml
services:
  postgres:
    image: postgres:17-alpine
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER} -d ${POSTGRES_DB}"]
      interval: 10s
      timeout: 5s
      retries: 5
    volumes:
      - postgres_data:/var/lib/postgresql/data

  app:
    depends_on:
      postgres:
        condition: service_healthy  # Wait for DB health check
    volumes:
      - uploads_data:/app/public/uploads  # Persistent file storage
    environment:
      DATABASE_URL: postgresql://...
      CLERK_SECRET_KEY: ${CLERK_SECRET_KEY}
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: ${NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY}
```

**Why Health Checks Matter:**
- PostgreSQL takes 5-10s to accept connections after container starts
- `pg_isready` is the official health check command
- `condition: service_healthy` prevents Next.js from starting before DB is ready
- Eliminates race conditions and "can't connect to database" errors

**Source:** [Docker Compose Health Checks Guide](https://oneuptime.com/blog/post/2026-01-30-docker-compose-health-checks/view), [PostgreSQL Docker Health Checks](https://laurent-bel.medium.com/waiting-for-postgresql-to-start-in-docker-compose-c72271b3c74a)

### Persistent Storage Volumes

**Volume Strategy:**

| Volume | Mount Point | Purpose | Backup Priority |
|--------|-------------|---------|-----------------|
| `postgres_data` | `/var/lib/postgresql/data` | Database persistence | CRITICAL - daily backups |
| `uploads_data` | `/app/public/uploads` | File attachments | HIGH - incremental backups |

**Why Named Volumes:**
- Managed by Docker daemon, easier to backup/migrate than bind mounts
- Faster than bind mounts (direct host filesystem writes)
- Doesn't increase container size
- Survives container deletion

**Current App Consideration:**
- App already uses `public/uploads/` for local file storage
- Map this directory to Docker volume for persistence
- Alternative: Consider S3/MinIO in future milestone if VPS storage becomes constraint

**Source:** [Docker Volumes for Persistent Data](https://oneuptime.com/blog/post/2026-02-02-docker-volumes-persistent-data/view), [Docker Volumes Official Docs](https://docs.docker.com/engine/storage/volumes/)

### Prisma Migration Strategy

**Production Migration Pattern:**

```json
// package.json scripts
{
  "docker:start": "prisma migrate deploy && node server.js"
}
```

**What This Does:**
- `prisma migrate deploy` applies pending migrations (production-safe, no prompts)
- Runs during container startup, NOT during build
- Uses `CMD` not `RUN` in Dockerfile (executes on container start)
- Ensures database schema matches code version

**Important Distinction:**
- Development: `prisma migrate dev` (creates migrations, prompts for destructive changes)
- Production: `prisma migrate deploy` (applies existing migrations only, automated)

**Source:** [Prisma Migrate Deploy with Docker](https://notiz.dev/blog/prisma-migrate-deploy-with-docker/), [Prisma Docker Guide](https://www.prisma.io/docs/guides/docker)

### Environment Variables for Docker

**Required Clerk Variables (Docker-Specific Consideration):**

```env
# Server-side (secrets)
CLERK_SECRET_KEY=sk_live_...

# Client-side (bundled in Next.js build)
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_live_...
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL=/
NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL=/
```

**Known Issue Alert:**
- GitHub issue #3683 reports Clerk middleware compatibility issues in Docker environments
- Recommendation: Test auth flows thoroughly in local Docker before production deployment
- Workaround if needed: Ensure all `NEXT_PUBLIC_*` vars are set in Dockerfile or docker-compose.yml

**Source:** [Clerk Environment Variables](https://clerk.com/docs/guides/development/clerk-environment-variables), [Clerk Docker Issue #3683](https://github.com/clerk/javascript/issues/3683)

### Optional: Nginx Reverse Proxy

**When to Add Nginx:**

Add Nginx if you need:
- SSL termination (HTTPS with Let's Encrypt certificates)
- Static asset caching (reduce Next.js server load)
- Multiple apps on same VPS (port-based routing)
- Advanced logging/monitoring

**Don't Add Nginx if:**
- Single Next.js app on dedicated VPS
- Using Cloudflare or other CDN for SSL/caching
- VPS provider offers built-in SSL (many do)

**If Using Nginx:**
- Run as third Docker Compose service
- Proxy to Next.js container on port 3000
- Volume mount `/etc/ssl` for certificates
- Configure WebSocket headers for real-time features (if added in future)

**Source:** [Next.js Docker Nginx Guide](https://collabnix.com/deploying-a-next-js-app-on-https-with-docker-using-nginx-as-a-reverse-proxy/), [Docker Nginx Reverse Proxy Setup](https://steveholgado.com/nginx-for-nextjs/)

---

## 2. Real-Time Analytics Dashboard

### Recommended: Recharts

| Library | Version | Purpose | Why |
|---------|---------|---------|-----|
| **Recharts** | ^3.7.0 | React charting library | React-first, shadcn/ui compatible, declarative API |

**Installation:**

```bash
npm install recharts
```

**React 19 Compatibility:**
- Recharts 3.7.0+ supports React 19 out of the box
- Previous versions (2.13.0-alpha.2) required dependency overrides
- Current stable version works with React 17, 18, and 19

**Why Recharts Over Chart.js:**

| Criterion | Recharts | Chart.js (react-chartjs-2) |
|-----------|----------|---------------------------|
| React Integration | Native React components | Wrapper around Canvas-based lib |
| shadcn/ui Compatibility | Excellent (same design principles) | Fair (requires custom styling) |
| Large Datasets (10K+ points) | Optimized for SVG rendering | Better for small datasets (<1K) |
| Customization | High (component composition) | Limited (config-based) |
| Bundle Size | 50KB gzipped | 11KB gzipped |
| Learning Curve | Shallow (React patterns) | Steeper (Chart.js API + React wrapper) |

**For This Project:**
- Approval workflow analytics = small-to-medium datasets (~30 users)
- Recharts provides better DX for React developers
- SVG output = crisp on mobile, accessible, printable
- Composable architecture matches existing shadcn/ui patterns

**Chart Types for Analytics Dashboard:**

1. **Line Chart:** Approval trends over time
2. **Bar Chart:** Department request volumes
3. **Pie/Donut Chart:** Request status distribution
4. **Area Chart:** Cumulative approvals by month

**Example Integration with shadcn/ui:**

```tsx
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts"

export function ApprovalTrendChart({ data }: { data: ChartData[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Approval Trends</CardTitle>
        <CardDescription>Last 30 days</CardDescription>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" />
            <YAxis />
            <Tooltip />
            <Line type="monotone" dataKey="approvals" stroke="hsl(var(--primary))" />
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  )
}
```

**Data Source Pattern:**
- Use existing Prisma queries to aggregate RequestActivity data
- Create Server Actions in `src/app/analytics/actions.ts`
- Group by date/department/status using Prisma aggregations
- Return JSON data for Recharts components

**Source:** [Recharts npm](https://www.npmjs.com/package/recharts), [Recharts vs Chart.js Performance Comparison](https://www.oreateai.com/blog/recharts-vs-chartjs-navigating-the-performance-maze-for-big-data-visualizations/4aff3db4085050dc635fd25267846922), [Best React Chart Libraries 2025](https://blog.logrocket.com/best-react-chart-libraries-2025/)

---

## 3. PDF/Excel Reporting

### PDF Generation: @react-pdf/renderer

| Library | Version | Purpose | Why |
|---------|---------|---------|-----|
| **@react-pdf/renderer** | ^4.3.2 | React-to-PDF generation | JSX syntax, server-side rendering, styled components |

**Installation:**

```bash
npm install @react-pdf/renderer
```

**Why @react-pdf/renderer Over Alternatives:**

| Library | Use Case | Strengths | Weaknesses |
|---------|----------|-----------|------------|
| **@react-pdf/renderer** | **Generate PDFs from scratch** | React components, server-side, flexible layouts | Larger bundle (~150KB) |
| jsPDF | Simple browser PDFs | Lightweight (11KB), no dependencies | No React integration, manual positioning |
| react-pdf (wojtekmaj) | **Display existing PDFs** | PDF viewer component | Not for generation |
| Puppeteer | HTML-to-PDF (screenshot) | Perfect HTML rendering | Requires headless Chrome, slow, large |

**For This Project:**
- Need to **generate** PDFs (approval reports, request summaries)
- NOT displaying existing PDFs
- Server-side generation preferred (Next.js API routes or Server Actions)
- React-first approach matches team skills

**Confidence:** HIGH - @react-pdf/renderer is the standard for React-based PDF generation

**Example Pattern for Approval Reports:**

```tsx
// app/api/reports/[requestId]/pdf/route.ts
import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer'
import { renderToStream } from '@react-pdf/renderer'

const styles = StyleSheet.create({
  page: { padding: 30 },
  header: { fontSize: 18, marginBottom: 20 },
  section: { marginBottom: 10 },
})

const ApprovalReport = ({ request, activities }: Props) => (
  <Document>
    <Page size="A4" style={styles.page}>
      <View style={styles.header}>
        <Text>Approval Request Report</Text>
        <Text>Request ID: {request.id}</Text>
      </View>
      <View style={styles.section}>
        <Text>Department: {request.department.name}</Text>
        <Text>Status: {request.status}</Text>
      </View>
      {/* Activity timeline */}
    </Page>
  </Document>
)

export async function GET(request: Request, { params }: { params: { requestId: string } }) {
  const data = await fetchRequestData(params.requestId)
  const stream = await renderToStream(<ApprovalReport {...data} />)

  return new Response(stream as any, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="request-${params.requestId}.pdf"`,
    },
  })
}
```

**Server Actions Alternative:**

Can also use Server Actions instead of API routes for PDF generation, returning base64-encoded PDF to client for download.

**Source:** [React PDF Libraries Comparison](https://blog.react-pdf.dev/6-open-source-pdf-generation-and-modification-libraries-every-react-dev-should-know-in-2025), [@react-pdf/renderer npm](https://www.npmjs.com/package/@react-pdf/renderer), [JavaScript PDF Libraries Guide](https://www.nutrient.io/blog/javascript-pdf-libraries/)

### Excel Export: ExcelJS

| Library | Version | Purpose | Why |
|---------|---------|---------|-----|
| **ExcelJS** | ^4.4.0 | Excel file generation | Modern API, streaming support, active maintenance |

**Installation:**

```bash
npm install exceljs
```

**Why ExcelJS Over SheetJS (xlsx):**

| Criterion | ExcelJS | SheetJS (xlsx) |
|-----------|---------|----------------|
| Maintenance | Active (2024 releases) | Active but security issues reported |
| API Design | Modern, Promise-based | Older callback patterns |
| Styling Support | Excellent (cell formatting, borders, fonts) | Limited |
| Streaming | Built-in WorkbookReader/Writer | Requires manual setup |
| Memory Efficiency | Optimized for large files | Potential issues with large datasets |
| TypeScript | Strong typing | Adequate |
| Bundle Size | ~300KB | ~200KB |
| Weekly Downloads | 2.9M | 4.2M |

**For This Project:**
- Need cell styling (headers, status colors)
- Reports are small-to-medium (30 users, hundreds of requests)
- ExcelJS provides better DX for modern Node.js
- Better maintained, fewer security vulnerabilities

**Confidence:** HIGH - ExcelJS is the modern choice for Excel generation in Node.js

**Example Pattern for Request Export:**

```tsx
// app/api/reports/requests/excel/route.ts
import ExcelJS from 'exceljs'

export async function GET() {
  const requests = await prisma.request.findMany({
    include: { department: true, requester: true }
  })

  const workbook = new ExcelJS.Workbook()
  const worksheet = workbook.addWorksheet('Requests')

  // Define columns
  worksheet.columns = [
    { header: 'Request ID', key: 'id', width: 15 },
    { header: 'Department', key: 'department', width: 20 },
    { header: 'Status', key: 'status', width: 15 },
    { header: 'Created', key: 'createdAt', width: 20 },
  ]

  // Style header row
  worksheet.getRow(1).font = { bold: true }
  worksheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE0E0E0' }
  }

  // Add data rows
  requests.forEach(request => {
    const row = worksheet.addRow({
      id: request.id,
      department: request.department.name,
      status: request.status,
      createdAt: request.createdAt.toISOString(),
    })

    // Conditional formatting by status
    if (request.status === 'Approved') {
      row.getCell('status').fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFC6EFCE' }
      }
    }
  })

  const buffer = await workbook.xlsx.writeBuffer()

  return new Response(buffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename=requests.xlsx',
    },
  })
}
```

**Note:** App already has `json2csv` (v6.0.0-alpha.2) for CSV export. Keep this for simple tabular exports. Use ExcelJS for formatted Excel reports with styling.

**Source:** [ExcelJS npm](https://www.npmjs.com/package/exceljs), [ExcelJS vs SheetJS Comparison](https://medium.com/@manishasiram/exceljs-alternate-for-xlsx-package-fc1d36b2e743), [Excel Libraries Comparison](https://npm-compare.com/excel4node,exceljs,xlsx,xlsx-populate)

---

## 4. Request Templates

### No New Dependencies Required

**Implementation Strategy:** Use existing stack

| Capability | Technology | Already In Stack |
|------------|------------|------------------|
| Template storage | PostgreSQL + Prisma | Yes |
| Form pre-filling | react-hook-form + Zod | Yes |
| UI components | shadcn/ui (Dialog, Select, Button) | Yes |
| Data management | Server Actions | Yes |

**Database Schema Addition:**

```prisma
model RequestTemplate {
  id          String   @id @default(cuid())
  name        String
  description String?

  // Pre-filled fields
  title       String
  details     String?
  priority    String?

  departmentId String
  department   Department @relation(fields: [departmentId], references: [id])

  createdById  String
  createdBy    User @relation(fields: [createdById], references: [id])

  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}
```

**UI Pattern:**

1. Admin creates templates via new admin page
2. Request creation page shows "Use Template" dropdown
3. Selecting template pre-fills form fields using `form.reset(templateData)`
4. User can modify pre-filled values before submission

**Example Component:**

```tsx
"use client"

import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select"
import { useForm } from "react-hook-form"

export function RequestForm() {
  const form = useForm<RequestFormData>()
  const [templates, setTemplates] = useState<Template[]>([])

  const applyTemplate = (templateId: string) => {
    const template = templates.find(t => t.id === templateId)
    if (template) {
      form.reset({
        title: template.title,
        details: template.details,
        priority: template.priority,
      })
    }
  }

  return (
    <div>
      <Select onValueChange={applyTemplate}>
        <SelectTrigger>
          <SelectValue placeholder="Use a template (optional)" />
        </SelectTrigger>
        <SelectContent>
          {templates.map(t => (
            <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Existing request form fields */}
    </div>
  )
}
```

**Why No Library Needed:**
- Template = database record with pre-filled field values
- react-hook-form already handles form state
- Zod already validates final submission
- No complex logic requiring dedicated library

**Confidence:** HIGH - This is a data modeling problem, not a technical library problem

---

## 5. Mobile-Friendly Responsive Design

### No New Dependencies Required

**Existing Stack Provides Everything:**

| Capability | Technology | Version | Notes |
|------------|------------|---------|-------|
| Responsive utilities | Tailwind CSS | v3.4.1 | Mobile-first breakpoints (sm/md/lg/xl/2xl) |
| Touch-friendly components | shadcn/ui | Latest | All components are mobile-aware |
| Responsive tables | TanStack Table | v8.21.3 | Built-in mobile patterns |
| Mobile viewport | Next.js | v15.1.4 | Auto-generates responsive viewport meta |

**Tailwind Breakpoints (Mobile-First):**

```css
/* Base (mobile): 0-640px - unprefixed utilities */
/* sm: 640px+ - sm: prefix */
/* md: 768px+ - md: prefix */
/* lg: 1024px+ - lg: prefix */
/* xl: 1280px+ - xl: prefix */
/* 2xl: 1536px+ - 2xl: prefix */
```

**Key Pattern:** Start with mobile styles (unprefixed), add desktop styles with `md:` or `lg:` prefix.

**Mobile Responsive Strategy for Approval App:**

### 1. Navigation

```tsx
// Mobile: Bottom navigation or hamburger menu
// Desktop: Sidebar navigation

<div className="flex flex-col md:flex-row">
  {/* Mobile bottom nav */}
  <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t">
    <div className="flex justify-around p-2">
      <Button variant="ghost" size="icon">
        <HomeIcon />
      </Button>
      {/* More nav items */}
    </div>
  </nav>

  {/* Desktop sidebar */}
  <aside className="hidden md:block md:w-64 border-r">
    {/* Sidebar content */}
  </aside>

  <main className="flex-1 pb-16 md:pb-0">
    {/* Page content */}
  </main>
</div>
```

### 2. Tables (Request/Approval Lists)

**Pattern:** Responsive TanStack Table

```tsx
// Mobile: Card layout (stack cells vertically)
// Desktop: Table layout

<div className="md:hidden">
  {/* Mobile: Cards */}
  {requests.map(request => (
    <Card key={request.id}>
      <CardHeader>
        <CardTitle className="text-base">{request.title}</CardTitle>
        <CardDescription>{request.department.name}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="text-sm space-y-1">
          <p>Status: {request.status}</p>
          <p>Date: {format(request.createdAt, 'PP')}</p>
        </div>
      </CardContent>
    </Card>
  ))}
</div>

<div className="hidden md:block">
  {/* Desktop: Table */}
  <Table>
    <TableHeader>
      <TableRow>
        <TableHead>Request ID</TableHead>
        <TableHead>Department</TableHead>
        <TableHead>Status</TableHead>
        <TableHead>Date</TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      {/* Table rows */}
    </TableBody>
  </Table>
</div>
```

### 3. Forms (Request Creation/Approval)

```tsx
// Mobile: Full-width inputs, larger touch targets
// Desktop: Two-column layout

<form className="space-y-4">
  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
    <div className="space-y-2">
      <Label>Title</Label>
      <Input className="h-11 md:h-10" /> {/* Larger on mobile */}
    </div>
    <div className="space-y-2">
      <Label>Priority</Label>
      <Select>
        <SelectTrigger className="h-11 md:h-10">
          <SelectValue />
        </SelectTrigger>
      </Select>
    </div>
  </div>

  <div className="space-y-2">
    <Label>Details</Label>
    <Textarea className="min-h-[120px]" />
  </div>

  <Button className="w-full md:w-auto h-11 md:h-10">
    Submit Request
  </Button>
</form>
```

### 4. Dialogs/Modals

```tsx
// Mobile: Full-screen drawer
// Desktop: Centered dialog

<Dialog>
  <DialogContent className="max-w-full h-full md:max-w-2xl md:h-auto">
    <DialogHeader>
      <DialogTitle>Approval Details</DialogTitle>
    </DialogHeader>
    {/* Content */}
  </DialogContent>
</Dialog>
```

**shadcn/ui Mobile Considerations:**
- All components use relative units (rem, em)
- Touch targets meet WCAG 2.1 guidelines (44x44px minimum)
- Popover/Dropdown components auto-adjust position on small screens
- Sheet component provides drawer pattern for mobile

**Testing Strategy:**
- Chrome DevTools mobile emulation (iPhone SE, Pixel 5)
- Test with real devices if available
- Verify touch targets with accessibility audit
- Test file upload on mobile browsers

**Tailwind Best Practices for This Project:**

1. **Container Queries (if needed):** Tailwind 3.3+ supports `@container` for component-level responsive
2. **Custom Breakpoints (if needed):** Can add `xs: 480px` for small phones in `tailwind.config.ts`
3. **Fluid Typography:** Use `clamp()` for smooth text scaling across devices
4. **Safe Areas:** Use `safe-area-inset` for iOS notch/home indicator

**Confidence:** HIGH - Tailwind CSS v3.4+ provides comprehensive mobile-first responsive design capabilities

**Source:** [Tailwind CSS Responsive Design](https://tailwindcss.com/docs/responsive-design), [Tailwind Mobile Best Practices](https://medium.com/@rameshkannanyt0078/best-practices-for-mobile-responsiveness-with-tailwind-css-5b37e910b91c), [Tailwind CSS Best Practices 2025-2026](https://www.frontendtools.tech/blog/tailwind-css-best-practices-design-system-patterns)

---

## Installation Summary

### New Dependencies

```bash
# Analytics
npm install recharts

# PDF Generation
npm install @react-pdf/renderer

# Excel Export
npm install exceljs
```

### Configuration Changes

```typescript
// next.config.ts
const nextConfig: NextConfig = {
  output: 'standalone', // Enable Docker optimization
};
```

### DevDependencies (if not already installed)

```bash
# Type definitions (check if needed)
npm install -D @types/node  # Already in package.json v22
```

---

## What NOT to Add

| Library/Tool | Why NOT to Add |
|-------------|---------------|
| **Chart.js** | Recharts better for React ecosystem, easier customization |
| **jsPDF** | No React integration, manual positioning, worse DX |
| **Puppeteer** | Overkill for simple reports, requires headless Chrome, slow |
| **SheetJS (xlsx)** | ExcelJS has better API, fewer security issues, active maintenance |
| **PM2** | Next.js standalone mode handles process management, Docker restart policies sufficient |
| **Redis** | App has 30 users, PostgreSQL caching sufficient, premature optimization |
| **Nginx (initially)** | Test without reverse proxy first, add only if needed for SSL/caching |
| **Custom form template library** | Existing react-hook-form + database storage sufficient |
| **Mobile UI library (React Native, Ionic)** | Web-first responsive design meets requirements, native mobile deferred |

---

## Integration Points with Existing Stack

### Recharts + shadcn/ui

- Use shadcn/ui Card components to wrap charts
- Match chart colors to shadcn/ui theme variables (`hsl(var(--primary))`)
- Use same spacing utilities (Tailwind `space-y-4`, `p-6`)

### @react-pdf/renderer + Prisma

- Fetch data with existing Prisma queries
- Transform to PDF components in API routes
- Reuse validation logic from existing Server Actions

### ExcelJS + TanStack Table

- Export currently displayed table data
- Match column definitions from TanStack Table config
- Apply same filters/sorting before export

### Docker + Clerk

- Pass Clerk env vars through docker-compose.yml
- Test authentication flows in local Docker environment
- Monitor for GitHub issue #3683 if auth problems occur

### Templates + react-hook-form

- Use `form.reset()` to apply template values
- Maintain existing Zod validation after template application
- Store templates in PostgreSQL with existing Prisma patterns

---

## Versions Summary (Quick Reference)

| Package | Version | Confidence |
|---------|---------|------------|
| recharts | ^3.7.0 | HIGH (verified npm, React 19 compatible) |
| @react-pdf/renderer | ^4.3.2 | HIGH (verified npm, stable) |
| exceljs | ^4.4.0 | HIGH (verified npm, widely used) |
| Docker | 27+ | HIGH (industry standard) |
| Docker Compose | v2.x | HIGH (current stable) |
| PostgreSQL | 17-alpine | HIGH (Prisma compatible) |
| Node.js | 22-alpine | HIGH (Prisma 7.0+ requirement) |

**All versions verified against official npm registry and compatibility matrices as of 2026-02-13.**

---

## Sources

### Docker & Deployment
- [Next.js 15 Standalone Mode & Docker Optimization](https://javascript.plainenglish.io/next-js-15-self-hosting-with-docker-complete-guide-0826e15236da)
- [Next.js Docker Multi-Stage Best Practices](https://johnnymetz.com/posts/dockerize-nextjs-app/)
- [Next.js Official Output Configuration](https://nextjs.org/docs/pages/api-reference/config/next-config-js/output)
- [PostgreSQL Docker Compose Production Setup](https://medium.com/@abhijariwala/dockerizing-a-next-js-and-node-js-app-with-postgresql-and-prisma-a-complete-guide-000527023e99)
- [Docker Compose Health Checks Guide](https://oneuptime.com/blog/post/2026-01-30-docker-compose-health-checks/view)
- [PostgreSQL Docker Health Checks](https://laurent-bel.medium.com/waiting-for-postgresql-to-start-in-docker-compose-c72271b3c74a)
- [Docker Volumes for Persistent Data](https://oneuptime.com/blog/post/2026-02-02-docker-volumes-persistent-data/view)
- [Docker Volumes Official Documentation](https://docs.docker.com/engine/storage/volumes/)
- [Prisma Migrate Deploy with Docker](https://notiz.dev/blog/prisma-migrate-deploy-with-docker/)
- [Prisma Docker Official Guide](https://www.prisma.io/docs/guides/docker)
- [Next.js Docker Nginx Reverse Proxy](https://collabnix.com/deploying-a-next-js-app-on-https-with-docker-using-nginx-as-a-reverse-proxy/)

### Analytics & Charting
- [Recharts npm Package](https://www.npmjs.com/package/recharts)
- [Recharts vs Chart.js Performance Comparison](https://www.oreateai.com/blog/recharts-vs-chartjs-navigating-the-performance-maze-for-big-data-visualizations/4aff3db4085050dc635fd25267846922)
- [Best React Chart Libraries 2025](https://blog.logrocket.com/best-react-chart-libraries-2025/)
- [Chart.js vs Recharts Comparison](https://www.slant.co/versus/10578/21007/~chart-js_vs_recharts)

### PDF & Excel
- [React PDF Libraries Comparison](https://blog.react-pdf.dev/6-open-source-pdf-generation-and-modification-libraries-every-react-dev-should-know-in-2025)
- [@react-pdf/renderer npm Package](https://www.npmjs.com/package/@react-pdf/renderer)
- [JavaScript PDF Libraries Guide](https://www.nutrient.io/blog/javascript-pdf-libraries/)
- [ExcelJS npm Package](https://www.npmjs.com/package/exceljs)
- [ExcelJS vs SheetJS Comparison](https://medium.com/@manishasiram/exceljs-alternate-for-xlsx-package-fc1d36b2e743)
- [Excel Libraries npm Comparison](https://npm-compare.com/excel4node,exceljs,xlsx,xlsx-populate)

### Mobile Responsive
- [Tailwind CSS Responsive Design Official Docs](https://tailwindcss.com/docs/responsive-design)
- [Tailwind Mobile Best Practices](https://medium.com/@rameshkannanyt0078/best-practices-for-mobile-responsiveness-with-tailwind-css-5b37e910b91c)
- [Tailwind CSS Best Practices 2025-2026](https://www.frontendtools.tech/blog/tailwind-css-best-practices-design-system-patterns)

### Environment & Configuration
- [Clerk Environment Variables](https://clerk.com/docs/guides/development/clerk-environment-variables)
- [Clerk Docker Issue #3683](https://github.com/clerk/javascript/issues/3683)
- [Next.js Form Component](https://nextjs.org/docs/app/api-reference/components/form)

---

*Stack research for v1.1: Production Deployment + Analytics & UX*
*Researched: February 13, 2026*
