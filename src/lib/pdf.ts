/**
 * PDF Generation Library
 *
 * Provides utilities for generating compact approval evidence PDF documents.
 * Uses Puppeteer with headless Chromium for HTML-to-PDF conversion.
 */

import puppeteer from "puppeteer";
import { resolveInlineImagesForPdf } from "@/lib/inline-images/pdf";

export interface RequestPDFData {
	id: string;
	referenceId?: string;
	title: string;
	description: string;
	requester: {
		name: string;
		email: string;
		department: string;
	};
	department: string;
	status: string;
	createdAt: Date;
	completedAt?: Date;
	solution?: {
		id: string;
		title: string;
		description: string;
		costEstimate: number;
		currency: string;
		timeline?: string;
		conceptDesign?: string;
		submittedBy: string;
		submittedAt: Date;
		fileAttachments: Array<{
			fileName: string;
			fileSize: number;
			fileType: string;
			createdAt: Date;
		}>;
	};
	fileAttachments: Array<{
		fileName: string;
		fileSize: number;
		fileType: string;
		createdAt: Date;
		uploadedBy: string;
	}>;
	approvalPhases: Array<{
		phaseName: string;
		phaseOrder: number;
		approvals: Array<{
			approverName: string;
			approverRole?: string;
			approverDepartment?: string;
			requiredLevel: number;
			status: "approved" | "rejected" | "pending";
			comments?: string;
			approvedAt?: Date;
			order: number;
			stage: string;
			isSolutionApproval: boolean;
		}>;
	}>;
	activities: Array<{
		action: string;
		userName: string;
		createdAt: Date;
		comments?: string;
	}>;
	generatedBy: string;
}

export async function generatePdfFromHTML(html: string): Promise<Buffer> {
	const browser = await puppeteer.launch({
		headless: true,
		args: [
			"--no-sandbox",
			"--disable-setuid-sandbox",
			"--disable-dev-shm-usage",
			"--disable-gpu",
			"--font-render-hinting=none",
		],
		executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
	});

	try {
		const page = await browser.newPage();

		await page.setContent(html, { waitUntil: "networkidle0" });

		const pdf = await page.pdf({
			format: "A4",
			printBackground: true,
			margin: { top: "14mm", right: "18mm", bottom: "12mm", left: "12mm" },
		});

		return Buffer.from(pdf);
	} finally {
		await browser.close();
	}
}

export async function generateRequestPDF(
	data: RequestPDFData,
): Promise<Buffer> {
	return generatePdfFromHTML(await renderRequestEvidenceHTML(data));
}

function formatDate(date: Date | string): string {
	return new Intl.DateTimeFormat("en-US", {
		year: "numeric",
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	}).format(new Date(date));
}

function formatDateShort(date: Date | string): string {
	return new Intl.DateTimeFormat("en-US", {
		year: "numeric",
		month: "short",
		day: "numeric",
	}).format(new Date(date));
}

function formatFileSize(bytes: number): string {
	if (bytes < 1024) return bytes + " B";
	if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
	return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

function escapeHtml(text: string | number | null | undefined): string {
	return String(text ?? "")
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#039;");
}

function formatCurrency(amount: number, currency: string): string {
	try {
		return new Intl.NumberFormat("th-TH", {
			style: "currency",
			currency,
		}).format(amount);
	} catch {
		return `${currency} ${amount.toLocaleString("en-US")}`;
	}
}

function statusClass(
	status: RequestPDFData["approvalPhases"][number]["approvals"][number]["status"],
): string {
	if (status === "approved") return "approved";
	if (status === "rejected") return "rejected";
	return "pending";
}

export async function renderRequestEvidenceHTML(
	data: RequestPDFData,
): Promise<string> {
	// Descriptions are resolved against their owner before interpolation so
	// only request/solution-referenced image bytes enter the trusted PDF HTML.
	const requestDescriptionHtml = await resolveInlineImagesForPdf({
		html: data.description,
		owner: { kind: "request", id: data.id },
	});
	const solutionDescriptionHtml = data.solution
		? await resolveInlineImagesForPdf({
				html: data.solution.description,
				owner: { kind: "solution", id: data.solution.id },
			})
		: "";
	const generatedAt = formatDate(new Date());
	const createdLabel = formatDateShort(data.createdAt);
	const completedLabel = data.completedAt
		? formatDateShort(data.completedAt)
		: "Not completed";
	const attachmentCount =
		data.fileAttachments.length + (data.solution?.fileAttachments.length ?? 0);
	const reference = data.referenceId || data.id || "-";
	const requestAttachments = data.fileAttachments;
	const solutionAttachments = data.solution?.fileAttachments ?? [];

	return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 0;
      font-family: Arial, Helvetica, sans-serif;
      color: #17231f;
      font-size: 11px;
      line-height: 1.38;
      background: #ffffff;
    }
    .hero {
      padding: 18px 20px;
      border-radius: 14px;
      background: linear-gradient(135deg, #103f34 0%, #1e6453 100%);
      color: white;
      margin-bottom: 12px;
    }
    .kicker {
      font-size: 9px;
      letter-spacing: .16em;
      text-transform: uppercase;
      opacity: .78;
    }
    h1 {
      margin: 6px 0 4px;
      font-size: 22px;
      line-height: 1.1;
    }
    h3 {
      margin: 10px 0 6px;
      color: #254139;
      font-size: 11px;
    }
    .hero-meta {
      font-size: 10px;
      opacity: .84;
    }
    .summary-panel {
      border: 1px solid #dbe5e0;
      border-radius: 14px;
      padding: 10px;
      margin-bottom: 10px;
      page-break-inside: avoid;
      background: #ffffff;
    }
    .metrics {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 12px;
    }
    .metric {
      position: relative;
      border: 1px solid #dfe9e4;
      border-radius: 10px;
      padding: 10px 10px 10px 14px;
      background: #f8fbf8;
      min-height: 48px;
    }
    .metric::before {
      content: '';
      position: absolute;
      left: 0;
      top: 10px;
      bottom: 10px;
      width: 4px;
      border-radius: 0 4px 4px 0;
      background: #1e6453;
    }
    .metric.status-card { background: #f5fbf7; }
    .metric.requester-card { background: #f8fafc; }
    .metric.department-card { background: #f7f8fb; }
    .metric.date-card { background: #fbfaf5; }
    .metric.requester-card::before { background: #3f6275; }
    .metric.department-card::before { background: #5a5688; }
    .metric.date-card::before { background: #a66a1f; }
    .metric span {
      display: block;
      color: #63736d;
      font-size: 8px;
      letter-spacing: .08em;
      text-transform: uppercase;
      margin-bottom: 3px;
    }
    .metric strong {
      font-size: 11px;
    }
    .section {
      border: 1px solid #dbe5e0;
      border-radius: 12px;
      padding: 11px 12px;
      margin-bottom: 10px;
      page-break-inside: avoid;
    }
    .section h2 {
      margin: 0 0 8px;
      font-size: 12px;
      letter-spacing: .1em;
      text-transform: uppercase;
      color: #153f35;
    }
    .grid-2 {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
    }
    .solution-grid {
      display: grid;
      grid-template-columns: minmax(0, 1.7fr) minmax(170px, .8fr);
      gap: 10px;
      align-items: start;
    }
    .solution-meta {
      border: 1px solid #e7edea;
      border-radius: 9px;
      background: #f8fbf8;
      padding: 8px;
    }
    .solution-meta p {
      margin: 0 0 7px;
    }
    .solution-meta p:last-child {
      margin-bottom: 0;
    }
    .muted {
      color: #66736e;
    }
    .description {
      white-space: pre-wrap;
      background: #f8faf9;
      border-radius: 8px;
      padding: 8px;
      border: 1px solid #edf2ef;
    }
    .description h2 { font-size: 16px; font-weight: 700; margin: 12px 0 4px; }
    .description h3 { font-size: 14px; font-weight: 700; margin: 10px 0 4px; }
    .description ul, .description ol { margin: 6px 0 6px 20px; padding: 0; }
    .description li { margin: 2px 0; }
    .description a { color: #1d4ed8; text-decoration: underline; }
    .description [data-text-align='left'] { text-align: left; }
    .description [data-text-align='center'] { text-align: center; }
    .description [data-text-align='right'] { text-align: right; }
    .description a::after { content: " (" attr(href) ")"; font-size: 9px; color: #64748b; }
    .description img { display: block; max-width: 100%; height: auto; margin: 8px auto; break-inside: avoid; page-break-inside: avoid; }
    .description img[data-align='left'] { margin-left: 0; margin-right: auto; }
    .description img[data-align='center'] { margin-inline: auto; }
    .description img[data-align='right'] { margin-left: auto; margin-right: 0; }
    .description table { margin: 8px 0; table-layout: fixed; font-size: 11px; }
    .description th, .description td { border: 1px solid #cbd5e1; padding: 4px 8px; white-space: normal; }
    .description th { background: #f1f5f9; font-weight: 700; }
    .description th[data-vertical-align='middle'], .description td[data-vertical-align='middle'] { vertical-align: middle; }
    .description th[data-vertical-align='bottom'], .description td[data-vertical-align='bottom'] { vertical-align: bottom; }
    .description th p, .description td p { margin: 0; }
    .description tr { break-inside: avoid; page-break-inside: avoid; }
    .description .rich-text__image-frame {
      position: relative;
      display: block;
      overflow: hidden;
      max-width: 100%;
      margin: 8px auto;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .description .rich-text__image-frame[data-layout='inline'] {
      display: inline-block;
      vertical-align: middle;
      margin-inline: .125rem;
      break-inside: avoid;
    }
    .description .rich-text__image-frame[data-align='left'] { margin-left: 0; margin-right: auto; }
    .description .rich-text__image-frame[data-align='center'] { margin-inline: auto; }
    .description .rich-text__image-frame[data-align='right'] { margin-left: auto; margin-right: 0; }
    .description .rich-text__image-scene {
      position: absolute;
      transform-origin: center;
    }
    .description .rich-text__image-frame > img,
    .description .rich-text__image-scene > img {
      position: absolute;
      display: block;
      max-width: none;
      margin: 0;
    }
    .description .rich-text__image-frame[data-layout='inline'] > img:not([style]) {
      position: static;
      max-width: 100%;
      height: auto;
      margin: 0;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 10px;
    }
    th, td {
      border-bottom: 1px solid #e7edea;
      padding: 5px 4px;
      text-align: left;
      vertical-align: top;
    }
    th {
      color: #52625c;
      font-size: 8px;
      letter-spacing: .08em;
      text-transform: uppercase;
      background: #f7faf8;
    }
    .status {
      display: inline-block;
      border-radius: 999px;
      padding: 2px 7px;
      font-weight: 700;
      text-transform: capitalize;
    }
    .status.approved { background: #dff5e8; color: #14643d; }
    .status.rejected { background: #fee2e2; color: #991b1b; }
    .status.pending { background: #f1f5f9; color: #475569; }
    .footer {
      margin-top: 14px;
      padding-top: 8px;
      border-top: 1px solid #e5e7eb;
      color: #8a9691;
      font-size: 9px;
      text-align: center;
    }
  </style>
</head>
<body>
  <div class="hero">
    <div class="kicker">Approval Evidence Packet</div>
    <h1>${escapeHtml(data.title)}</h1>
    <div class="hero-meta">Reference: ${escapeHtml(reference)} • Generated ${generatedAt}</div>
  </div>

  <div class="summary-panel">
    <div class="metrics">
      <div class="metric status-card"><span>Status</span><strong>${escapeHtml(data.status)}</strong></div>
      <div class="metric requester-card"><span>Requester</span><strong>${escapeHtml(data.requester.name)}</strong></div>
      <div class="metric department-card"><span>Department</span><strong>${escapeHtml(data.department)}</strong></div>
      <div class="metric date-card"><span>Dates</span><strong>${escapeHtml(createdLabel)} → ${escapeHtml(completedLabel)}</strong></div>
    </div>
  </div>

  ${
		data.solution
			? `
  <div class="section">
    <h2>Engineering Solution</h2>
    <div class="solution-grid">
      <div>
        <strong>${escapeHtml(data.solution.title)}</strong>
        <div class="description">${solutionDescriptionHtml}</div>
      </div>
      <div class="solution-meta">
        <p><strong>Approved Cost</strong><br>${escapeHtml(formatCurrency(data.solution.costEstimate, data.solution.currency))}</p>
        <p><strong>Submitted</strong><br>${escapeHtml(data.solution.submittedBy)}<br>${formatDate(data.solution.submittedAt)}</p>
        ${data.solution.timeline ? `<p><strong>Timeline</strong><br>${escapeHtml(data.solution.timeline)}</p>` : ""}
      </div>
    </div>
    ${data.solution.conceptDesign ? `<br><strong>Concept Design</strong><div class="description">${escapeHtml(data.solution.conceptDesign)}</div>` : ""}
  </div>
  `
			: ""
	}

  <div class="section">
    <h2>Original Request</h2>
    <div class="description">${requestDescriptionHtml}</div>
  </div>

  <div class="section">
    <h2>Attachment Index</h2>
    <table>
      <thead>
        <tr><th>Source</th><th>File</th><th>Size</th><th>Date</th></tr>
      </thead>
      <tbody>
        ${requestAttachments
					.map(
						(file) => `
          <tr>
            <td>Request</td>
            <td>${escapeHtml(file.fileName)}<br><span class="muted">Uploaded by ${escapeHtml(file.uploadedBy)}</span></td>
            <td>${formatFileSize(file.fileSize)}</td>
            <td>${formatDateShort(file.createdAt)}</td>
          </tr>
        `,
					)
					.join("")}
        ${solutionAttachments
					.map(
						(file) => `
          <tr>
            <td>Solution</td>
            <td>${escapeHtml(file.fileName)}</td>
            <td>${formatFileSize(file.fileSize)}</td>
            <td>${formatDateShort(file.createdAt)}</td>
          </tr>
        `,
					)
					.join("")}
        ${attachmentCount === 0 ? '<tr><td colspan="4" class="muted">No attachments recorded.</td></tr>' : ""}
      </tbody>
    </table>
  </div>

  <div class="section">
    <h2>Approval Chain</h2>
    ${data.approvalPhases
			.map(
				(phase) => `
      <h3>${escapeHtml(phase.phaseName)}</h3>
      <table>
        <thead>
          <tr><th>Stage</th><th>Approver</th><th>Level</th><th>Department</th><th>Status</th><th>Approved</th><th>Comments</th></tr>
        </thead>
        <tbody>
          ${phase.approvals
						.map(
							(approval) => `
            <tr>
              <td>${escapeHtml(approval.stage)}</td>
              <td>${escapeHtml(approval.approverName)}</td>
              <td>${approval.requiredLevel}</td>
              <td>${escapeHtml(approval.approverDepartment || approval.approverRole || "-")}</td>
              <td><span class="status ${statusClass(approval.status)}">${escapeHtml(approval.status)}</span></td>
              <td>${approval.approvedAt ? formatDate(approval.approvedAt) : "-"}</td>
              <td>${escapeHtml(approval.comments || "-")}</td>
            </tr>
          `,
						)
						.join("")}
        </tbody>
      </table>
    `,
			)
			.join("")}
  </div>

  <div class="section">
    <h2>Activity Log</h2>
    <table>
      <thead>
        <tr><th>Action</th><th>User</th><th>Date</th><th>Comments</th></tr>
      </thead>
      <tbody>
        ${data.activities
					.map(
						(activity) => `
          <tr>
            <td>${escapeHtml(activity.action)}</td>
            <td>${escapeHtml(activity.userName)}</td>
            <td>${formatDate(activity.createdAt)}</td>
            <td>${escapeHtml(activity.comments || "-")}</td>
          </tr>
        `,
					)
					.join("")}
      </tbody>
    </table>
  </div>

  <div class="footer">
    Generated on ${generatedAt} by ${escapeHtml(data.generatedBy)} from Approval System
  </div>
</body>
</html>`;
}
