import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as currentInstance from "../../src/lib/approval-engine/current-instance";

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
		assert.match(builder, /t\('requests\.exportPacketTitle'\)/);
		assert.match(builder, /t\('requests\.exportPacket'\)/);
		assert.match(builder, /t\('requests\.exportUnsupported'\)/);
		assert.match(readFileSync('src/lib/i18n/catalogs/requests.ts', 'utf8'), /requests\.exportUnsupported[^\n]*cannot be appended/);
		assert.match(builder, /disabled=\{!item\.mergeable\}/);
		assert.match(builder, /moveExportPackageItem/);
		assert.match(builder, /aria-label=\{t\('requests\.moveNamedUp', \{ name: itemLabel\(item\) \}\)\}/);
		assert.match(builder, /aria-label=\{t\('requests\.moveNamedDown', \{ name: itemLabel\(item\) \}\)\}/);
		assert.match(builder, /disabled=\{index === 0\}/);
		assert.match(builder, /disabled=\{index === orderedItems\.length - 1\}/);
		assert.doesNotMatch(builder, /rearrange|GripVertical|dnd-kit/i);
	});

	it("keeps completed export builders hidden until the export action is clicked", () => {
		const completedFinalModal = readFileSync(
			"src/components/requests/completed-final-modal.tsx",
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
		assert.match(completedFinalModal, /t\('requests\.exportReport'\)/);
	});

	it("routes ordered selected package items to the package server action", () => {
		const router = readFileSync(
			"src/components/requests/request-modal-router.tsx",
			"utf8",
		);

		assert.match(router, /exportRequestPackageAsPDF/);
		assert.match(router, /handleExportPackage/);
		assert.match(router, /onExportPackage=\{handleExportPackage\}/);
		assert.match(router, /t\('requests\.packetExported'\)/);
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

	it("keeps completed-only export eligibility in the server path", () => {
		const reportsAction = readFileSync("src/server-actions/reports.ts", "utf8");
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

// Historical rejected/pending rows must not veto a completed current attempt.
for (const kind of ["request", "solution"] as const) {
  for (const status of ["pending", "rejected"]) {
    for (const superseded of [true, false]) {
      it(`${kind} ${status} approval blocks export only when current (superseded=${superseded})`, async () => {
        const row = {
          status, order: 1, instanceId: "attempt-1",
          instance: { supersededAt: superseded ? new Date() : null },
        };
        const reports = loadReportsModule({
          requireAdmin: async () => null,
          canView: true,
          request: {
            status: "Completed",
            approvals: kind === "request" ? [row] : [],
            solutions: kind === "solution" ? [{
              id: "solution-1", title: "Solution", description: "Done",
              submittedBy: { name: "Engineer" }, createdAt: new Date(),
              approvals: [row], fileAttachments: [],
            }] : [],
          },
        });
        const result = await reports.exportRequestAsPDF("pd2-r1");
        assert.equal(result.success, superseded, result.error);
        const packet = await reports.exportRequestPackageAsPDF("pd2-r1", [{ type: "approval-report" }]);
        assert.equal(packet.success, superseded, packet.error);
        if (superseded) {
          assert.equal(reports.state.pdfData.approvalPhases.length, 0);
        }
      });
    }
  }
}

it("still blocks incomplete requests even with no outstanding approvals", async () => {
  const reports = loadReportsModule({ requireAdmin: async () => null, canView: true });
  const result = await reports.exportRequestAsPDF("pd2-r1");
  assert.equal(result.success, false);
  assert.match(result.error!, /request is completed/);
});

for (const phase of ["initial", "solution", "final"]) {
  it(`maps real department and position names for ${phase} approvals`, async () => {
    const person = (name: string, department?: string) => ({
      name, role: "general_dept", organizationAssignments: department ? [{ unit: { name: department } }] : [],
    });
    const base = { status: "approved", order: 2, instanceId: "attempt-2",
      instance: { attempt: 2, supersededAt: null }, requiredPositionRef: { name: "Section Manager" },
      isFinalApproval: phase === "final", routingMode: "SNAPSHOT_GROUP" };
    const rows = [
      { ...base, approver: person("Actual", "Production 1 Section"), candidateGroup: { scopeUnitId: "factory" } },
      { ...base, approver: person("Actual", "Production 1"), requiredApprover: person("Required", "Wrong unit") },
      { ...base, requiredApprover: person("Required", "Production 2") },
      { ...base, approver: person("Actual"), requiredApprover: person("Required", "Wrong unit"), requiredPositionRef: null },
      { ...base, requiredPositionRef: null },
    ];
    const reports = loadReportsModule({ requireAdmin: async () => "admin", request: {
      approvals: phase === "solution" ? [] : rows,
      solutions: phase === "solution" ? [{ id: "s1", title: "Solution", description: "Done", submittedBy: { name: "Engineer" },
        createdAt: new Date(), fileAttachments: [], approvals: rows }] : [],
    }});
    await reports.generateAdminBackupPdf("pd2-r1", "admin");
    const approvals = reports.state.pdfData.approvalPhases[0].approvals;
    assert.deepEqual(Array.from(approvals, (row: any) => row.approverDepartment), ["Production 1 Section", "Production 1", "Production 2", undefined, undefined]);
    assert.deepEqual(Array.from(approvals, (row: any) => row.positionName), ["Section Manager", "Section Manager", "Section Manager", undefined, undefined]);
    assert.equal(approvals[4].approverName, "Not recorded");
    assert.equal(approvals[0].stage, "Step 2");
    assert.equal(approvals[0].attempt, 2);
    assert.equal(approvals[0].instanceId, "attempt-2");
    assert.equal(approvals[0].supersededAt, null);
  });
}

for (const phase of ["initial", "solution", "final"]) {
  it(`exports only current ${phase} steps while backups retain history`, async () => {
    const base = { status: "approved", routingMode: "SNAPSHOT_GROUP", isFinalApproval: phase === "final" };
    const rows = [
      { ...base, order: 1, instanceId: "old", instance: { attempt: 1, supersededAt: new Date() }, approver: { name: "Old" } },
      { ...base, order: 3, instanceId: "old", instance: { attempt: 1, supersededAt: new Date() }, approver: { name: "Old higher step" } },
      { ...base, order: 1, instanceId: "current", instance: { attempt: 2, supersededAt: null }, approver: { name: "Current" } },
      { ...base, order: 2, instanceId: null, approver: { name: "Legacy" } },
    ];
    const reports = loadReportsModule({ requireAdmin: async () => "admin", canView: true, request: {
      status: "Completed", approvals: phase === "solution" ? [] : rows,
      solutions: phase === "solution" ? [{ id: "s1", title: "Solution", description: "Done", submittedBy: { name: "Engineer" },
        createdAt: new Date(), fileAttachments: [], approvals: rows }] : [],
    }});
    for (const exportPdf of [
      () => reports.exportRequestAsPDF("pd2-r1"),
      () => reports.exportRequestPackageAsPDF("pd2-r1", [{ type: "approval-report" }]),
    ]) {
      const result = await exportPdf();
      assert.equal(result.success, true, result.error);
      assert.deepEqual(Array.from(reports.state.pdfData.approvalPhases[0].approvals, (row: any) => row.approverName), ["Current", "Legacy"]);
      assert.equal(reports.state.pdfData.includeApprovalHistory, false);
    }
    await reports.generateAdminBackupPdf("pd2-r1", "admin");
    assert.equal(reports.state.pdfData.approvalPhases[0].approvals.length, 4);
    assert.equal(reports.state.pdfData.includeApprovalHistory, true);
  });
}

for (const phase of ["solution", "final"]) {
  it(`uses assigned positions for custom ${phase} approvals without a route position`, async () => {
    const person = (name: string, position?: string) => ({ name, organizationAssignments: position
      ? [{ unit: { name: "Engineering Department" }, position: { name: position } }] : [] });
    const base = { status: "approved", order: 1, routingMode: "CUSTOM_PERSON", requiredPositionRef: null,
      isFinalApproval: phase === "final", instanceId: "custom", instance: { attempt: 1, supersededAt: null } };
    const rows = [
      { ...base, approver: person("Actual", "Department Manager"), requiredApprover: person("Required", "Supervisor") },
      { ...base, requiredApprover: person("Required", "Section Manager") },
      { ...base, approver: person("Actual"), requiredApprover: person("Required", "Wrong position") },
      { ...base, approver: person("Actual", "Director"), requiredPositionRef: { name: "Required Manager" } },
    ];
    const reports = loadReportsModule({ requireAdmin: async () => "admin", canView: true, request: {
      status: "Completed", approvals: phase === "solution" ? [] : rows,
      solutions: phase === "solution" ? [{ id: "s1", title: "Solution", description: "Done", submittedBy: { name: "Engineer" },
        createdAt: new Date(), fileAttachments: [], approvals: rows }] : [],
    }});
    const result = await reports.exportRequestAsPDF("pd2-r1");
    assert.equal(result.success, true, result.error);
    assert.deepEqual(Array.from(reports.state.pdfData.approvalPhases[0].approvals, (row: any) => row.positionName),
      ["Department Manager", "Section Manager", undefined, "Required Manager"]);
  });
}

type ReportsHarness = {
  exportRequestAsPDF: (id: string) => Promise<{ success: boolean; error?: string }>;
  exportRequestPackageAsPDF: (id: string, items: unknown[]) => Promise<{ success: boolean; error?: string }>;
	generateAdminBackupPdf: (requestId: string, adminId: string) => Promise<Buffer>;
	state: { pdfGenerated: boolean; exportUserIds: string[]; pdfData: any };
};

function loadReportsModule(options: {
	requireAdmin: () => Promise<string | null>;
  canView?: boolean;
  request?: Record<string, unknown>;
}): ReportsHarness {
	const state = { pdfGenerated: false, exportUserIds: [] as string[], pdfData: null as any };
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
    ...options.request,
	};
	const dependencies: Record<string, unknown> = {
    "@/lib/approval-engine/current-instance": currentInstance,
		"@/lib/auth-config": {
			auth: async () => ({ user: { id: "staff-pd1" } }),
		},
		"@/lib/auth": {
			requireAdmin: options.requireAdmin,
		},
		"@/lib/prisma": {
			default: {
        organization_units: {
          findMany: async ({ where }: any) => {
            assert.deepEqual(Array.from(where.id.in), ["factory"]);
            return [{ id: "factory", name: "FACTORY" }];
          },
        },
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
			generateRequestPDF: async (data: unknown) => {
        state.pdfData = data;
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
			canUserViewRequest: async () => options.canView ?? false,
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
    exportRequestAsPDF: moduleExports.exportRequestAsPDF as ReportsHarness["exportRequestAsPDF"],
    exportRequestPackageAsPDF: moduleExports.exportRequestPackageAsPDF as ReportsHarness["exportRequestPackageAsPDF"],
		generateAdminBackupPdf: moduleExports.generateAdminBackupPdf as ReportsHarness["generateAdminBackupPdf"],
		state,
	};
}
