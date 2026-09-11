import {
  ApprovalPhase,
  ApprovalRouteStatus,
  PrismaClient,
  UserRole,
} from "@prisma/client";
import { hashSync } from "bcryptjs";

function assertCleanStartDatabaseUrl(url: string | undefined): void {
  const value = url ?? "";
  if (/app_db|app_org_manual_7abcdf3|app_cleanstart_ci/.test(value)) {
    throw new Error("seed URL-GUARD: refused protected or CI database name");
  }
  if (!/\/app_cleanstart_dev(\?|$)/.test(value)) {
    throw new Error("seed URL-GUARD: DATABASE_URL must target app_cleanstart_dev only");
  }
}

assertCleanStartDatabaseUrl(process.env.DATABASE_URL);

const prisma = new PrismaClient();

const defaultSubTaskStages = [
  { name: "Design", sortOrder: 10, isOthers: false },
  { name: "Site survey", sortOrder: 20, isOthers: false },
  { name: "Waiting user data", sortOrder: 30, isOthers: false },
  { name: "Waiting quotation", sortOrder: 40, isOthers: false },
  { name: "Waiting WR", sortOrder: 50, isOthers: false },
  { name: "Completed", sortOrder: 60, isOthers: false },
  { name: "Others", sortOrder: 70, isOthers: true },
];

async function main() {
  console.log("Seeding database...");

  const now = new Date();

  // ── Default Sub-task Stages ─────────────────────────────────────
  console.log("Creating default sub-task stages...");

  for (const stage of defaultSubTaskStages) {
    await prisma.sub_task_stages.upsert({
      where: { name: stage.name },
      update: {
        sortOrder: stage.sortOrder,
        isDefault: true,
        isOthers: stage.isOthers,
        isActive: true,
      },
      create: {
        name: stage.name,
        sortOrder: stage.sortOrder,
        isDefault: true,
        isOthers: stage.isOthers,
        isActive: true,
      },
    });
  }

  console.log(`${defaultSubTaskStages.length} sub-task stages created/updated.`);

  // ── Default Admin User ───────────────────────────────────────────
  console.log("Creating default admin user...");

  const adminPasswordHash = hashSync("changeme", 12);

  const admin = await prisma.user.upsert({
    where: { email: "admin@example.com" },
    update: {
      name: "System Admin",
      passwordHash: adminPasswordHash,
      role: UserRole.admin,
      isActive: true,
      forcePasswordChange: false,
      updatedAt: now,
    },
    create: {
      email: "admin@example.com",
      name: "System Admin",
      passwordHash: adminPasswordHash,
      role: UserRole.admin,
      isActive: true,
      forcePasswordChange: false,
      updatedAt: now,
    },
  });

  console.log("Default admin created: admin@example.com");

  await seedCleanStartFixture({
    adminId: admin.id,
    passwordHash: adminPasswordHash,
    now,
  });

  console.log("Seeding finished.");
}

const CS = {
  unit: {
    company: "cs-unit-company",
    operations: "cs-unit-operations",
    sectionA: "cs-unit-section-a",
    sectionB: "cs-unit-section-b",
    sectionAChild: "cs-unit-section-a-child",
  },
  pos: {
    staff: "cs-pos-staff",
    lead: "cs-pos-lead",
    manager: "cs-pos-manager",
    director: "cs-pos-director",
  },
  asg: {
    pat: "cs-asg-pat",
    alice: "cs-asg-alice",
    bob: "cs-asg-bob",
    casey: "cs-asg-casey",
    quinn: "cs-asg-quinn",
    riley: "cs-asg-riley",
    morgan: "cs-asg-morgan",
    dana: "cs-asg-dana",
  },
  team: {
    lineA: "cs-team-section-a-line",
  },
  route: {
    request: "cs-route-root-request",
    solution: "cs-route-root-solution",
    final: "cs-route-root-final",
    opsRequest: "cs-route-ops-request",
  },
} as const;

async function seedCleanStartFixture(input: {
  adminId: string;
  passwordHash: string;
  now: Date;
}): Promise<void> {
  console.log("Seeding clean-start B14 fixture...");

  const existingRoot = await prisma.organization_units.findFirst({
    where: { parentId: null, isActive: true },
    select: { id: true },
  });
  if (existingRoot && existingRoot.id !== CS.unit.company) {
    throw new Error(
      `seed STOP: active company root is ${existingRoot.id}, expected ${CS.unit.company}. Refusing a second root.`,
    );
  }

  const positions = [
    { id: CS.pos.staff, name: "Staff", rank: 1 },
    { id: CS.pos.lead, name: "Lead", rank: 2 },
    { id: CS.pos.manager, name: "Manager", rank: 3 },
    { id: CS.pos.director, name: "Director", rank: 4 },
  ];
  for (const position of positions) {
    await prisma.positions.upsert({
      where: { name: position.name },
      update: { rank: position.rank, isActive: true, updatedAt: input.now },
      create: {
        id: position.id,
        name: position.name,
        rank: position.rank,
        isActive: true,
        updatedAt: input.now,
      },
    });
  }
  const positionByName = Object.fromEntries(
    (await prisma.positions.findMany({
      where: { name: { in: positions.map((position) => position.name) } },
      select: { id: true, name: true },
    })).map((row) => [row.name, row.id]),
  );
  const staffId = positionByName.Staff;
  const leadId = positionByName.Lead;
  const managerId = positionByName.Manager;
  const directorId = positionByName.Director;

  const units: Array<{
    id: string;
    name: string;
    parentId: string | null;
    shareRequests: boolean;
  }> = [
    {
      id: CS.unit.company,
      name: "Company",
      parentId: null,
      shareRequests: false,
    },
    {
      id: CS.unit.operations,
      name: "Operations",
      parentId: CS.unit.company,
      shareRequests: true,
    },
    {
      id: CS.unit.sectionA,
      name: "Section A",
      parentId: CS.unit.operations,
      shareRequests: true,
    },
    {
      id: CS.unit.sectionB,
      name: "Section B",
      parentId: CS.unit.operations,
      shareRequests: true,
    },
    {
      id: CS.unit.sectionAChild,
      name: "Section A Child",
      parentId: CS.unit.sectionA,
      shareRequests: true,
    },
  ];
  for (const unit of units) {
    await prisma.organization_units.upsert({
      where: { id: unit.id },
      update: {
        name: unit.name,
        parentId: unit.parentId,
        shareRequests: unit.shareRequests,
        canWorkOnSolutions: false,
        isActive: true,
        managerUserId: null,
        updatedAt: input.now,
      },
      create: {
        id: unit.id,
        name: unit.name,
        parentId: unit.parentId,
        shareRequests: unit.shareRequests,
        canWorkOnSolutions: false,
        isActive: true,
        updatedAt: input.now,
      },
    });
  }

  const fixtureUsers: Array<{ email: string; name: string }> = [
    { email: "pat@example.com", name: "Pat" },
    { email: "alice@example.com", name: "Alice" },
    { email: "bob@example.com", name: "Bob" },
    { email: "casey@example.com", name: "Casey" },
    { email: "quinn@example.com", name: "Quinn" },
    { email: "riley@example.com", name: "Riley" },
    { email: "morgan@example.com", name: "Morgan" },
    { email: "dana@example.com", name: "Dana" },
  ];
  const userByEmail: Record<string, string> = {};
  for (const fixtureUser of fixtureUsers) {
    const row = await prisma.user.upsert({
      where: { email: fixtureUser.email },
      update: {
        name: fixtureUser.name,
        passwordHash: input.passwordHash,
        role: UserRole.general_dept,
        isActive: true,
        forcePasswordChange: false,
        updatedAt: input.now,
      },
      create: {
        email: fixtureUser.email,
        name: fixtureUser.name,
        passwordHash: input.passwordHash,
        role: UserRole.general_dept,
        isActive: true,
        forcePasswordChange: false,
        updatedAt: input.now,
      },
    });
    userByEmail[fixtureUser.email] = row.id;
  }

  const assignments: Array<{ id: string; email: string; unitId: string; positionId: string }> = [
    { id: CS.asg.dana, email: "dana@example.com", unitId: CS.unit.company, positionId: directorId },
    { id: CS.asg.pat, email: "pat@example.com", unitId: CS.unit.operations, positionId: managerId },
    { id: CS.asg.alice, email: "alice@example.com", unitId: CS.unit.sectionA, positionId: staffId },
    { id: CS.asg.casey, email: "casey@example.com", unitId: CS.unit.sectionA, positionId: leadId },
    { id: CS.asg.quinn, email: "quinn@example.com", unitId: CS.unit.sectionA, positionId: leadId },
    { id: CS.asg.riley, email: "riley@example.com", unitId: CS.unit.sectionA, positionId: managerId },
    { id: CS.asg.morgan, email: "morgan@example.com", unitId: CS.unit.sectionA, positionId: managerId },
    { id: CS.asg.bob, email: "bob@example.com", unitId: CS.unit.sectionB, positionId: staffId },
  ];
  for (const assignment of assignments) {
    await prisma.organization_assignments.upsert({
      where: { id: assignment.id },
      update: {
        userId: userByEmail[assignment.email],
        unitId: assignment.unitId,
        positionId: assignment.positionId,
        teamId: null,
        isActive: true,
        deactivatedAt: null,
        updatedAt: input.now,
      },
      create: {
        id: assignment.id,
        userId: userByEmail[assignment.email],
        unitId: assignment.unitId,
        positionId: assignment.positionId,
        teamId: null,
        isActive: true,
        updatedAt: input.now,
      },
    });
  }

  await prisma.organization_units.update({
    where: { id: CS.unit.company },
    data: { managerUserId: userByEmail["dana@example.com"], updatedAt: input.now },
  });
  await prisma.organization_units.update({
    where: { id: CS.unit.operations },
    data: { managerUserId: userByEmail["pat@example.com"], updatedAt: input.now },
  });
  await prisma.organization_units.update({
    where: { id: CS.unit.sectionA },
    data: { managerUserId: userByEmail["morgan@example.com"], updatedAt: input.now },
  });

  await prisma.teams.upsert({
    where: { id: CS.team.lineA },
    update: {
      unitId: CS.unit.sectionA,
      name: "Line A",
      reportsToAssignmentId: CS.asg.riley,
      isActive: true,
      updatedAt: input.now,
    },
    create: {
      id: CS.team.lineA,
      unitId: CS.unit.sectionA,
      name: "Line A",
      reportsToAssignmentId: CS.asg.riley,
      isActive: true,
      updatedAt: input.now,
    },
  });
  for (const memberId of [CS.asg.alice, CS.asg.casey, CS.asg.quinn]) {
    await prisma.organization_assignments.update({
      where: { id: memberId },
      data: { teamId: CS.team.lineA, updatedAt: input.now },
    });
  }

  await prisma.company_settings.upsert({
    where: { id: "default" },
    update: {
      name: "Clean Start Company",
      rootUnitId: CS.unit.company,
      updatedAt: input.now,
    },
    create: {
      id: "default",
      name: "Clean Start Company",
      rootUnitId: CS.unit.company,
      updatedAt: input.now,
    },
  });

  const routeDefs: Array<{ id: string; phase: ApprovalPhase }> = [
    { id: CS.route.request, phase: ApprovalPhase.REQUEST },
    { id: CS.route.solution, phase: ApprovalPhase.SOLUTION },
    { id: CS.route.final, phase: ApprovalPhase.FINAL },
  ];
  for (const route of routeDefs) {
    await prisma.approval_route_versions.upsert({
      where: { id: route.id },
      update: {
        scopeUnitId: CS.unit.company,
        phase: route.phase,
        version: 1,
        approvalLimitPositionId: directorId,
        status: ApprovalRouteStatus.PUBLISHED,
        publishedAt: input.now,
        createdById: input.adminId,
      },
      create: {
        id: route.id,
        scopeUnitId: CS.unit.company,
        phase: route.phase,
        version: 1,
        approvalLimitPositionId: directorId,
        status: ApprovalRouteStatus.PUBLISHED,
        publishedAt: input.now,
        createdById: input.adminId,
      },
    });
    await prisma.approval_route_steps.deleteMany({ where: { routeVersionId: route.id } });
    const stepPositions = [
      { order: 1, positionId: leadId },
      { order: 2, positionId: managerId },
      { order: 3, positionId: directorId },
    ];
    for (const step of stepPositions) {
      await prisma.approval_route_steps.create({
        data: {
          routeVersionId: route.id,
          stepOrder: step.order,
          positionId: step.positionId,
        },
      });
    }
  }

  // C5: published REQUEST exception at Operations so Section A REQUEST is
  // Inherited from Operations. Steps copy the root default (leftover columns as B14).
  await prisma.approval_route_versions.upsert({
    where: { id: CS.route.opsRequest },
    update: {
      scopeUnitId: CS.unit.operations,
      phase: ApprovalPhase.REQUEST,
      version: 1,
      approvalLimitPositionId: directorId,
      status: ApprovalRouteStatus.PUBLISHED,
      publishedAt: input.now,
      createdById: input.adminId,
    },
    create: {
      id: CS.route.opsRequest,
      scopeUnitId: CS.unit.operations,
      phase: ApprovalPhase.REQUEST,
      version: 1,
      approvalLimitPositionId: directorId,
      status: ApprovalRouteStatus.PUBLISHED,
      publishedAt: input.now,
      createdById: input.adminId,
    },
  });
  await prisma.approval_route_steps.deleteMany({ where: { routeVersionId: CS.route.opsRequest } });
  const opsStepPositions = [
    { order: 1, positionId: leadId },
    { order: 2, positionId: managerId },
    { order: 3, positionId: directorId },
  ];
  for (const step of opsStepPositions) {
    await prisma.approval_route_steps.create({
      data: {
        routeVersionId: CS.route.opsRequest,
        stepOrder: step.order,
        positionId: step.positionId,
      },
    });
  }

  const unitCount = await prisma.organization_units.count({
    where: { id: { in: Object.values(CS.unit) } },
  });
  const positionCount = await prisma.positions.count({
    where: { name: { in: ["Staff", "Lead", "Manager", "Director"] } },
  });
  const assignmentCount = await prisma.organization_assignments.count({
    where: { id: { in: Object.values(CS.asg) }, isActive: true },
  });
  const teamCount = await prisma.teams.count({ where: { id: CS.team.lineA, isActive: true } });
  const routeCount = await prisma.approval_route_versions.count({
    where: {
      id: { in: [CS.route.request, CS.route.solution, CS.route.final] },
      status: ApprovalRouteStatus.PUBLISHED,
    },
  });
  const opsRequestCount = await prisma.approval_route_versions.count({
    where: { id: CS.route.opsRequest, status: ApprovalRouteStatus.PUBLISHED },
  });
  const userCount = await prisma.user.count({
    where: { email: { in: fixtureUsers.map((row) => row.email) } },
  });
  console.log(
    `Clean-start fixture counts: units=${unitCount} positions=${positionCount} users=${userCount} assignments=${assignmentCount} teams=${teamCount} publishedRootRoutes=${routeCount} publishedOpsRequest=${opsRequestCount}`,
  );
  console.log(`Clean-start fixture emails: ${fixtureUsers.map((row) => row.email).join(", ")}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
