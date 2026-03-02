import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: 'postgresql://neondb_owner:npg_OzuiW2AUfN1w@ep-calm-dream-a1br4slr-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require'
    }
  }
});

try {
  const result = await prisma.$queryRaw`SELECT NOW()`;
  console.log('SUCCESS! Connected at:', result[0].now);
} catch (e) {
  console.error('FAILED:', e.message);
  console.error('Code:', e.code);
} finally {
  await prisma.$disconnect();
}
