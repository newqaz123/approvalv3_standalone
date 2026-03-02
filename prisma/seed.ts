import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Standard level names for approval hierarchy
const defaultLevelNames = {
  "1": "Supervisor",
  "2": "Manager",
  "3": "Director",
};

const engineeringLevelNames = {
  "1": "Junior Engineer",
  "2": "Senior Engineer",
  "3": "Engineering Manager",
};

async function main() {
  console.log("Seeding database...");

  // Update departments with levelNames for configurable approval hierarchy
  console.log("Updating departments with levelNames...");

  await prisma.department.upsert({
    where: { id: "ENG" },
    update: { levelNames: engineeringLevelNames },
    create: {
      id: "ENG",
      name: "Engineering",
      type: "ENGINEERING",
      levelNames: engineeringLevelNames,
    },
  });

  await prisma.department.upsert({
    where: { id: "QC" },
    update: { levelNames: defaultLevelNames },
    create: {
      id: "QC",
      name: "Quality Control",
      type: "GENERAL",
      levelNames: defaultLevelNames,
    },
  });

  await prisma.department.upsert({
    where: { id: "PD1" },
    update: { levelNames: defaultLevelNames },
    create: {
      id: "PD1",
      name: "Production Department 1",
      type: "GENERAL",
      levelNames: defaultLevelNames,
    },
  });

  await prisma.department.upsert({
    where: { id: "PD2" },
    update: { levelNames: defaultLevelNames },
    create: {
      id: "PD2",
      name: "Production 2",
      type: "GENERAL",
      levelNames: defaultLevelNames,
    },
  });

  await prisma.department.upsert({
    where: { id: "ADMIN" },
    update: { levelNames: defaultLevelNames },
    create: {
      id: "ADMIN",
      name: "Administration",
      type: "GENERAL",
      levelNames: defaultLevelNames,
    },
  });

  console.log("Departments updated with levelNames.");

  // Create a DepartmentApprover example:
  // Engineering Manager (level 3) as cross-department approver for PD1 at level 3
  // This demonstrates how an engineering user can approve for a general department
  const engineeringManager = await prisma.user.findFirst({
    where: { departmentId: "ENG", level: 3 },
  });

  if (engineeringManager) {
    console.log(
      `Creating DepartmentApprover: ${engineeringManager.name} approves for PD1 at level 3`
    );
    await prisma.departmentApprover.upsert({
      where: {
        departmentId_approverId_approverLevel: {
          departmentId: "PD1",
          approverId: engineeringManager.id,
          approverLevel: 3,
        },
      },
      update: {},
      create: {
        departmentId: "PD1",
        approverId: engineeringManager.id,
        approverLevel: 3,
      },
    });
    console.log("DepartmentApprover created.");
  } else {
    console.log("No Engineering level 3 user found, skipping DepartmentApprover seed.");
  }

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
