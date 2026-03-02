import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkApprovals() {
  // Get a sample of completed requests
  const requests = await prisma.request.findMany({
    where: {
      status: 'Completed',
      isDeleted: false,
    },
    select: {
      id: true,
      title: true,
      status: true,
      requesterId: true,
      requester: {
        select: {
          name: true,
          level: true,
          departmentId: true,
        },
      },
      approvals: {
        select: {
          id: true,
          requiredLevel: true,
          order: true,
          status: true,
          approver: {
            select: {
              name: true,
            },
          },
        },
        orderBy: {
          order: 'asc',
        },
      },
    },
    take: 5,
    orderBy: {
      createdAt: 'desc',
    },
  });

  console.log('Sample Completed Requests:');
  for (const req of requests) {
    console.log(`\nRequest: ${req.title}`);
    console.log(`  Requester: ${req.requester?.name} (Level ${req.requester?.level || 'none'})`);
    console.log(`  Approvals count: ${req.approvals.length}`);
    if (req.approvals.length > 0) {
      console.log('  Approvals:');
      req.approvals.forEach((a) => {
        console.log(`    - Level ${a.requiredLevel}: ${a.status} ${a.approver?.name ? `by ${a.approver.name}` : ''}`);
      });
    } else {
      console.log('  No approvals found');
    }
  }

  // Check department hierarchy
  console.log('\n\nDepartment Hierarchy:');
  const departments = await prisma.department.findMany({
    select: {
      id: true,
      name: true,
      users: {
        where: {
          isActive: true,
          level: { not: null },
        },
        select: {
          name: true,
          level: true,
        },
        orderBy: {
          level: 'asc',
        },
      },
    },
  });

  for (const dept of departments) {
    if (dept.users.length > 0) {
      console.log(`\n${dept.name}:`);
      dept.users.forEach((u) => {
        console.log(`  - ${u.name}: Level ${u.level}`);
      });
    }
  }

  await prisma.$disconnect();
}

checkApprovals().catch(console.error);
