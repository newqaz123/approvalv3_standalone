/**
 * Creates two test users for manual upload-feedback verification:
 *   requester@example.com / test1234  (general_dept, Administration)
 *  engineer@example.com  / test1234  (engineering, Engineering)
 * Idempotent upserts. Run from the worktree with dotenv preloaded.
 */
import { PrismaClient } from "@prisma/client";
import { hashSync } from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
	const hash = hashSync("test1234", 12);

	const requester = await prisma.user.upsert({
		where: { email: "requester@example.com" },
		update: {},
		create: {
			email: "requester@example.com",
			name: "Test Requester",
			passwordHash: hash,
			role: "general_dept",
			departmentId: "ADMIN",
			isActive: true,
			forcePasswordChange: false,
		},
	});

	const engineer = await prisma.user.upsert({
		where: { email: "engineer@example.com" },
		update: {},
		create: {
			email: "engineer@example.com",
			name: "Test Engineer",
			passwordHash: hash,
			role: "engineering",
			departmentId: "ENG",
			isActive: true,
			forcePasswordChange: false,
		},
	});

	console.log("requester:", requester.id);
	console.log("engineer:", engineer.id);
	await prisma.$disconnect();
}

main();
