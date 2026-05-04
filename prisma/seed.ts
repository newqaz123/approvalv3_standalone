import { PrismaClient } from "@prisma/client";
import { hashSync } from "bcryptjs";

const prisma = new PrismaClient();

// Standard level names for approval hierarchy
const defaultLevelNames = {
  "1": "Staff",
  "2": "Supervisor",
  "3": "Section Manager",
  "4": "Department Manager",
  "5": "Division Manager",
  "6": "Factory Manager",
};

const engineeringLevelNames = {
  "1": "Staff",
  "2": "Supervisor",
  "3": "Section Manager",
  "4": "Department Manager",
  "5": "Division Manager",
  "6": "Factory Manager",
};

async function main() {
  console.log("Seeding database...");

  // ── Departments ──────────────────────────────────────────────────
  console.log("Creating departments...");

  const now = new Date();
  const departments = [
    { id: "ENG", name: "Engineering", type: "ENGINEERING" as const, levelNames: engineeringLevelNames, updatedAt: now },
    { id: "ADMIN", name: "Administration", type: "GENERAL" as const, levelNames: defaultLevelNames, updatedAt: now },
    { id: "PD2", name: "Production 2", type: "GENERAL" as const, levelNames: defaultLevelNames, updatedAt: now },
    { id: "QC", name: "Quality Control", type: "GENERAL" as const, levelNames: defaultLevelNames, updatedAt: now },
    { id: "PD1", name: "Production 1", type: "GENERAL" as const, levelNames: defaultLevelNames, updatedAt: now },
    { id: "PD3", name: "Production 3", type: "GENERAL" as const, levelNames: defaultLevelNames, updatedAt: now },
    { id: "MN", name: "Maintenance", type: "GENERAL" as const, levelNames: defaultLevelNames, updatedAt: now },
    { id: "TTEC", name: "TTEC", type: "GENERAL" as const, levelNames: defaultLevelNames, updatedAt: now },
    { id: "IC", name: "IC", type: "GENERAL" as const, levelNames: defaultLevelNames, updatedAt: now },
    { id: "DM", name: "Division Manager", type: "GENERAL" as const, levelNames: defaultLevelNames, updatedAt: now },
    { id: "FM", name: "Factory Manager", type: "GENERAL" as const, levelNames: defaultLevelNames, updatedAt: now },
    { id: "UT", name: "Utility", type: "GENERAL" as const, levelNames: defaultLevelNames, updatedAt: now },
    { id: "WWT", name: "Waste Water Treatment", type: "GENERAL" as const, levelNames: defaultLevelNames, updatedAt: now },
    { id: "BM", name: "Biomass", type: "GENERAL" as const, levelNames: defaultLevelNames, updatedAt: now },
  ];

  for (const dept of departments) {
    await prisma.departments.upsert({
      where: { id: dept.id },
      update: { levelNames: dept.levelNames, updatedAt: now },
      create: dept,
    });
  }
  console.log(`${departments.length} departments created/updated.`);

  // ── Default Admin User ───────────────────────────────────────────
  console.log("Creating default admin user...");

  const adminPasswordHash = hashSync("changeme", 12);

  await prisma.user.upsert({
    where: { email: "admin@example.com" },
    update: {},
    create: {
      email: "admin@example.com",
      name: "System Admin",
      passwordHash: adminPasswordHash,
      role: "admin",
      departmentId: null,
      isActive: true,
      forcePasswordChange: true,
      updatedAt: now,
    },
  });

  console.log("Default admin created: admin@example.com / changeme");
  console.log("⚠️  Change the admin password after first login!");

  console.log("Seeding finished.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
