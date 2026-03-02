# Test Users Reference - Phase 3 Approval Testing

## Quick Setup
```bash
# Run this to setup all user levels and names
npx tsx scripts/assign-user-levels-manual.ts
```

---

## Test User Accounts

### Quality Control Department

| Name | Email | Password | Level | Notes |
|------|-------|----------|-------|-------|
| **Admin (QC Level 5)** | patawatnew@hotmail.com | warfuf-batno6-fimQoc | 5 | Top-level, Auto-approves |
| **QC Level 2** | test01@gmail.com | pafdy2-mybsiq-vUrgiv | 2 | Mid-level approver |
| **QC Level 1** | test02@gmail.com | [create password] | 1 | Base-level user |

**Approval Flow in QC:**
- Level 1 creates request → Needs Level 2 → Needs Level 5
- Level 2 creates request → Needs Level 5 only
- Level 5 creates request → Auto-approved, goes straight to Engineering

---

### Production Department 1

| Name | Email | Password | Level | Notes |
|------|-------|----------|-------|-------|
| **PD1 Level 3** | userpd1@gmail.com | [password] | 3 | Top-level in PD1 |
| **PD1 Level 2** | userpd1_1@gmail.com | [password] | 2 | Mid-level approver |

**Approval Flow in PD1:**
- Level 2 creates request → Needs Level 3
- Level 3 creates request → Auto-approved

---

### Engineering Department

| Name | Email | Password | Level | Notes |
|------|-------|----------|-------|-------|
| **Engineering Level 3** | enguser01@gmail.com | [password] | 3 | Top-level in Engineering |

**Approval Flow in Engineering:**
- Level 3 creates/receives request → Auto-approved

---

## Testing Scenarios

### Scenario 1: Full Approval Chain (QC Level 1 → 2 → 5)
1. **Login as:** QC Level 1 (test02@gmail.com)
2. Create request
3. **Login as:** QC Level 2 (test01@gmail.com)
4. Approve request
5. **Login as:** Admin (QC Level 5) (patawatnew@hotmail.com)
6. Approve request
7. **Result:** Status changes to `SentToEngineer`

### Scenario 2: Skip Mid-Level (QC Level 2 → 5)
1. **Login as:** QC Level 2 (test01@gmail.com)
2. Create request
3. **Login as:** Admin (QC Level 5) (patawatnew@hotmail.com)
4. Approve request
5. **Result:** Status changes to `SentToEngineer` (Level 2 skipped)

### Scenario 3: Auto-Approve (QC Level 5)
1. **Login as:** Admin (QC Level 5) (patawatnew@hotmail.com)
2. Create request
3. **Result:** Immediately goes to `SentToEngineer` (no approval needed)

### Scenario 4: Cross-Department (PD1)
1. **Login as:** PD1 Level 2 (userpd1_1@gmail.com)
2. Create request
3. **Login as:** PD1 Level 3 (userpd1@gmail.com)
4. Approve request
5. **Result:** Status changes to `SentToEngineer`

### Scenario 5: Rejection
1. **Login as:** QC Level 1 (test02@gmail.com)
2. Create request
3. **Login as:** QC Level 2 (test01@gmail.com)
4. Reject request with reason
5. **Result:** All pending approvals marked rejected, status stays `ImprovementRequest`

---

## Approval Level Logic

### Who Can Approve?
- **Level 1 user creates:** Levels 2 and 5 must approve
- **Level 2 user creates:** Level 5 must approve
- **Level 5 user creates:** Auto-approved (no approval needed)

### Sequential Approval:
- Must approve in order: Lower levels → Higher levels
- Cannot skip levels
- Any ONE person at each level can approve
- Status changes ONLY when top-level approves

### Engineering Workflow:
When request reaches `SentToEngineer`:
- Engineering users can see the request
- Engineering approval chain works same way
- Top-level Engineering approval → Status changes to `SendBackToRequester`

---

## Visual Approval Progress

In the request detail modal, you'll see:

```
Approval Progress
─────────────────
⏳ Level 2 Approval               [Pending]
   Awaiting any Level 2 user

⏳ Level 5 Approval               [Pending]
   Awaiting any Level 5 user
```

After QC Level 2 approves:
```
✅ Level 2 Approval               [Approved]
   QC Level 2 (test01@gmail.com)
   "Looks good to me"
   Jan 31, 2026 2:30 PM

⏳ Level 5 Approval               [Pending]
   Awaiting any Level 5 user
```

---

## Troubleshooting

### Users showing as "User" instead of descriptive names
```bash
npx tsx scripts/assign-user-levels-manual.ts
```

### Approval buttons not showing
- Check you're not the requester (can't approve own request)
- Check you're at the correct level for pending approval
- Check previous levels have approved

### Status not changing after approval
- Verify all approvals in chain are complete
- Check Prisma Studio for approval status
- Look for errors in browser console

---

## Database Checks

```sql
-- View all users with levels
SELECT name, email, "departmentId", level, role
FROM users
WHERE "isActive" = true
ORDER BY "departmentId", level DESC;

-- View approval chain for a request
SELECT ra."order", ra."requiredLevel", ra.status, ra.comments, u.name
FROM request_approvals ra
LEFT JOIN users u ON ra."approverId" = u.id
WHERE ra."requestId" = '[request-id]'
ORDER BY ra."order";

-- Find requests pending your approval
SELECT r.id, r.title, ra."requiredLevel"
FROM requests r
JOIN request_approvals ra ON r.id = ra."requestId"
WHERE ra."requiredLevel" = [your-level]
  AND ra.status = 'pending'
  AND r."departmentId" = '[your-dept-id]';
```

---

## Quick Commands

```bash
# Setup users
npx tsx scripts/assign-user-levels-manual.ts

# View database
npx prisma studio
# Open http://localhost:5555

# Start app
npm run dev
# Open http://localhost:3005

# Test approval flow
# 1. Login as QC Level 1
# 2. Create request
# 3. Login as QC Level 2
# 4. Approve
# 5. Login as Admin
# 6. Approve
# 7. Check status changed!
```

---

**Happy Testing! 🚀**
