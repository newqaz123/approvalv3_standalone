import { after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import {
	buildRejectedRequestCancellationWhere,
	buildRejectedRequestResubmissionWhere,
	RequestStatusConflictError,
	updateRequestStatusExpecting,
} from "@/lib/request-status-transition";

const setupDb = new PrismaClient();
const winnerDb = new PrismaClient();
const loserDb = new PrismaClient();

after(async () => {
	await Promise.all([setupDb.$disconnect(), winnerDb.$disconnect(), loserDb.$disconnect()]);
});

function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

async function createRejectedRequestFixture(): Promise<{
	requestId: string;
}> {
	const owner = await setupDb.user.findFirst({
		where: { departmentId: { not: null } },
		select: { id: true, departmentId: true },
	});
	if (!owner?.departmentId) {
		throw new Error("Race integration test requires a user with a department");
	}

	const request = await setupDb.requests.create({
		data: {
			title: `Rejected cancellation race ${randomUUID()}`,
			description: "Rejected cancellation race fixture",
			status: "ImprovementRequest",
			requesterId: owner.id,
			departmentId: owner.departmentId,
		},
		select: { id: true },
	});
	await setupDb.request_approvals.create({
		data: {
			requestId: request.id,
			requiredLevel: 2,
			order: 1,
			status: "rejected",
			isFinalApproval: false,
			comments: "Rejected for race verification",
		},
	});
	return { requestId: request.id };
}

async function cleanupFixture(requestId: string) {
	await setupDb.requests.delete({ where: { id: requestId } }).catch(() => undefined);
}

function assertConflict(result: PromiseSettledResult<void>) {
	assert.equal(result.status, "rejected");
	assert.ok(result.reason instanceof RequestStatusConflictError);
}

test(
	"a committed rejected-request cancellation makes concurrent resubmission roll back",
	{ timeout: 10_000 },
	async () => {
		const { requestId } = await createRejectedRequestFixture();
		const winnerLocked = deferred();
		const releaseWinner = deferred();

		try {
			const cancellation = winnerDb.$transaction(async (tx) => {
				const request = await tx.requests.findUniqueOrThrow({
					where: { id: requestId },
					select: { updatedAt: true },
				});
				await updateRequestStatusExpecting(tx, {
					requestId,
					expectedStatuses: ["ImprovementRequest"],
					additionalWhere: buildRejectedRequestCancellationWhere(request.updatedAt),
					data: { status: "Cancelled" },
					actionLabel: "cancel",
				});
				winnerLocked.resolve();
				await releaseWinner.promise;
			});

			await winnerLocked.promise;
			const loserAttempting = deferred();
			const resubmission = loserDb.$transaction(async (tx) => {
				const request = await tx.requests.findUniqueOrThrow({
					where: { id: requestId },
					select: { updatedAt: true },
				});
				loserAttempting.resolve();
				await updateRequestStatusExpecting(tx, {
					requestId,
					expectedStatuses: ["ImprovementRequest"],
					additionalWhere: buildRejectedRequestResubmissionWhere(request.updatedAt),
					data: { updatedAt: new Date(request.updatedAt.getTime() + 1) },
					actionLabel: "resubmit request",
				});
				await tx.request_approvals.deleteMany({ where: { requestId } });
			});

			await loserAttempting.promise;
			releaseWinner.resolve();
			const [cancellationResult, resubmissionResult] = await Promise.allSettled([
				cancellation,
				resubmission,
			]);

			assert.equal(cancellationResult.status, "fulfilled");
			assertConflict(resubmissionResult);
			const finalRequest = await setupDb.requests.findUniqueOrThrow({
				where: { id: requestId },
				select: { status: true, approvals: { select: { status: true } } },
			});
			assert.equal(finalRequest.status, "Cancelled");
			assert.deepEqual(finalRequest.approvals, [{ status: "rejected" }]);
		} finally {
			releaseWinner.resolve();
			await cleanupFixture(requestId);
		}
	},
);

test(
	"a committed rejected-request resubmission makes concurrent cancellation roll back",
	{ timeout: 10_000 },
	async () => {
		const { requestId } = await createRejectedRequestFixture();
		const winnerLocked = deferred();
		const releaseWinner = deferred();

		try {
			const resubmission = winnerDb.$transaction(async (tx) => {
				const request = await tx.requests.findUniqueOrThrow({
					where: { id: requestId },
					select: { updatedAt: true },
				});
				await updateRequestStatusExpecting(tx, {
					requestId,
					expectedStatuses: ["ImprovementRequest"],
					additionalWhere: buildRejectedRequestResubmissionWhere(request.updatedAt),
					data: { updatedAt: new Date(request.updatedAt.getTime() + 1) },
					actionLabel: "resubmit request",
				});
				await tx.request_approvals.deleteMany({ where: { requestId } });
				winnerLocked.resolve();
				await releaseWinner.promise;
			});

			await winnerLocked.promise;
			const loserAttempting = deferred();
			const cancellation = loserDb.$transaction(async (tx) => {
				const request = await tx.requests.findUniqueOrThrow({
					where: { id: requestId },
					select: { updatedAt: true },
				});
				loserAttempting.resolve();
				await updateRequestStatusExpecting(tx, {
					requestId,
					expectedStatuses: ["ImprovementRequest"],
					additionalWhere: buildRejectedRequestCancellationWhere(request.updatedAt),
					data: { status: "Cancelled" },
					actionLabel: "cancel",
				});
			});

			await loserAttempting.promise;
			releaseWinner.resolve();
			const [resubmissionResult, cancellationResult] = await Promise.allSettled([
				resubmission,
				cancellation,
			]);

			assert.equal(resubmissionResult.status, "fulfilled");
			assertConflict(cancellationResult);
			const finalRequest = await setupDb.requests.findUniqueOrThrow({
				where: { id: requestId },
				select: { status: true, approvals: { select: { id: true } } },
			});
			assert.equal(finalRequest.status, "ImprovementRequest");
			assert.deepEqual(finalRequest.approvals, []);
		} finally {
			releaseWinner.resolve();
			await cleanupFixture(requestId);
		}
	},
);
