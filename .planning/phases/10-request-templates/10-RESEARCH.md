# Phase 10: Request Templates - Research

**Researched:** 2026-02-16
**Domain:** Content Templates & Form Pre-filling
**Confidence:** HIGH

## Summary

This phase implements a system for administrators to create reusable request templates that pre-fill the request form title and description. The implementation involves a new `Template` database model, an admin interface for template management, and an updated user request form that supports template selection.

**Key constraint resolution:** While the initial requirements mentioned department-specific templates, the **Prior Decisions** explicitly state "No department binding — all users see all templates". This research follows the decision: templates are global and visible to all users.

**Primary recommendation:** Use a server-side fetch for active templates in `NewRequestPage` and pass them to the client-side `RequestForm`. Use a Prisma transaction to enforce the single "default" template rule.

## Standard Stack

The project's existing stack is well-suited for this feature:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| **Prisma** | ^6.1.0 | ORM & Schema | Matches existing DB layer; strong type safety. |
| **React Hook Form** | ^7.71.1 | Form State | Already used in `RequestForm`; handles dynamic updates efficiently. |
| **Zod** | ^4.3.6 | Validation | Schema definition for both Requests and Templates. |
| **Shadcn/UI** | Latest | UI Components | Use `Select` and `Form` components for consistent UX. |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| **Server Actions** | Next.js 15 | Data Mutation | For creating/updating templates securely. |

## Architecture Patterns

### Database Schema
Add a `Template` model to `prisma/schema.prisma`. Note the `isDefault` field which requires unique constraint enforcement.

```prisma
// Phase 10: Request Templates
model Template {
  id          String   @id @default(cuid())
  name        String   // Internal admin name
  title       String   // Predefined title pattern
  description String   @db.Text // Content to pre-fill
  isDefault   Boolean  @default(false)
  isActive    Boolean  @default(true) // For soft delete
  
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@map("templates")
}
```

### Admin Management Routes
Create a standard CRUD interface under the existing admin layout:
```
src/app/admin/templates/
├── page.tsx             # List all templates (active & inactive)
├── new/page.tsx         # Create form
└── [id]/page.tsx        # Edit form
```

### User Interaction Pattern
The `RequestForm` component needs refactoring to accept a `templates` prop.
1. **Fetch**: `NewRequestPage` (Server Component) fetches `active` templates.
2. **Pass**: Passes `Template[]` to `RequestForm` (Client Component).
3. **Select**: `RequestForm` renders a `<Select>` for templates.
4. **Update**: On selection, `form.setValue('title', template.title)` and `form.setValue('description', template.description)`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| **Unique Default** | Custom validation logic | Prisma Transaction | Race conditions in code are hard to prevent; DB/Transactions are safer. |
| **Form State** | `useState` for fields | `react-hook-form` | RHF handles dirty state, validation, and re-renders optimized. |
| **Template UI** | Custom dropdown | `Select` (Shadcn) | Consistent accessibility and styling. |

**Key insight:** React Hook Form's `setValue` is preferred over `reset` for partial updates (like applying a template) to avoid clearing other potential form state (like attachments, though templates don't support them yet).

## Common Pitfalls

### Pitfall 1: Multiple Default Templates
**What goes wrong:** Multiple templates get marked as "Default" due to race conditions or logic errors.
**Why it happens:** Simple update logic (`updateMany set false` then `create set true`) isn't atomic without a transaction.
**How to avoid:** Use `prisma.$transaction` for all "set default" operations.
**Warning signs:** Users see unpredictable default selections.

### Pitfall 2: Overwriting User Input
**What goes wrong:** User types a custom description, then selects a template, losing their work.
**Why it happens:** `setValue` overwrites blindly.
**How to avoid:**
1. Check `form.formState.isDirty` before applying template.
2. Or strictly follow the "Template is a starting point" paradigm (selection = overwrite).
**Recommendation:** Given the "starting point" decision, implicit overwrite is acceptable, but a UI hint ("Selecting a template will replace current content") is user-friendly.

### Pitfall 3: Soft Delete Visibility
**What goes wrong:** Inactive templates appear in the user dropdown.
**Why it happens:** Forgetting to filter `where: { isActive: true }` in the user-facing fetch query.
**How to avoid:** Create a dedicated data access function `getActiveTemplates()` that enforces this filter.

## Code Examples

### Template Selection Logic (RequestForm)
```typescript
// Source: React Hook Form docs & Shadcn UI patterns
import { UseFormReturn } from "react-hook-form"

interface Template {
  id: string
  name: string
  title: string
  description: string
}

function TemplateSelector({ 
  templates, 
  form 
}: { 
  templates: Template[], 
  form: UseFormReturn<any> 
}) {
  const onSelect = (value: string) => {
    const template = templates.find(t => t.id === value)
    if (template) {
      form.setValue("title", template.title, { shouldDirty: true })
      form.setValue("description", template.description, { shouldDirty: true })
    } else if (value === "blank") {
      // Handle "Blank Request"
      form.setValue("title", "", { shouldDirty: true })
      form.setValue("description", "", { shouldDirty: true })
    }
  }

  return (
    <Select onValueChange={onSelect}>
      <SelectTrigger>
        <SelectValue placeholder="Select a template..." />
      </SelectTrigger>
      <SelectContent>
        {templates.map(t => (
          <SelectItem key={t.id} value={t.id}>
            <span className="font-medium">{t.name}</span>
            <span className="ml-2 text-muted-foreground truncate max-w-[200px]">
              - {t.title}
            </span>
          </SelectItem>
        ))}
        <SelectItem value="blank">Blank Request</SelectItem>
      </SelectContent>
    </Select>
  )
}
```

### Enforcing Single Default (Server Action)
```typescript
// Source: Prisma Transaction Pattern
export async function setTemplateAsDefault(id: string) {
  await prisma.$transaction([
    // 1. Unset all existing defaults
    prisma.template.updateMany({
      where: { isDefault: true },
      data: { isDefault: false }
    }),
    // 2. Set new default
    prisma.template.update({
      where: { id },
      data: { isDefault: true }
    })
  ])
}
```

## Open Questions

1. **Department Binding Conflict**
   - **Conflict:** Phase Goal says "Admin can assign templates to specific departments" and Requirements list TMPL-05 "Department-specific template listing".
   - **Decision:** Prior Decisions explicitly state "No department binding — all users see all templates".
   - **Resolution:** This research strictly follows the "Prior Decisions" (Global templates). If department binding is actually required, the plan must be updated to include a `departmentId` relation in the schema.

2. **Predefined Title "Patterns"**
   - **Question:** Does "patterns" imply dynamic variables (e.g., `{{date}}`)?
   - **Assumption:** "Prior decisions" say title is editable and not placeholder-based. We assume static text pre-fill (e.g., "Monthly Report").
   - **Recommendation:** Implement static text first. If variables are needed, a simple replacement utility can be added later.

## Sources

### Primary (HIGH confidence)
- **Project Codebase** (`package.json`, `prisma/schema.prisma`): Confirmed stack (Next.js 15, Prisma 6, React Hook Form).
- **Prisma Docs**: Transaction patterns for uniqueness.

### Secondary (MEDIUM confidence)
- **React Hook Form Docs**: `setValue` vs `reset` behavior for partial updates.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Verified against repo.
- Architecture: HIGH - Follows existing Next.js patterns.
- Pitfalls: MEDIUM - Dependent on specific user behavior (overwrite vs append).

**Research date:** 2026-02-16
**Valid until:** Next major Prisma/Next.js version update.
