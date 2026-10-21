// Production bootstrap seed (first install, and safe to re-run at any time).
//
// Run after `npx prisma migrate deploy`:
//   npx tsx prisma/seed.ts            (docker-compose.prod.yml `seed` service)
//
// Idempotent and non-destructive: it only CREATES what is missing and never
// overwrites data an admin may have changed (admin password, position names,
// stage settings, company structure). On a database upgraded from the old
// department model (migration 20261019000000_organization_upgrade) the
// company root, positions and admin already exist, so this is a no-op.
//
// The dev/test fixture (test org, accounts, routes) lives in
// prisma/seed-dev.ts (dev database only, guarded there).
import { PrismaClient, UserRole } from "@prisma/client";
import { hashSync } from "bcryptjs";

const prisma = new PrismaClient();

// Same default stages as main's first install (migration
// 20260606000000_add_engineering_sub_tasks also inserts them).
const defaultSubTaskStages = [
  { name: "Design", sortOrder: 10, isOthers: false },
  { name: "Site survey", sortOrder: 20, isOthers: false },
  { name: "Waiting user data", sortOrder: 30, isOthers: false },
  { name: "Waiting quotation", sortOrder: 40, isOthers: false },
  { name: "Waiting WR", sortOrder: 50, isOthers: false },
  { name: "Completed", sortOrder: 60, isOthers: false },
  { name: "Others", sortOrder: 70, isOthers: true },
];

// Company-wide position ladder (higher rank = more senior), taken from
// main's default level names. Created only when no position exists yet;
// admins rename/re-rank them in Organization & Approvals.
const defaultPositions = [
  { name: "Staff", rank: 1 },
  { name: "Supervisor", rank: 2 },
  { name: "Section Manager", rank: 3 },
  { name: "Department Manager", rank: 4 },
  { name: "Division Manager", rank: 5 },
  { name: "Factory Manager", rank: 6 },
];

const DEFAULT_COMPANY_NAME = "Company";

async function seedSubTaskStages(now: Date): Promise<void> {
  for (const stage of defaultSubTaskStages) {
    await prisma.sub_task_stages.upsert({
      where: { name: stage.name },
      update: {},
      create: {
        name: stage.name,
        sortOrder: stage.sortOrder,
        isDefault: true,
        isOthers: stage.isOthers,
        isActive: true,
        updatedAt: now,
      },
    });
  }
  console.log(`Sub-task stages ensured (${defaultSubTaskStages.length}).`);
}

async function seedCompanyRoot(now: Date): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const settings = await tx.company_settings.findUnique({ where: { id: "default" } });
    if (settings) {
      console.log(`Company root already configured (unit ${settings.rootUnitId}).`);
      return;
    }
    // Reuse an existing active root (one_active_company_root allows only one).
    const existingRoot = await tx.organization_units.findFirst({
      where: { parentId: null, isActive: true },
      select: { id: true, name: true },
    });
    const root = existingRoot ?? await tx.organization_units.create({
      data: {
        name: DEFAULT_COMPANY_NAME,
        parentId: null,
        isActive: true,
        shareRequests: false,
        canWorkOnSolutions: false,
        updatedAt: now,
      },
      select: { id: true, name: true },
    });
    await tx.company_settings.create({
      data: { id: "default", name: root.name, rootUnitId: root.id, updatedAt: now },
    });
    console.log(`Company root ${existingRoot ? "linked" : "created"}: ${root.name} (${root.id}).`);
  });
}

async function seedPositions(now: Date): Promise<void> {
  const existing = await prisma.positions.count();
  if (existing > 0) {
    console.log(`Positions already configured (${existing}); defaults not added.`);
    return;
  }
  await prisma.positions.createMany({
    data: defaultPositions.map((position) => ({ ...position, isActive: true, updatedAt: now })),
    skipDuplicates: true,
  });
  console.log(`Default positions created (${defaultPositions.length}).`);
}

async function seedAdmin(now: Date): Promise<void> {
  const existing = await prisma.user.findUnique({ where: { email: "admin@example.com" }, select: { id: true } });
  await prisma.user.upsert({
    where: { email: "admin@example.com" },
    // Never reset an existing admin (password, name, role, activity).
    update: {},
    create: {
      email: "admin@example.com",
      name: "System Admin",
      passwordHash: hashSync("changeme", 12),
      role: UserRole.admin,
      isActive: true,
      forcePasswordChange: true,
      updatedAt: now,
    },
  });
  if (existing) {
    console.log("Default admin already exists (left unchanged).");
  } else {
    console.log("Default admin created: admin@example.com / changeme (password change forced at first login).");
  }
}

async function main(): Promise<void> {
  console.log("Production bootstrap seed...");
  const now = new Date();
  await seedSubTaskStages(now);
  await seedCompanyRoot(now);
  await seedPositions(now);
  await seedAdmin(now);
  console.log("Bootstrap seed finished.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
