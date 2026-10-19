-- Realistic OLD-model (main, 18 migrations) fixture for scripts/upgrade/verify-upgrade.sh.
-- Only ever loaded into a throwaway database created by that script.
--
-- Shape (expected mapping in verify-upgrade.sh):
--   departments: ENG (ENGINEERING), PD1 (GENERAL), QC (GENERAL, no people)
--   active users with dept: eng1 L1, eng2 L2, eng4 L4 (ENG)
--                           pd1a L1, pd1b L1, pd2 L2, pd3a L3, pd3b L3, pdnull NULL level (PD1)
--   inactive user: engx L3 (ENG)          -> no assignment
--   no department: admin (role admin), nodept -> no assignment
--   department_approvers: ext -> PD1 L4 and ENG L3 (ext has no dept -> ONE
--                         assignment, PD1 Level 4); eng2 -> PD1 L3 (already
--                         assigned in ENG -> skipped)
--   requests: r-done Completed (PD1), r-cancel Cancelled (ENG, leftover
--             pending row), r-eng SentToEngineer (PD1, all approved) with a
--             solution (custom-chain approved solution approval)
--   budget codes: bc-pd1 (PD1), bc-none (no department)
--   hierarchy_change_logs: one row; request_activities: two rows

INSERT INTO "departments" ("id", "name", "type", "createdAt", "updatedAt", "levelNames") VALUES
  ('ENG', 'Engineering', 'ENGINEERING', '2026-01-01', '2026-01-01', '{"1":"Staff","2":"Supervisor"}'),
  ('PD1', 'Production 1', 'GENERAL', '2026-01-02', '2026-01-02', NULL),
  ('QC',  'Quality Control', 'GENERAL', '2026-01-03', '2026-01-03', NULL);

INSERT INTO "users" ("id", "email", "name", "passwordHash", "departmentId", "role", "level", "isActive", "forcePasswordChange", "createdAt", "updatedAt") VALUES
  ('u-admin',  'admin@example.com',  'Admin',     'x', NULL,  'admin',        NULL, true,  false, '2026-01-01', '2026-01-01'),
  ('u-eng1',   'eng1@example.com',   'Eng One',   'x', 'ENG', 'engineering',  1,    true,  false, '2026-01-02', '2026-01-02'),
  ('u-eng2',   'eng2@example.com',   'Eng Two',   'x', 'ENG', 'engineering',  2,    true,  false, '2026-01-02', '2026-01-02'),
  ('u-eng4',   'eng4@example.com',   'Eng Four',  'x', 'ENG', 'engineering',  4,    true,  false, '2026-01-02', '2026-01-02'),
  ('u-engx',   'engx@example.com',   'Eng Gone',  'x', 'ENG', 'engineering',  3,    false, false, '2026-01-02', '2026-01-02'),
  ('u-pd1a',   'pd1a@example.com',   'PD One A',  'x', 'PD1', 'general_dept', 1,    true,  false, '2026-01-03', '2026-01-03'),
  ('u-pd1b',   'pd1b@example.com',   'PD One B',  'x', 'PD1', 'general_dept', 1,    true,  false, '2026-01-03', '2026-01-03'),
  ('u-pd2',    'pd2@example.com',    'PD Two',    'x', 'PD1', 'general_dept', 2,    true,  false, '2026-01-03', '2026-01-03'),
  ('u-pd3a',   'pd3a@example.com',   'PD Three A','x', 'PD1', 'general_dept', 3,    true,  false, '2026-01-03', '2026-01-03'),
  ('u-pd3b',   'pd3b@example.com',   'PD Three B','x', 'PD1', 'general_dept', 3,    true,  false, '2026-01-03', '2026-01-03'),
  ('u-pdnull', 'pdnull@example.com', 'PD NoLevel','x', 'PD1', 'general_dept', NULL, true,  false, '2026-01-03', '2026-01-03'),
  ('u-nodept', 'nodept@example.com', 'No Dept',   'x', NULL,  'general_dept', NULL, true,  false, '2026-01-04', '2026-01-04'),
  ('u-ext',    'ext@example.com',    'External',  'x', NULL,  'general_dept', NULL, true,  false, '2026-01-04', '2026-01-04');

INSERT INTO "department_approvers" ("id", "departmentId", "approverId", "approverLevel", "createdAt", "updatedAt") VALUES
  ('da-ext-pd1', 'PD1', 'u-ext',  4, '2026-01-05', '2026-01-05'),
  ('da-ext-eng', 'ENG', 'u-ext',  3, '2026-01-05', '2026-01-05'),
  ('da-eng2-pd1','PD1', 'u-eng2', 3, '2026-01-05', '2026-01-05');

INSERT INTO "budget_codes" ("id", "code", "displayCode", "name", "budgetAmount", "departmentId", "createdById", "createdAt", "updatedAt") VALUES
  ('bc-pd1',  'PD1-001', 'PD1-001', 'Line upgrade', 50000, 'PD1', 'u-admin', '2026-01-06', '2026-01-06'),
  ('bc-none', 'GEN-001', 'GEN-001', 'General',      NULL,  NULL,  'u-admin', '2026-01-06', '2026-01-06');

INSERT INTO "requests" ("id", "title", "description", "status", "requesterId", "departmentId", "createdAt", "updatedAt", "budgetCodeId") VALUES
  ('r-done',   'Done request',      'd', 'Completed',      'u-pd1a', 'PD1', '2026-02-01', '2026-02-10', 'bc-pd1'),
  ('r-cancel', 'Cancelled request', 'd', 'Cancelled',      'u-eng1', 'ENG', '2026-02-02', '2026-02-03', NULL),
  ('r-eng',    'At engineering',    'd', 'SentToEngineer', 'u-pd2',  'PD1', '2026-02-04', '2026-02-05', NULL);

INSERT INTO "request_approvals" ("id", "requestId", "approverId", "requiredLevel", "order", "status", "comments", "approvedAt", "isCustomChain", "isFinalApproval", "requiredApproverId") VALUES
  ('ra-done-2', 'r-done',   'u-pd2',  2, 1, 'approved', 'ok', '2026-02-02', false, false, 'u-pd2'),
  ('ra-done-3', 'r-done',   'u-pd3a', 3, 2, 'approved', 'ok', '2026-02-03', false, false, 'u-pd3a'),
  ('ra-done-4', 'r-done',   'u-ext',  4, 3, 'approved', 'ok', '2026-02-04', false, false, 'u-ext'),
  ('ra-done-f', 'r-done',   'u-ext',  4, 4, 'approved', 'final', '2026-02-09', false, true, 'u-ext'),
  ('ra-cancel', 'r-cancel', NULL,     2, 1, 'pending',  NULL, NULL,          false, false, 'u-eng2'),
  ('ra-eng-3',  'r-eng',    'u-pd3b', 3, 1, 'approved', 'ok', '2026-02-05', false, false, 'u-pd3b');

INSERT INTO "solutions" ("id", "requestId", "title", "description", "costEstimate", "submittedById", "submittedAt", "createdAt", "updatedAt") VALUES
  ('s-done', 'r-done', 'Fix', 'Fix it', 1000, 'u-eng1', '2026-02-06', '2026-02-06', '2026-02-06');

INSERT INTO "solution_approvals" ("id", "solutionId", "requiredLevel", "requiredApproverId", "approverId", "order", "status", "isCustomChain", "approvedAt") VALUES
  ('sa-done-1', 's-done', NULL, 'u-eng4', 'u-eng4', 1, 'approved', true,  '2026-02-07'),
  ('sa-done-2', 's-done', 4,    NULL,     'u-eng4', 2, 'approved', false, '2026-02-08');

INSERT INTO "request_activities" ("id", "requestId", "action", "fromStatus", "toStatus", "userId") VALUES
  ('act-1', 'r-done', 'created',  NULL, 'ImprovementRequest', 'u-pd1a'),
  ('act-2', 'r-done', 'completed', 'FinalApproval', 'Completed', 'u-ext');

INSERT INTO "hierarchy_change_logs" ("id", "departmentId", "adminUserId", "targetUserId", "oldLevel", "newLevel", "reason") VALUES
  ('hcl-1', 'PD1', 'u-admin', 'u-pd2', 1, 2, 'promotion');
