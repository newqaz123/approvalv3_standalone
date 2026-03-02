/**
 * Sync user roles from Prisma to Clerk publicMetadata
 *
 * This script reads roles from the database and updates Clerk user metadata.
 * Run this after creating users or updating roles in the database.
 */

import { PrismaClient } from '@prisma/client';
import { ClerkClient, createClerkClient } from '@clerk/backend';

const prisma = new PrismaClient();

// Initialize Clerk backend client
const clerkClient = createClerkClient({
  secretKey: process.env.CLERK_SECRET_KEY,
});

async function syncRolesToClerk() {
  console.log('🔄 Syncing roles from Prisma to Clerk...\n');

  // Get all users from Prisma
  const users = await prisma.user.findMany({
    select: {
      id: true, // Clerk user ID
      email: true,
      role: true,
    },
  });

  console.log(`Found ${users.length} users in Prisma\n`);

  let updated = 0;
  let skipped = 0;
  let errors = 0;

  for (const user of users) {
    try {
      // Get current Clerk user metadata
      const clerkUser = await clerkClient.users.getUser(user.id);
      const currentRole = clerkUser.publicMetadata.role as string | undefined;

      // Check if role needs updating
      if (currentRole !== user.role) {
        console.log(`📧 ${user.email}`);
        console.log(`   Current Clerk metadata role: ${currentRole || 'not set'}`);
        console.log(`   Prisma database role: ${user.role}`);
        console.log(`   ⚡ Updating Clerk metadata...\n`);

        // Update Clerk user metadata
        await clerkClient.users.updateUser(user.id, {
          publicMetadata: {
            ...clerkUser.publicMetadata,
            role: user.role,
          },
        });

        updated++;
        console.log(`   ✅ Updated\n`);
      } else {
        console.log(`✅ ${user.email}: already in sync (${user.role})\n`);
        skipped++;
      }
    } catch (error) {
      console.error(`❌ Error updating ${user.email}:`, error);
      errors++;
    }
  }

  console.log('\n' + '='.repeat(50));
  console.log('Sync complete:');
  console.log(`  ✅ Updated: ${updated}`);
  console.log(`  ⏭️  Skipped: ${skipped}`);
  console.log(`  ❌ Errors: ${errors}`);
  console.log('='.repeat(50));

  await prisma.$disconnect();
}

syncRolesToClerk()
  .then(() => {
    console.log('\n✅ Script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Script failed:', error);
    process.exit(1);
  });
