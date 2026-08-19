# Follow-up Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `/dashboard` with a read-only follow-up board and send general users to `/requests/my-actions` after login.

**Architecture:** Reuse `getMyRequests` visibility. Derive KPI/flow/card buckets in one server action. New client board opens a sheet drawer and a view-only request modal.

**Tech Stack:** Next.js App Router, Prisma, existing RequestModalRouter, Tailwind.

**Spec:** `docs/superpowers/specs/2026-08-16-follow-up-dashboard-design.md`

## Global Constraints

- Visibility must equal `getMyRequests`.
- No Need my action / Awaiting my approval cards.
- No production migrations.
- Run `npm run check` after code changes.
- `graphify update .` after code changes.

## Tasks

1. Redirect contract tests + middleware/sign-in/home changes.
2. `getFollowUpDashboard` + source-contract tests.
3. `viewOnly` on `RequestModalRouter`.
4. Follow-up board UI + dashboard page swap.
5. Update regressions that pinned old dashboard tabs/filters.
6. `npm run check` + `graphify update .`
