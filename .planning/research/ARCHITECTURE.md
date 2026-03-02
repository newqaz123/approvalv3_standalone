# Architecture Integration: v1.1 Features

**Project:** ApprovalAppV2 (Existing Next.js 15 System)
**Milestone:** v1.1 Production Deployment + Analytics & UX
**Researched:** 2026-02-13
**Confidence:** HIGH

## Executive Summary

This document describes how five new feature sets integrate with an existing Next.js 15 + Prisma + PostgreSQL approval workflow system (~22k LOC). The architecture maintains existing patterns (Server Components, Server Actions, Clerk auth) while adding deployment infrastructure, analytics, reporting, templates, and mobile optimization.

**Integration Approach:** Extend, don't rewrite. All new features leverage existing components and patterns.

## Existing Architecture Overview

### Current Stack
- **Framework:** Next.js 15 (App Router, Server Components, Server Actions)
- **Database:** PostgreSQL with Prisma ORM
- **Auth:** Clerk (JWT metadata + database verification)
- **UI:** shadcn/ui components with Tailwind CSS
- **Data Tables:** TanStack Table
- **File Storage:** Local filesystem (public/uploads/)
- **Email:** Resend
- **TypeScript:** 22,172 LOC across ~150 files

### Current Route Structure
```
/
├── (auth)                 # Sign in/up
├── (dashboard)            # Main app
│   ├── /dashboard         # Overview + workflow
│   ├── /requests          # Request CRUD, detail view
│   │   ├── /new           # Request form (uses RequestForm component)
│   │   ├── /my-actions    # Pending approvals
│   │   └── /[requestId]   # Request detail
│   └── /engineering       # Engineering solutions
│       └── /solutions/[requestId]
└── /admin                 # Admin tools
    ├── /departments       # Department management
    ├── /users             # User management
    ├── /hierarchy         # Approval hierarchy
    ├── /audit             # Audit trail export
    └── /retention         # Data retention
```

### Current Data Model (Key Tables)
- **User:** Clerk ID, department, role, level (hierarchy)
- **Department:** 12 departments with type (GENERAL/ENGINEERING), levelNames (JSON)
- **Request:** Core workflow entity with status, approvals, files
- **RequestActivity:** Immutable audit trail (PostgreSQL triggers prevent updates/deletes)
- **RequestApproval:** Level-based approval tracking
- **FileAttachment:** Metadata for local file storage (filePath relative to public/uploads/)
- **Notification:** In-app notifications
- **Solution:** Engineering solutions with separate approval chain
- **DepartmentApprover:** Cross-department approver assignments

### Current File Storage Pattern
```typescript
// src/lib/files.ts
export function generateFilePath(requestId: string, fileName: string): string {
  const uuid = crypto.randomUUID()
  return join('uploads', requestId, `${uuid}-${fileName}`)
}

export async function saveFile(filePath: string, file: Buffer): Promise<void> {
  const fullPath = join(process.cwd(), 'public', filePath)
  await mkdir(dir, { recursive: true })
  await writeFile(fullPath, file)
}
```

Files stored: `public/uploads/{requestId}/{uuid}-{filename}`

### Current Export Pattern
```typescript
// src/lib/export.ts
export function generateCSVExport(activities: AuditActivityRecord[]): string
export function generateJSONExport(requests: RequestSnapshot[]): string
```

Uses json2csv library. Exports served via API routes with streaming responses.

---

## Feature 1: Docker Compose Deployment

### Integration Approach
Containerize existing application with multi-service Docker Compose setup.

### Architecture

#### Services
```yaml
version: '3.9'
services:
  app:                    # Next.js application
  db:                     # PostgreSQL database
  # Optional future services:
  # redis:                # Session/cache layer
  # nginx:                # Reverse proxy (for production)
```

#### Multi-Stage Dockerfile
```dockerfile
# Stage 1: Dependencies
FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

# Stage 2: Builder
FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED 1
RUN npm run build

# Stage 3: Runner (Production)
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV production
ENV NEXT_TELEMETRY_DISABLED 1

# Create non-root user
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy standalone output
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

USER nextjs
EXPOSE 3000
ENV PORT 3000
CMD ["node", "server.js"]
```

### Volume Strategy

#### Database Volume
```yaml
volumes:
  pgdata:/var/lib/postgresql/data
```

**Why:** Persist database data across container restarts.

#### File Upload Volume
```yaml
volumes:
  - ./uploads:/app/public/uploads
```

**Why:** Persist uploaded files. Maps local directory to container.

**Migration Path:**
1. Copy existing `public/uploads/` to `./uploads/` on host
2. Mount as volume in docker-compose.yml
3. Update environment variables if needed (UPLOAD_DIR defaults to public/uploads)

### Configuration Changes Required

#### 1. next.config.ts
```typescript
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",  // ADD THIS
};

export default nextConfig;
```

**Why:** Enables Next.js standalone mode. Creates `.next/standalone` folder with minimal dependencies (reduces Docker image from 1GB+ to ~200MB).

#### 2. docker-compose.yml
```yaml
version: '3.9'

services:
  app:
    build:
      context: .
      dockerfile: Dockerfile
    ports:
      - "3000:3000"
    environment:
      - DATABASE_URL=postgresql://postgres:password@db:5432/approvalapp
      - NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=${NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY}
      - CLERK_SECRET_KEY=${CLERK_SECRET_KEY}
      - CLERK_WEBHOOK_SECRET=${CLERK_WEBHOOK_SECRET}
      - UPLOAD_DIR=/app/public/uploads
    volumes:
      - ./uploads:/app/public/uploads
    depends_on:
      db:
        condition: service_healthy
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "node", "-e", "require('http').get('http://localhost:3000/api/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s

  db:
    image: postgres:16-alpine
    environment:
      - POSTGRES_USER=postgres
      - POSTGRES_PASSWORD=password
      - POSTGRES_DB=approvalapp
    volumes:
      - pgdata:/var/lib/postgresql/data
    ports:
      - "5432:5432"
    restart: unless-stopped
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 10s
      timeout: 5s
      retries: 5

volumes:
  pgdata:
```

#### 3. New API Route for Health Check
```
src/app/api/health/route.ts
```

**Purpose:** Container orchestration health checks.

**Implementation:**
```typescript
export async function GET() {
  return Response.json({ status: 'ok', timestamp: new Date().toISOString() })
}
```

### Integration Points

| Component | Modification | Reason |
|-----------|--------------|--------|
| next.config.ts | Add `output: "standalone"` | Enable standalone mode for Docker optimization |
| .dockerignore | Create with node_modules, .git, .next, etc. | Reduce build context size |
| .env.local | Create .env.example for Docker | Document required environment variables |
| package.json scripts | Add `docker:build`, `docker:up`, `docker:down` | Developer convenience |

### No Code Changes Required

Existing application code works without modification. File storage via `src/lib/files.ts` continues to use `public/uploads/` which is now mounted as volume.

---

## Feature 2: Analytics Dashboard

### Integration Approach
Server Components for data aggregation + charting library for visualization. No client-side state management needed.

### Recommended Charting Library: Recharts

**Why Recharts:**
- React-native component architecture (fits Next.js patterns)
- SVG rendering (crisp on all screens)
- Good TypeScript support
- Moderate dataset performance (sufficient for approval metrics)
- Simple API (faster development)

**Alternatives considered:**
- **ECharts:** Better for huge datasets (10k+ points), steeper learning curve, Canvas rendering
- **Chart.js:** Canvas-based, not React-native, requires wrapper library (react-chartjs-2)

**Decision:** Recharts unless analytics shows >10k data points per chart (unlikely for approval metrics).

### New Components

#### 1. Analytics Dashboard Page
```
src/app/(dashboard)/analytics/page.tsx
```

**Architecture:**
```typescript
// Server Component - fetches data
export default async function AnalyticsPage() {
  const metrics = await getApprovalMetrics() // Server-side data fetch
  return <AnalyticsView metrics={metrics} />
}
```

#### 2. Analytics View Component
```
src/components/analytics/analytics-view.tsx
```

**Client Component for interactivity:**
```typescript
'use client'

import { LineChart, BarChart, PieChart } from 'recharts'

export function AnalyticsView({ metrics }: { metrics: MetricsData }) {
  // Charts with user interactions (tooltips, legends, filters)
}
```

#### 3. Metrics Data Fetching
```
src/lib/metrics.ts
```

**Server-side aggregation:**
```typescript
export async function getApprovalMetrics() {
  // Use Prisma aggregations
  const requestsByStatus = await prisma.request.groupBy({
    by: ['status'],
    _count: true,
    where: { isDeleted: false }
  })

  const requestsByDepartment = await prisma.request.groupBy({
    by: ['departmentId'],
    _count: true,
    where: { isDeleted: false }
  })

  // Average approval time
  const approvalTimes = await prisma.requestApproval.aggregate({
    _avg: {
      // Calculate time diff between createdAt and approvedAt
    },
    where: { status: 'approved' }
  })

  return { requestsByStatus, requestsByDepartment, approvalTimes }
}
```

### Data Queries

#### Key Metrics to Display

1. **Request Volume Over Time**
   - Query: Requests grouped by date range (daily/weekly/monthly)
   - Chart: Line chart
   - Index: Already exists on `requests.createdAt`

2. **Requests by Status**
   - Query: Count by RequestStatus enum
   - Chart: Pie chart or bar chart
   - Index: Already exists on `requests.status`

3. **Requests by Department**
   - Query: Count by departmentId with department name join
   - Chart: Bar chart
   - Index: Already exists on `requests.departmentId`

4. **Average Approval Time**
   - Query: Time difference between RequestApproval.createdAt and approvedAt
   - Chart: Bar chart by level or department
   - Index: Already exists on `request_approvals.status`

5. **Top Approvers**
   - Query: Count by approverId from RequestApproval
   - Chart: Bar chart
   - Index: Already exists on `request_approvals.approverId`

6. **Request Activity Trends**
   - Query: RequestActivity grouped by action type and date
   - Chart: Stacked area chart
   - Index: Already exists on `request_activities.createdAt`

### Route Updates

Add to navbar:
```typescript
// src/components/navigation/navbar.tsx
const navItems = [
  { label: 'Dashboard', href: '/dashboard' },
  { label: 'Requests', href: '/requests' },
  { label: 'Analytics', href: '/analytics' },  // NEW
  // ...
]
```

### Dependencies to Add

```json
{
  "dependencies": {
    "recharts": "^2.15.0"
  },
  "devDependencies": {
    "@types/recharts": "^1.8.29"
  }
}
```

### Integration Points

| Component | Modification | Reason |
|-----------|--------------|--------|
| Navbar | Add /analytics link | Navigation |
| Prisma queries | New aggregation functions in src/lib/metrics.ts | Data fetching |
| shadcn/ui Card | Wrap charts for consistent styling | UI consistency |

### Performance Considerations

- **Caching:** Use Next.js Data Cache with revalidation
  ```typescript
  const metrics = await getApprovalMetrics()
  revalidatePath('/analytics') // Or use revalidate: 3600 in fetch
  ```

- **Pagination:** For large datasets (e.g., activity timeline), use TanStack Table with existing patterns

- **Database indexes:** All required indexes already exist (verified from schema)

---

## Feature 3: PDF/Excel Reporting

### Integration Approach
Extend existing export pattern (`src/lib/export.ts`) with PDF generation. Excel export pattern already exists (CSV via json2csv).

### Recommended PDF Library: Puppeteer

**Why Puppeteer:**
- Pixel-perfect HTML/CSS rendering (can reuse existing component styles)
- Handles complex layouts (approval chains, activity timelines)
- Server-side only (secure, no client exposure)
- Matches web styling (consistent brand)

**Alternatives considered:**
- **react-pdf:** JSX-based, limited styling, requires separate templates
- **jsPDF:** Client-side only, basic layouts, poor complex HTML support

**Decision:** Puppeteer for PDF, existing json2csv for Excel/CSV.

### Architecture

#### Server Action Pattern
```typescript
// src/app/actions/report-actions.ts
'use server'

import { generateRequestPDF } from '@/lib/pdf'

export async function exportRequestAsPDF(requestId: string) {
  const request = await prisma.request.findUnique({
    where: { id: requestId },
    include: { /* full snapshot */ }
  })

  const pdfBuffer = await generateRequestPDF(request)

  // Return as base64 for download
  return {
    data: pdfBuffer.toString('base64'),
    filename: `request-${requestId}.pdf`,
    contentType: 'application/pdf'
  }
}
```

#### PDF Generation Library
```typescript
// src/lib/pdf.ts
import puppeteer from 'puppeteer'

export async function generateRequestPDF(request: RequestSnapshot): Promise<Buffer> {
  const browser = await puppeteer.launch({ headless: true })
  const page = await browser.newPage()

  // Generate HTML from template
  const html = renderRequestTemplate(request)
  await page.setContent(html)

  const pdf = await page.pdf({
    format: 'A4',
    printBackground: true,
    margin: { top: '20mm', right: '20mm', bottom: '20mm', left: '20mm' }
  })

  await browser.close()
  return Buffer.from(pdf)
}

function renderRequestTemplate(request: RequestSnapshot): string {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        /* Reuse Tailwind styles or custom PDF CSS */
        body { font-family: sans-serif; }
        .header { border-bottom: 2px solid #000; padding-bottom: 10px; }
        /* ... */
      </style>
    </head>
    <body>
      <div class="header">
        <h1>Request: ${request.title}</h1>
        <p>Request ID: ${request.id}</p>
        <p>Status: ${request.status}</p>
      </div>

      <div class="content">
        <h2>Description</h2>
        <p>${request.description}</p>

        <h2>Approval Chain</h2>
        <table>
          ${request.approvals.map(a => `
            <tr>
              <td>${a.requiredLevel}</td>
              <td>${a.approver?.name || 'Pending'}</td>
              <td>${a.status}</td>
            </tr>
          `).join('')}
        </table>

        <h2>Activity Timeline</h2>
        ${request.activities.map(a => `
          <div class="activity">
            <strong>${a.user.name}</strong> - ${a.action}
            <br>${new Date(a.createdAt).toLocaleString()}
          </div>
        `).join('')}
      </div>
    </body>
    </html>
  `
}
```

### Excel Export Enhancement

Existing CSV export works. Enhance for true Excel format with formatting:

```typescript
// Option 1: Keep existing CSV (simplest)
// Current: src/lib/export.ts with json2csv

// Option 2: Add true Excel with formatting
// npm install exceljs
import ExcelJS from 'exceljs'

export async function generateExcelReport(requests: RequestSnapshot[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  const worksheet = workbook.addWorksheet('Requests')

  // Headers with styling
  worksheet.columns = [
    { header: 'Request ID', key: 'id', width: 15 },
    { header: 'Title', key: 'title', width: 30 },
    { header: 'Status', key: 'status', width: 20 },
    { header: 'Department', key: 'department', width: 20 },
    { header: 'Created', key: 'createdAt', width: 20 }
  ]

  // Add data
  requests.forEach(r => {
    worksheet.addRow({
      id: r.id,
      title: r.title,
      status: r.status,
      department: r.department?.name,
      createdAt: r.createdAt
    })
  })

  // Style header row
  worksheet.getRow(1).font = { bold: true }
  worksheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE0E0E0' }
  }

  const buffer = await workbook.xlsx.writeBuffer()
  return Buffer.from(buffer)
}
```

### New Components

#### 1. Export Dropdown Component
```
src/components/reports/export-dropdown.tsx
```

```typescript
'use client'

import { DropdownMenu } from '@/components/ui/dropdown-menu'
import { exportRequestAsPDF, exportRequestAsExcel } from '@/app/actions/report-actions'

export function ExportDropdown({ requestId }: { requestId: string }) {
  const handlePDFExport = async () => {
    const result = await exportRequestAsPDF(requestId)
    // Download via blob URL
    const blob = new Blob([Buffer.from(result.data, 'base64')],
      { type: 'application/pdf' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = result.filename
    a.click()
  }

  const handleExcelExport = async () => {
    // Similar pattern
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger>Export</DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem onClick={handlePDFExport}>
          Export as PDF
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleExcelExport}>
          Export as Excel
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
```

#### 2. Bulk Report Generation (Admin)
```
src/app/(admin)/admin/reports/page.tsx
```

**Server Component with filters:**
```typescript
export default async function ReportsPage() {
  const departments = await prisma.department.findMany()

  return (
    <div>
      <h1>Generate Reports</h1>
      <BulkReportForm departments={departments} />
    </div>
  )
}
```

```
src/components/reports/bulk-report-form.tsx
```

**Client Component with date range picker:**
```typescript
'use client'

export function BulkReportForm({ departments }) {
  const [dateRange, setDateRange] = useState({ start: null, end: null })
  const [selectedDepartments, setSelectedDepartments] = useState([])
  const [format, setFormat] = useState('pdf')

  const handleGenerate = async () => {
    const result = await generateBulkReport({
      dateRange,
      departments: selectedDepartments,
      format
    })
    // Download
  }

  return (
    <form>
      {/* Date range picker (shadcn Calendar + Popover) */}
      {/* Department multi-select (shadcn Checkbox) */}
      {/* Format radio (PDF/Excel/CSV) */}
      <Button onClick={handleGenerate}>Generate Report</Button>
    </form>
  )
}
```

### Dependencies to Add

```json
{
  "dependencies": {
    "puppeteer": "^22.0.0",
    "exceljs": "^4.4.0"  // Optional, for true Excel format
  },
  "devDependencies": {
    "@types/puppeteer": "^7.0.4"
  }
}
```

### Docker Considerations

Puppeteer requires Chromium. Update Dockerfile:

```dockerfile
# Stage 3: Runner
FROM node:22-alpine AS runner

# Install Chromium for Puppeteer
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont

ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

# ... rest of Dockerfile
```

### Integration Points

| Component | Modification | Reason |
|-----------|--------------|--------|
| Request detail page | Add ExportDropdown | Per-request export |
| Admin reports page | New page with BulkReportForm | Bulk reporting |
| Audit export API | Extend with PDF option | Audit trail reports |
| src/lib/export.ts | Add generateRequestPDF | PDF generation logic |

---

## Feature 4: Request Templates

### Integration Approach
New database table + admin CRUD UI + template selection in request form.

### Database Schema Changes

#### New Model: RequestTemplate
```prisma
// Add to schema.prisma
model RequestTemplate {
  id          String   @id @default(cuid())
  name        String   @unique
  description String?  @db.Text

  // Pre-filled fields
  titleTemplate       String?
  descriptionTemplate String  @db.Text

  // Department constraints
  departmentId String?  // If set, template only available to this department
  department   Department? @relation(fields: [departmentId], references: [id])

  isActive     Boolean  @default(true)

  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  @@index([departmentId])
  @@index([isActive])
  @@map("request_templates")
}

// Update Department model
model Department {
  // ... existing fields
  requestTemplates RequestTemplate[]  // ADD THIS
}
```

#### Migration
```bash
npx prisma migrate dev --name add_request_templates
```

### New Admin UI

#### 1. Template Management Page
```
src/app/(admin)/admin/templates/page.tsx
```

**Server Component listing templates:**
```typescript
export default async function TemplatesPage() {
  const templates = await prisma.requestTemplate.findMany({
    include: { department: true },
    orderBy: { name: 'asc' }
  })

  return (
    <div>
      <div className="flex justify-between">
        <h1>Request Templates</h1>
        <CreateTemplateDialog />
      </div>
      <TemplateTable templates={templates} />
    </div>
  )
}
```

#### 2. Template CRUD Components
```
src/components/admin/templates/create-template-dialog.tsx
src/components/admin/templates/edit-template-dialog.tsx
src/components/admin/templates/template-table.tsx
```

**Pattern mirrors existing admin components:**
- Dialog with shadcn/ui Dialog component
- Form with react-hook-form + zod validation
- Server Actions for mutations

```typescript
// src/app/actions/template-actions.ts
'use server'

export async function createTemplate(data: CreateTemplateInput) {
  const session = await auth()
  if (!session.userId || session.role !== 'admin') {
    throw new Error('Unauthorized')
  }

  const template = await prisma.requestTemplate.create({
    data: {
      name: data.name,
      description: data.description,
      titleTemplate: data.titleTemplate,
      descriptionTemplate: data.descriptionTemplate,
      departmentId: data.departmentId,
    }
  })

  revalidatePath('/admin/templates')
  return template
}
```

### Request Form Integration

#### Update RequestForm Component
```
src/components/requests/request-form.tsx
```

**Add template selector at top:**
```typescript
'use client'

export function RequestForm() {
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null)
  const [templates, setTemplates] = useState<RequestTemplate[]>([])

  useEffect(() => {
    // Fetch templates for user's department
    fetchTemplatesForDepartment(user.departmentId).then(setTemplates)
  }, [user.departmentId])

  const handleTemplateSelect = (templateId: string) => {
    const template = templates.find(t => t.id === templateId)
    if (template) {
      form.setValue('title', template.titleTemplate || '')
      form.setValue('description', template.descriptionTemplate || '')
    }
    setSelectedTemplate(templateId)
  }

  return (
    <form>
      {/* NEW: Template selector */}
      <div className="mb-4">
        <Label>Start from template (optional)</Label>
        <Select value={selectedTemplate} onValueChange={handleTemplateSelect}>
          <SelectTrigger>
            <SelectValue placeholder="Select a template..." />
          </SelectTrigger>
          <SelectContent>
            {templates.map(t => (
              <SelectItem key={t.id} value={t.id}>
                {t.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {selectedTemplate && (
          <p className="text-sm text-muted-foreground mt-1">
            Template applied. You can edit fields below.
          </p>
        )}
      </div>

      {/* EXISTING: Title, description, file upload */}
      {/* ... */}
    </form>
  )
}
```

#### Template Fetching
```typescript
// src/lib/templates.ts
export async function getTemplatesForDepartment(departmentId: string) {
  return await prisma.requestTemplate.findMany({
    where: {
      isActive: true,
      OR: [
        { departmentId: departmentId },  // Department-specific
        { departmentId: null }           // Global templates
      ]
    },
    orderBy: { name: 'asc' }
  })
}
```

### Integration Points

| Component | Modification | Reason |
|-----------|--------------|--------|
| schema.prisma | Add RequestTemplate model | Data storage |
| Navbar (admin section) | Add /admin/templates link | Navigation |
| RequestForm | Add template selector | Template application |
| Admin templates page | New CRUD UI | Template management |

---

## Feature 5: Mobile Responsive Design

### Integration Approach
Enhance existing shadcn/ui components with mobile-specific patterns. No architectural changes needed.

### Current Mobile Support

shadcn/ui components are built on Radix UI primitives which are touch-friendly. Current implementation likely has basic responsive layouts via Tailwind breakpoints.

### Enhancement Strategy

#### 1. Responsive Navigation
```
src/components/navigation/navbar.tsx
```

**Add mobile menu sheet:**
```typescript
'use client'

import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet'
import { Menu } from 'lucide-react'

export function Navbar() {
  return (
    <nav className="border-b">
      <div className="container mx-auto px-4">
        <div className="flex items-center justify-between h-16">
          <Logo />

          {/* Desktop Navigation */}
          <div className="hidden md:flex space-x-4">
            <NavLinks />
          </div>

          {/* Mobile Menu Trigger */}
          <Sheet>
            <SheetTrigger asChild className="md:hidden">
              <Button variant="ghost" size="icon">
                <Menu className="h-6 w-6" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left">
              <nav className="flex flex-col space-y-4 mt-8">
                <NavLinks vertical />
              </nav>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </nav>
  )
}
```

#### 2. Responsive Data Tables

**Current:** TanStack Table (existing implementation)

**Enhancement:** Add responsive column hiding

```typescript
// src/components/dashboard/dashboard-table.tsx
const columns = [
  {
    accessorKey: 'id',
    header: 'ID',
    size: 100,
    enableHiding: true,
    // Hide on mobile
    className: 'hidden sm:table-cell'
  },
  {
    accessorKey: 'title',
    header: 'Title',
    // Always visible
  },
  {
    accessorKey: 'status',
    header: 'Status',
    size: 120,
  },
  {
    accessorKey: 'department',
    header: 'Department',
    // Hide on mobile
    className: 'hidden md:table-cell'
  },
  {
    accessorKey: 'createdAt',
    header: 'Created',
    // Hide on mobile
    className: 'hidden lg:table-cell'
  }
]
```

**Mobile card view for small screens:**
```typescript
// Add to table component
<div className="md:hidden">
  {/* Mobile card view */}
  {data.map(request => (
    <Card key={request.id} className="mb-2">
      <CardHeader>
        <CardTitle className="text-sm">{request.title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-1 text-xs">
          <p><strong>Status:</strong> {request.status}</p>
          <p><strong>Department:</strong> {request.department}</p>
          <p><strong>Created:</strong> {formatDate(request.createdAt)}</p>
        </div>
      </CardContent>
    </Card>
  ))}
</div>

<div className="hidden md:block">
  {/* Desktop table view */}
  <Table>...</Table>
</div>
```

#### 3. Responsive Forms

**Pattern:** Use shadcn/ui Field components with `orientation="responsive"`

```typescript
// src/components/requests/request-form.tsx
<div className="space-y-4">
  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
    <div>
      <Label>Title</Label>
      <Input {...field} className="w-full" />
    </div>
    <div>
      <Label>Department</Label>
      <Select {...field} className="w-full" />
    </div>
  </div>

  <div>
    <Label>Description</Label>
    <Textarea {...field} className="w-full" rows={6} />
  </div>
</div>
```

**Mobile considerations:**
- Single column on mobile (`grid-cols-1`)
- Two columns on tablet+ (`md:grid-cols-2`)
- Full-width inputs (`w-full`)
- Larger touch targets (default shadcn/ui sizes already 44px+)

#### 4. Responsive Dialogs

**Current:** shadcn/ui Dialog

**Enhancement:** Full-screen on mobile

```typescript
// src/components/ui/dialog.tsx (customize)
const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        "fixed left-[50%] top-[50%] z-50",
        "w-full max-w-lg", // Default desktop
        "max-h-screen overflow-y-auto", // Scrollable
        // Mobile: full screen
        "sm:max-w-lg sm:rounded-lg",
        "max-sm:top-0 max-sm:left-0 max-sm:translate-x-0 max-sm:translate-y-0",
        "max-sm:w-screen max-sm:h-screen max-sm:rounded-none",
        className
      )}
      {...props}
    >
      {children}
    </DialogPrimitive.Content>
  </DialogPortal>
))
```

#### 5. Responsive Approval Actions

**Current:** Approval buttons in request detail page

**Enhancement:** Bottom sheet on mobile

```typescript
// src/components/approvals/approval-actions.tsx
'use client'

export function ApprovalActions({ request }: { request: Request }) {
  return (
    <>
      {/* Desktop: sidebar actions */}
      <div className="hidden md:block">
        <Card>
          <CardHeader>
            <CardTitle>Actions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <ApprovalActionButtons request={request} />
          </CardContent>
        </Card>
      </div>

      {/* Mobile: fixed bottom bar */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 bg-background border-t p-4">
        <ApprovalActionButtons request={request} />
      </div>
    </>
  )
}
```

#### 6. Viewport Meta Tag

Ensure proper mobile rendering:

```typescript
// src/app/layout.tsx
export const metadata = {
  viewport: 'width=device-width, initial-scale=1, maximum-scale=5',
  // ... other metadata
}
```

### Testing Strategy

Use existing Playwright tests with viewport configuration:

```typescript
// playwright.config.ts
export default defineConfig({
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile',
      use: { ...devices['iPhone 13'] },  // ADD THIS
    },
    {
      name: 'tablet',
      use: { ...devices['iPad Pro'] },   // ADD THIS
    },
  ],
})
```

### Integration Points

| Component | Modification | Reason |
|-----------|--------------|--------|
| Navbar | Add Sheet mobile menu | Mobile navigation |
| Data tables | Add responsive columns + card view | Mobile data display |
| Forms | Add responsive grid layouts | Mobile form UX |
| Dialogs | Add full-screen mobile variant | Mobile modal UX |
| Approval actions | Add fixed bottom bar | Mobile action accessibility |

---

## Build Order & Dependencies

### Phase Sequencing

```
Phase 1: Docker Infrastructure (1-2 days)
├── Enables: Local development consistency, staging deployment
├── Blocks: Nothing (can be done in parallel)
└── Deliverable: docker-compose.yml + Dockerfile working locally

Phase 2: Request Templates (2-3 days)
├── Enables: Template-based request creation
├── Depends on: Nothing (pure feature addition)
└── Deliverable: Admin template CRUD + template selector in form

Phase 3: Mobile Responsive (3-4 days)
├── Enables: Mobile user access
├── Depends on: Nothing (enhancement of existing UI)
└── Deliverable: Responsive navigation, tables, forms, dialogs

Phase 4: Analytics Dashboard (3-4 days)
├── Enables: Request metrics visibility
├── Depends on: Mobile responsive (so charts work on mobile)
└── Deliverable: /analytics page with Recharts visualizations

Phase 5: PDF/Excel Reporting (4-5 days)
├── Enables: Formal reports for stakeholders
├── Depends on: Docker (Puppeteer needs Chromium in container)
└── Deliverable: Export dropdown + bulk report generation
```

**Rationale:**
1. **Docker first:** Establishes deployment infrastructure, unblocks staging environment
2. **Templates early:** High user value, no dependencies, can be developed in parallel with mobile
3. **Mobile before analytics:** Charts need to work on mobile, easier to test analytics on responsive foundation
4. **Reporting last:** Most complex (Puppeteer setup), benefits from Docker infrastructure being ready

### Parallel Development Opportunities

- **Docker + Templates:** Independent, can be done simultaneously by different developers
- **Mobile + Analytics:** Mobile can start first, analytics integrates later
- **All features can be developed in feature branches** and merged incrementally

---

## Data Flow Diagrams

### Current Request Workflow (Unchanged)
```
User fills form
  ↓
Server Action validates + creates Request
  ↓
Prisma writes to PostgreSQL
  ↓
Approval chain created (RequestApproval records)
  ↓
Notifications sent (Notification records + email)
  ↓
Server Component re-renders with updated data
```

### New: Analytics Data Flow
```
User visits /analytics
  ↓
Server Component fetches metrics (Prisma aggregations)
  ↓
Data passed to Client Component
  ↓
Recharts renders charts (SVG, client-side)
  ↓
User interacts (tooltips, filters)
  ↓
Client state updates (no server re-fetch for interactions)
```

### New: Template Application Flow
```
User opens new request form
  ↓
Client Component fetches templates (Server Action)
  ↓
User selects template
  ↓
Client state updates (form.setValue)
  ↓
User modifies pre-filled fields
  ↓
Form submission (existing workflow)
```

### New: PDF Export Flow
```
User clicks "Export as PDF"
  ↓
Client Component calls Server Action
  ↓
Server Action fetches request data (Prisma)
  ↓
Puppeteer launches headless Chrome
  ↓
HTML template rendered to PDF
  ↓
PDF buffer returned to client (base64)
  ↓
Client triggers download (Blob URL)
```

### New: Docker File Storage Flow
```
User uploads file
  ↓
API route /api/upload receives multipart form data
  ↓
src/lib/files.ts saves to public/uploads/{requestId}/
  ↓
Docker volume persists file (./uploads → /app/public/uploads)
  ↓
FileAttachment record created in database
  ↓
File accessible via Next.js static serving (/{filePath})
```

---

## Component Architecture Map

```
src/
├── app/
│   ├── (auth)/                     # Existing auth routes
│   ├── (dashboard)/
│   │   ├── dashboard/              # Existing dashboard
│   │   ├── requests/               # Existing request CRUD
│   │   ├── engineering/            # Existing engineering
│   │   └── analytics/              # NEW: Analytics dashboard
│   │       └── page.tsx            # Server Component with metrics
│   ├── (admin)/
│   │   └── admin/
│   │       ├── templates/          # NEW: Template management
│   │       │   └── page.tsx
│   │       └── reports/            # NEW: Bulk report generation
│   │           └── page.tsx
│   ├── api/
│   │   ├── upload/                 # Existing file upload
│   │   ├── health/                 # NEW: Docker health check
│   │   └── audit/export/           # Existing audit export (extend with PDF)
│   └── actions/
│       ├── template-actions.ts     # NEW: Template CRUD
│       └── report-actions.ts       # NEW: PDF/Excel export
├── components/
│   ├── analytics/                  # NEW: Chart components
│   │   ├── analytics-view.tsx      # Client Component with Recharts
│   │   ├── metrics-card.tsx
│   │   └── date-range-filter.tsx
│   ├── reports/                    # NEW: Export components
│   │   ├── export-dropdown.tsx
│   │   └── bulk-report-form.tsx
│   ├── admin/templates/            # NEW: Template admin UI
│   │   ├── create-template-dialog.tsx
│   │   ├── edit-template-dialog.tsx
│   │   └── template-table.tsx
│   ├── requests/
│   │   └── request-form.tsx        # MODIFIED: Add template selector
│   ├── navigation/
│   │   └── navbar.tsx              # MODIFIED: Add mobile Sheet menu
│   └── ui/                         # Existing shadcn/ui (some mobile enhancements)
└── lib/
    ├── metrics.ts                  # NEW: Analytics data queries
    ├── pdf.ts                      # NEW: Puppeteer PDF generation
    ├── templates.ts                # NEW: Template queries
    ├── export.ts                   # EXISTING (extend with Excel via exceljs)
    └── files.ts                    # EXISTING (no changes, works with Docker volumes)
```

---

## Database Schema Changes Summary

### New Tables

```sql
-- RequestTemplate (add to existing schema)
CREATE TABLE request_templates (
  id TEXT PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  description TEXT,
  title_template TEXT,
  description_template TEXT NOT NULL,
  department_id TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now(),
  FOREIGN KEY (department_id) REFERENCES departments(id)
);

CREATE INDEX idx_request_templates_department ON request_templates(department_id);
CREATE INDEX idx_request_templates_active ON request_templates(is_active);
```

### No Changes to Existing Tables

All other features (Docker, analytics, reporting, mobile) require zero database schema changes.

---

## Environment Variables

### Existing
```bash
DATABASE_URL=postgresql://...
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
CLERK_WEBHOOK_SECRET=whsec_...
UPLOAD_DIR=public/uploads  # Optional, defaults correctly
CRON_SECRET=...
```

### New (Docker-specific)
```bash
# For Docker Compose internal networking
DATABASE_URL=postgresql://postgres:password@db:5432/approvalapp

# For Puppeteer in Docker
PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
```

---

## Security Considerations

### Docker
- Run as non-root user (nextjs:nodejs)
- Use secrets management for production (not environment variables in docker-compose.yml)
- Network isolation (services on internal network, only app exposed)

### PDF Generation
- Server-side only (Puppeteer never exposed to client)
- Validate user authorization before generating reports
- Sanitize HTML templates to prevent XSS

### File Uploads
- Docker volume permissions (chown nextjs:nodejs)
- Same upload restrictions (10MB, allowed file types)
- Path traversal prevention (already handled by src/lib/files.ts UUID naming)

---

## Performance Implications

### Docker
- **Build time:** Multi-stage reduces final image to ~200MB (vs 1GB+ unoptimized)
- **Startup time:** Standalone mode faster startup (~2s vs ~10s)
- **Volume I/O:** File uploads slightly slower than bare metal (negligible for <10MB files)

### Analytics
- **Database queries:** Use existing indexes (no performance impact)
- **Caching:** Implement Next.js Data Cache with 1-hour revalidation
- **Rendering:** SVG charts (Recharts) perform well on modern devices

### PDF Generation
- **CPU-intensive:** Puppeteer launches Chrome (~500MB RAM per instance)
- **Mitigation:** Queue system for bulk reports (out of scope for v1.1, manual throttling acceptable)
- **Caching:** Cache generated PDFs by request ID + updated_at timestamp

### Templates
- **Negligible impact:** Simple SELECT queries, small data size

### Mobile
- **No performance impact:** CSS-only responsive design, no additional JS

---

## Testing Strategy

### Docker
- **Local:** `docker-compose up` works with seed data
- **CI/CD:** GitHub Actions build and push to registry
- **Staging:** Deploy to staging server with docker-compose

### Analytics
- **Unit:** Test Prisma aggregation functions
- **Integration:** Playwright E2E tests for /analytics page
- **Visual:** Screenshot comparison of charts

### Reporting
- **Unit:** Test PDF generation with fixture data
- **Integration:** Playwright downloads and validates PDF/Excel files
- **Load:** Generate 100 PDFs in sequence (manual testing acceptable)

### Templates
- **Unit:** Test template application in form
- **E2E:** Playwright selects template, verifies pre-fill, submits request

### Mobile
- **E2E:** Playwright with iPhone 13 and iPad Pro viewports
- **Manual:** Test on real devices (iOS Safari, Android Chrome)

---

## Rollout Strategy

### Phase 1: Docker (Week 1)
- Deploy to staging with docker-compose
- Verify existing functionality works
- Train team on docker-compose commands

### Phase 2: Templates (Week 1-2)
- Admin creates templates in staging
- Select users test template application
- Gather feedback, iterate

### Phase 3: Mobile (Week 2-3)
- Deploy responsive UI to staging
- Team tests on mobile devices
- Fix any layout issues

### Phase 4: Analytics (Week 3-4)
- Deploy /analytics page
- Gather feedback on metrics
- Add additional charts as requested

### Phase 5: Reporting (Week 4-5)
- Deploy PDF export
- Test with large reports
- Document export process for users

---

## Sources

### Docker & Next.js Deployment
- [Dockerizing Next.js 15 with pnpm](https://medium.com/@she11fish/dockerizing-next-js-15-application-with-pnpm-for-production-39c841ce8323)
- [NextJs App Deployment with Docker: Complete Guide for 2025](https://codeparrot.ai/blogs/deploy-nextjs-app-with-docker-complete-guide-for-2025)
- [Next.js Standalone Mode & Docker Optimization](https://javascript.plainenglish.io/next-js-15-self-hosting-with-docker-complete-guide-0826e15236da)
- [Dockerizing a Next.js and Node.js App with PostgreSQL](https://medium.com/@abhijariwala/dockerizing-a-next-js-and-node-js-app-with-postgresql-and-prisma-a-complete-guide-000527023e99)
- [Docker Compose: The Complete Guide for 2026](https://devtoolbox.dedyn.io/blog/docker-compose-complete-guide)
- [Next.js Standalone Output Documentation](https://nextjs.org/docs/pages/api-reference/config/next-config-js/output)

### Analytics & Charting
- [Building a Next.js Dashboard with Dynamic Charts and SSR](https://cube.dev/blog/building-nextjs-dashboard-with-dynamic-charts-and-ssr)
- [How to Build an Analytical Dashboard with Next.js](https://www.freecodecamp.org/news/build-an-analytical-dashboard-with-nextjs/)
- [6 Best JavaScript Charting Libraries for Dashboards in 2026](https://embeddable.com/blog/javascript-charting-libraries)
- [Best React chart libraries (2025 update)](https://blog.logrocket.com/best-react-chart-libraries-2025/)
- [Recharts vs ECharts vs Chart.js comparison](https://theaverageprogrammer.hashnode.dev/choosing-the-right-charting-library-for-your-nextjs-dashboard)

### PDF & Excel Export
- [Dynamic HTML to PDF Generation with Puppeteer](https://medium.com/front-end-weekly/dynamic-html-to-pdf-generation-in-next-js-a-step-by-step-guide-with-puppeteer-dbcf276375d7)
- [Best JavaScript PDF libraries 2025](https://www.nutrient.io/blog/javascript-pdf-libraries/)
- [PDFs in NextJS: A Comprehensive Guide](https://blog.aatechax.com/pdfs-in-nextjs-a-comprehensive-guide-68189a1be7aa)
- [JS Pdf Generation libraries comparison](https://dmitriiboikov.com/posts/2025/01/pdf-generation-comarison/)

### Mobile Responsive Design
- [shadcn/ui Responsive Layout Patterns](https://www.shadcn.io/patterns/field-layouts-3)
- [Mobile Menu Sheet Pattern](https://www.shadcn.io/patterns/sheet-navigation-1)
- [Shadcn UI adoption guide](https://blog.logrocket.com/shadcn-ui-adoption-guide/)

### Prisma & PostgreSQL
- [Prisma Schema Overview](https://www.prisma.io/docs/orm/prisma-schema/overview)
- [Getting Started with Prisma ORM for PostgreSQL](https://betterstack.com/community/guides/scaling-nodejs/prisma-orm/)

---

*Architecture research for v1.1 milestone: Production Deployment + Analytics & UX*
*Researched: 2026-02-13*
