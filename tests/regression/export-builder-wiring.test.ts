import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";

describe("completed approval export builder wiring", () => {
	it("renders the package builder in the completed final modal", () => {
		const modal = readFileSync(
			"src/components/requests/completed-final-modal.tsx",
			"utf8",
		);
		const builder = readFileSync(
			"src/components/reports/completed-approval-export-builder.tsx",
			"utf8",
		);

		assert.match(modal, /CompletedApprovalExportBuilder/);
		assert.match(modal, /onExportPackage\?:/);
		assert.match(modal, /requestAttachments=\{data\.requestFiles\}/);
		assert.match(modal, /solutionAttachments=\{data\.solution\.files\}/);
		assert.match(builder, /buildDefaultExportPackageItems/);
		assert.match(builder, /buildSelectedExportPackageRequestItems/);
		assert.match(builder, /buildPackageItemsKey/);
		assert.match(builder, /\[packageItemsKey\]/);
		assert.match(builder, /Approval Packet Export/);
		assert.match(builder, /Export Approval Packet/);
		assert.match(builder, /cannot be appended/);
		assert.match(builder, /disabled=\{!item\.mergeable\}/);
		assert.match(builder, /moveExportPackageItem/);
		assert.match(builder, /aria-label=\{`Move \$\{item\.fileName\} up`\}/);
		assert.match(builder, /aria-label=\{`Move \$\{item\.fileName\} down`\}/);
		assert.match(builder, /disabled=\{index === 0\}/);
		assert.match(builder, /disabled=\{index === orderedItems\.length - 1\}/);
		assert.doesNotMatch(builder, /rearrange|GripVertical|dnd-kit/i);
	});

	it("keeps completed export builders hidden until the export action is clicked", () => {
		const completedFinalModal = readFileSync(
			"src/components/requests/completed-final-modal.tsx",
			"utf8",
		);
		const detailModal = readFileSync(
			"src/components/requests/request-detail-modal.tsx",
			"utf8",
		);

		assert.match(
			completedFinalModal,
			/showExportBuilder, setShowExportBuilder[\s\S]*useState\(false\)/,
		);
		assert.match(completedFinalModal, /setShowExportBuilder\(true\)/);
		assert.match(
			completedFinalModal,
			/scrollIntoView\(\{[\s\S]*behavior:\s*['"]smooth['"][\s\S]*block:\s*['"]start['"]/,
		);
		assert.match(
			completedFinalModal,
			/showExportBuilder &&[\s\S]*CompletedApprovalExportBuilder/,
		);
		assert.match(completedFinalModal, /Export Report/);

		assert.match(
			detailModal,
			/showExportBuilder, setShowExportBuilder[\s\S]*useState\(false\)/,
		);
		assert.match(detailModal, /setShowExportBuilder\(true\)/);
		assert.match(
			detailModal,
			/scrollIntoView\(\{[\s\S]*behavior:\s*['"]smooth['"][\s\S]*block:\s*['"]start['"]/,
		);
		assert.match(detailModal, /if \(!showExportBuilder\)/);
		assert.match(detailModal, /CompletedApprovalExportBuilder/);
	});

	it("routes ordered selected package items to the package server action", () => {
		const router = readFileSync(
			"src/components/requests/request-modal-router.tsx",
			"utf8",
		);

		assert.match(router, /exportRequestPackageAsPDF/);
		assert.match(router, /handleExportPackage/);
		assert.match(router, /onExportPackage=\{handleExportPackage\}/);
		assert.match(router, /Evidence package exported successfully/);
	});

	it("appends selected attachments to the approval report in the package server action", () => {
		const reportsAction = readFileSync("src/server-actions/reports.ts", "utf8");

		assert.match(reportsAction, /exportRequestPackageAsPDF/);
		assert.match(reportsAction, /validateExportPackageRequestItems/);
		assert.match(reportsAction, /generateRequestPDF\(pdfData\)/);
		assert.match(reportsAction, /buildExportableAttachment/);
		assert.match(reportsAction, /convertAttachmentToPdf/);
		assert.match(reportsAction, /mergePdfBuffers/);
	});

	it("replaces legacy request detail export buttons with the package builder", () => {
		const detailModal = readFileSync(
			"src/components/requests/request-detail-modal.tsx",
			"utf8",
		);

		assert.match(detailModal, /CompletedApprovalExportBuilder/);
		assert.match(detailModal, /exportRequestPackageAsPDF/);
		assert.match(detailModal, /renderExportBuilder/);
		assert.match(detailModal, /request\.status !== 'Completed'/);
		assert.doesNotMatch(detailModal, /ExportPDFButton/);
	});

	it("keeps completed-only export eligibility across legacy and server paths", () => {
		const legacyButton = readFileSync(
			"src/components/reports/export-pdf-button.tsx",
			"utf8",
		);
		const reportsAction = readFileSync("src/server-actions/reports.ts", "utf8");

		assert.match(
			legacyButton,
			/requestStatus === 'Completed' && allApprovalsComplete/,
		);
		assert.doesNotMatch(legacyButton, /FinalApproval'\s*\|\|/);
		assert.match(reportsAction, /request\.status !== 'Completed'/);
		assert.doesNotMatch(reportsAction, /FinalApproval', 'Completed/);
	});

	it("authorizes ordinary PDF exports through the shared visibility predicate", () => {
		const reportsAction = readFileSync("src/server-actions/reports.ts", "utf8");

		assert.match(reportsAction, /canUserViewRequest/);
		assert.doesNotMatch(
			reportsAction,
			/request\.departmentId === user\.departmentId/,
		);
		assert.match(reportsAction, /generateAdminBackupPdf/);
	});

	it("rejects generateAdminBackupPdf for a non-admin session even when caller passes an admin id", async () => {
		const reports = loadReportsModule({
			requireAdmin: async () => null,
		});

		await assert.rejects(
			() => reports.generateAdminBackupPdf("pd2-r1", "admin-1"),
			/Unauthorized|Admin access required/,
		);
		assert.equal(reports.state.pdfGenerated, false);
		assert.equal(reports.state.exportUserIds.length, 0);
	});

	it("authorizes generateAdminBackupPdf from requireAdmin session id, not the caller-supplied adminId", async () => {
		const reports = loadReportsModule({
			requireAdmin: async () => "admin-1",
		});

		const pdf = await reports.generateAdminBackupPdf("pd2-r1", "staff-pd1");
		assert.ok(Buffer.isBuffer(pdf));
		assert.equal(reports.state.pdfGenerated, true);
		assert.deepEqual(reports.state.exportUserIds, ["admin-1"]);
	});
});

type ReportsHarness = {
	generateAdminBackupPdf: (requestId: string, adminId: string) => Promise<Buffer>;
	state: { pdfGenerated: boolean; exportUserIds: string[] };
};

function loadReportsModule(options: {
	requireAdmin: () => Promise<string | null>;
}): ReportsHarness {
	const state = { pdfGenerated: false, exportUserIds: [] as string[] };
	const exportableRequest = {
		id: "pd2-r1",
		title: "PD2 request",
		description: "<p>secret</p>",
		status: "ImprovementRequest",
		createdAt: new Date("2026-01-01T00:00:00Z"),
		requesterId: "staff-pd2",
		requester: { id: "staff-pd2", name: "PD2 Staff", email: "pd2@example.test" },
		department: { id: "department-pd", name: "Production PD" },
		fileAttachments: [],
		activities: [],
		approvals: [],
		solutions: [],
	};
	const dependencies: Record<string, unknown> = {
		"@/lib/auth-config": {
			auth: async () => ({ user: { id: "staff-pd1" } }),
		},
		"@/lib/auth": {
			requireAdmin: options.requireAdmin,
		},
		"@/lib/prisma": {
			default: {
				user: {
					findUnique: async ({ where }: { where: { id: string } }) => {
						state.exportUserIds.push(where.id);
						return { id: where.id, name: where.id, isActive: true };
					},
				},
				requests: {
					findFirst: async () => exportableRequest,
				},
			},
		},
		"@/lib/pdf": {
			generateRequestPDF: async () => {
				state.pdfGenerated = true;
				return Buffer.from("admin-backup-pdf");
			},
		},
		"@/lib/pdf-package": {
			convertAttachmentToPdf: async () => Buffer.from(""),
			mergePdfBuffers: async () => Buffer.from(""),
			validateExportPackageRequestItems: () => [],
		},
		"@/lib/request-visibility/scope": {
			canUserViewRequest: async () => false,
		},
	};
	const source = readFileSync(join("src", "server-actions", "reports.ts"), "utf8");
	const compiled = ts.transpileModule(source, {
		compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
	}).outputText;
	const moduleExports: Record<string, unknown> = {};
	runInNewContext(compiled, {
		exports: moduleExports,
		require: (name: string) => {
			if (name in dependencies) return dependencies[name];
			throw new Error(`Unexpected dependency '${name}' imported by src/server-actions/reports.ts`);
		},
		console: { error() {}, warn() {}, log() {} },
		Buffer,
		Map,
		Date,
	});
	return {
		generateAdminBackupPdf: moduleExports.generateAdminBackupPdf as ReportsHarness["generateAdminBackupPdf"],
		state,
	};
}
