import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(__dirname, '../.env.local') })

import prisma from '../src/lib/prisma'

async function main() {
  const deleted = await prisma.request.findMany({
    where: { isDeleted: true },
    select: {
      id: true,
      title: true,
      status: true,
      deletedAt: true,
      requester: { select: { name: true, email: true } },
      deletedByUser: { select: { name: true } },
      department: { select: { name: true } },
      activities: {
        where: { action: 'deleted' },
        take: 1,
        orderBy: { createdAt: 'desc' },
        select: { comments: true, createdAt: true }
      }
    },
    orderBy: { deletedAt: 'desc' }
  })

  console.log(`\n🗑️  Deleted Requests (${deleted.length} total):\n`)

  deleted.forEach(r => {
    console.log(`ID: ${r.id}`)
    console.log(`Title: ${r.title}`)
    console.log(`Status: ${r.status}`)
    console.log(`Requester: ${r.requester.name} (${r.requester.email})`)
    console.log(`Department: ${r.department.name}`)
    console.log(`Deleted by: ${r.deletedByUser?.name || 'Unknown'}`)
    console.log(`Deleted at: ${r.deletedAt?.toLocaleString()}`)
    if (r.activities[0]?.comments) {
      console.log(`Reason: ${r.activities[0].comments}`)
    }
    console.log('---')
  })
}

main().catch(console.error).finally(() => process.exit(0))
