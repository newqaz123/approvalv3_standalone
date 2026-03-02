import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function testQuery() {
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
      department: {
        select: {
          name: true,
        },
      },
      requester: {
        select: {
          id: true,
          name: true,
        },
      },
      _count: {
        select: {
          fileAttachments: true,
        },
      },
      approvals: {
        orderBy: {
          order: 'asc',
        },
        include: {
          approver: {
            select: {
              name: true,
            },
          },
        },
      },
    },
    take: 3,
    orderBy: {
      createdAt: 'desc',
    },
  });

  console.log('Testing query structure (same as getAllRequests):');
  for (const req of requests) {
    console.log(`\n${req.title}`);
    console.log(`  Approvals in query: ${req.approvals.length}`);
    req.approvals.forEach((a) => {
      console.log(`    - ${a.status} (Level ${a.requiredLevel}) ${a.approver?.name ? `by ${a.approver.name}` : ''}`);
    });
  }

  await prisma.$disconnect();
}

testQuery().catch(console.error);
