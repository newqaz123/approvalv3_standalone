/**
 * PDF Generation Library
 *
 * Renders the approved Slate editorial / satin ink approval packet with
 * Puppeteer: a compact slate-blue banner and footer chrome repeated on every
 * report page, plus a flowing tinted-band section body. Uses headless
 * Chromium for HTML-to-PDF conversion.
 */

import puppeteer from "puppeteer";
import type { PDFOptions } from "puppeteer";
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

export interface PdfRenderOptions {
	/**
	 * Document chrome repeats per-page chrome (banner header, page-number
	 * footer). Report pages opt in; attachment pages stay full-view without
	 * header or footer.
	 */
	documentChrome?: boolean;
	/** Puppeteer header template rendered on every page. */
	headerTemplate?: string;
	/** Puppeteer footer template rendered on every page. */
	footerTemplate?: string;
}

export interface DocumentFooterChromeInput {
	reference: string;
	generatedBy: string;
}

/**
 * Builds the repeated per-page banner chrome (Puppeteer header template).
 * Margin-box templates ignore page CSS, so every style is inline.
 */
export function buildDocumentBannerTemplate(data: RequestPDFData): string {
	const createdLabel = formatDateShort(data.createdAt);
	const completedLabel = data.completedAt
		? formatDateShort(data.completedAt)
		: "";
	const workflowRange = completedLabel
		? `${createdLabel} – ${completedLabel}`
		: createdLabel;
	const titleSize =
		data.title.length > 64 ? 16 : data.title.length > 36 ? 20 : 27;

	return `<div style="width:100%;padding:0 12mm 0;box-sizing:border-box;font-family:Arial,Helvetica,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact;">
  <div style="position:relative;overflow:hidden;border:1px solid #344b60;border-radius:8px;background:linear-gradient(110deg, #3a5269 0%, #465f76 58%, #526c83 100%);color:#fbfcfd;box-shadow:0 8px 18px rgba(38,62,83,.16);padding:5.5mm 8.5mm 5mm;">
    <div style="position:absolute;left:0;right:0;top:0;height:1.2mm;background:linear-gradient(90deg, rgba(255,255,255,.38), rgba(255,255,255,0) 68%);"></div>
    <div style="display:flex;align-items:center;gap:6mm;">
      <div style="font-size:${titleSize}px;line-height:1.05;font-weight:700;letter-spacing:-.02em;color:#ffffff;">${escapeHtml(data.title)}</div>
      <div style="margin-left:auto;flex:none;color:#edf3f7;font-size:8px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;">${escapeHtml(data.status)}</div>
    </div>
    <div style="margin-top:3mm;padding-top:2.2mm;border-top:1px solid rgba(232,240,247,.3);">
      <span style="color:#d8e2ea;font-size:9.5px;font-weight:500;">${escapeHtml(data.requester.name)} · ${escapeHtml(data.department)} · ${escapeHtml(workflowRange)}</span>
    </div>
    <div style="position:absolute;left:8.5mm;right:8.5mm;bottom:0;height:1px;background:linear-gradient(90deg,#b3c7d8,rgba(179,199,216,0));opacity:.72;"></div>
  </div>
</div>`;
}

/**
 * Builds the repeated per-page footer chrome. Without input it renders live
 * page numbers only; with document identity it prefixes the reference and
 * generated-by line like the approved packet foot.
 */
export function buildDocumentFooterTemplate(
	input?: DocumentFooterChromeInput,
): string {
	const pageNumbers = `Page <span class="pageNumber"></span> of <span class="totalPages"></span>`;
	if (!input) {
		return `<div style="width: 100%; text-align: center; font-family: Arial, Helvetica, sans-serif; font-size: 8px; color: #7c8798;">${pageNumbers}</div>`;
	}
	return `<div style="width:100%;box-sizing:border-box;display:flex;justify-content:space-between;gap:8mm;padding:2mm 12mm 0;border-top:1px solid #dce4ea;font-family:Arial,Helvetica,sans-serif;font-size:8.5px;color:#71808c;-webkit-print-color-adjust:exact;print-color-adjust:exact;">
  <span>Reference ${escapeHtml(input.reference)} · Generated on ${formatDate(new Date())} by ${escapeHtml(input.generatedBy)}</span>
  <span style="white-space:nowrap;font-weight:600;">${pageNumbers}</span>
</div>`;
}

export function resolvePdfRenderOptions(
	options: PdfRenderOptions = {},
): PDFOptions {
	const pdfOptions: PDFOptions = {
		format: "A4",
		printBackground: true,
		margin: { top: "14mm", right: "18mm", bottom: "12mm", left: "12mm" },
	};
	if (!options.documentChrome) {
		return pdfOptions;
	}
	return {
		...pdfOptions,
		// The banner chrome occupies the top margin on every report page. The
		// margin-box banner starts ~5.5mm below the page top and the tallest
		// banner plate (two-line title plus shadow) reaches ~40mm, so 45mm keeps
		// the banner fully above the first section band on every page.
		margin: { top: "45mm", right: "12mm", bottom: "14mm", left: "12mm" },
		displayHeaderFooter: true,
		headerTemplate: options.headerTemplate ?? "<span></span>",
		footerTemplate: options.footerTemplate ?? buildDocumentFooterTemplate(),
	};
}

export async function generatePdfFromHTML(
	html: string,
	options: PdfRenderOptions = {},
): Promise<Buffer> {
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

		const pdf = await page.pdf(resolvePdfRenderOptions(options));

		return Buffer.from(pdf);
	} finally {
		await browser.close();
	}
}

export async function generateRequestPDF(
	data: RequestPDFData,
): Promise<Buffer> {
	return generatePdfFromHTML(await renderRequestEvidenceHTML(data), {
		documentChrome: true,
		headerTemplate: buildDocumentBannerTemplate(data),
		footerTemplate: buildDocumentFooterTemplate({
			reference: data.referenceId || data.id || "-",
			generatedBy: data.generatedBy,
		}),
	});
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
		// Currency renders with its ISO code (THB 1.00) like the approved mockup.
		return new Intl.NumberFormat("th-TH", {
			style: "currency",
			currency,
			currencyDisplay: "code",
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

const DOCUMENT_ICON_SVG = `<svg viewBox="0 0 16 16"><path fill="#4b96fa" d="M3 1.5h6.2L13 5.3v9.2a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-12a1 1 0 0 1 1-1z"/><path fill="#fff" d="M4.5 7h7v1.2h-7zM4.5 9.4h7v1.2h-7zM4.5 11.8h4.5V13H4.5z"/></svg>`;
const SPREADSHEET_ICON_SVG = `<svg viewBox="0 0 16 16"><path fill="#21a366" d="M3 1.5h6.2L13 5.3v9.2a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-12a1 1 0 0 1 1-1z"/><path fill="#fff" d="M4.5 7.5h2v2h-2zM7 7.5h2v2H7zM9.5 7.5h2v2h-2zM4.5 10h2v2h-2zM7 10h2v2H7zM9.5 10h2v2h-2z"/></svg>`;

function attachmentIconSvg(fileName: string): string {
	return fileName.toLowerCase().endsWith(".xlsx") ||
		fileName.toLowerCase().endsWith(".xls")
		? SPREADSHEET_ICON_SVG
		: DOCUMENT_ICON_SVG;
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
	const requestAttachments = data.fileAttachments;
	const solutionAttachments = data.solution?.fileAttachments ?? [];
	const attachmentCount = requestAttachments.length + solutionAttachments.length;

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
      color: #263443;
      font-size: 10.5px;
      line-height: 1.46;
      background: #ffffff;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    p { margin: 0 0 2.2mm; }
    ul, ol { margin: 1mm 0 2.2mm 4.5mm; padding: 0; }
    li { margin: 1.1mm 0; }

    /* Main sections: tinted header band, no closed card borders. */
    .sec { min-height: 0; margin-bottom: 5.5mm; }
    /* Natural-flow pagination: sections render continuously in the approved
       order and Chromium splits them wherever the current page runs out of
       room, so the page count varies with content length. */
    .sec-head {
      background: #edf3f7;
      color: #263b50;
      font-size: 11px;
      font-weight: 800;
      letter-spacing: .07em;
      text-transform: uppercase;
      padding: 2.5mm 4mm;
      border-radius: 4px;
      margin-bottom: 3mm;
      page-break-after: avoid;
      break-after: avoid;
    }
    /* Sub-parts: hairline rule under the heading. */
    .subhead {
      font-size: 10px;
      font-weight: 800;
      letter-spacing: .06em;
      text-transform: uppercase;
      color: #263b50;
      padding-bottom: 1.5mm;
      border-bottom: 1px solid #263b50;
      margin-bottom: 2.5mm;
    }

    /* Approved cost is a full-width horizontal strip; the solution rich text
       below it is never constrained by a side column. */
    .cost-row {
      display: grid;
      grid-template-columns: auto 1fr 1fr;
      border: 1px solid #cbd9e4;
      background: #f1f6f9;
      border-radius: 8px;
      margin-bottom: 3mm;
      page-break-inside: avoid;
      break-inside: avoid;
    }
    .cost-row > div { padding: 2.5mm 4mm; border-right: 1px solid #dce7ee; min-width: 0; }
    .cost-row > div:last-child { border-right: 0; }
    .lbl { font-size: 7px; letter-spacing: .1em; text-transform: uppercase; color: #71808c; font-weight: 600; }
    .cost-row .amt { font-size: 15px; font-weight: 800; color: #4c718e; margin-top: 0.5mm; }
    .cost-row .val { margin-top: 0.5mm; font-weight: 600; }

    /* Approval status reads as plain typographic text, not an app-style chip. */
    .pill { display: inline; font-size: 8.5px; font-weight: 700; text-transform: capitalize; }
    .pill.approved { color: #4c718e; }
    .pill.rejected { color: #b42318; }
    .pill.pending { color: #71808c; }

    table { width: 100%; border-collapse: collapse; font-size: 10px; }
    /* Column headers repeat when a table continues onto the next page. */
    thead { display: table-header-group; }
    /* Report table rows never split across a page boundary. */
    .sec tr { break-inside: avoid; page-break-inside: avoid; }
    th {
      text-align: left;
      background: #f5f8fa;
      font-size: 7.5px;
      font-weight: 700;
      letter-spacing: .09em;
      text-transform: uppercase;
      color: #71808c;
      padding: 3px 6px;
      border-bottom: 1px solid #dce4ea;
    }
    td {
      padding: 3.5px 6px;
      border-bottom: 1px solid #dce4ea;
      text-align: left;
      vertical-align: top;
    }
    tr:last-child td { border-bottom: 0; }
    .nowrap { white-space: nowrap; }
    .sub { color: #71808c; font-size: 9px; margin-top: 1px; }

    /* Attachment index rows separated by hairlines. */
    .file { display: grid; grid-template-columns: 16px 1fr auto; gap: 8px; align-items: center; padding: 1.4mm 0; }
    .file + .file { border-top: 1px solid #dce4ea; }
    .file svg { width: 15px; height: 15px; }
    .file .sz { color: #71808c; font-size: 9.5px; white-space: nowrap; }

    .phase + .phase { margin-top: 3.5mm; }
    .phase { page-break-inside: avoid; break-inside: avoid; }

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
  </style>
</head>
<body>
  <div class="sec">
    <div class="sec-head">Original Request</div>
    <div class="description">${requestDescriptionHtml}</div>
  </div>

  ${
		data.solution
			? `
  <div class="sec">
    <div class="sec-head">Engineering Solution</div>
    <div class="cost-row">
      <div><span class="lbl">Approved Cost</span><div class="amt">${escapeHtml(formatCurrency(data.solution.costEstimate, data.solution.currency))}</div></div>
      <div><span class="lbl">Submitted</span><div class="val"><strong>${escapeHtml(data.solution.submittedBy)}</strong> · ${formatDate(data.solution.submittedAt)}</div></div>
      ${data.solution.timeline ? `<div><span class="lbl">Timeline</span><div class="val"><strong>${escapeHtml(data.solution.timeline)}</strong></div></div>` : ""}
    </div>
    <p><strong>${escapeHtml(data.solution.title)}</strong></p>
    <div class="description">${solutionDescriptionHtml}</div>
    ${data.solution.conceptDesign ? `<div class="subhead" style="margin-top:3mm">Concept Design</div><div class="description">${escapeHtml(data.solution.conceptDesign)}</div>` : ""}
  </div>
  `
			: ""
	}

  <div class="sec">
    <div class="sec-head">Attachment Index</div>
    ${
			attachmentCount === 0
				? '<p class="sub">No attachments recorded.</p>'
				: `${requestAttachments
						.map(
							(file) => `
    <div class="file">
      ${attachmentIconSvg(file.fileName)}
      <span>${escapeHtml(file.fileName)}<div class="sub">Request · uploaded by ${escapeHtml(file.uploadedBy)}</div></span>
      <span class="sz">${formatFileSize(file.fileSize)}</span>
    </div>`,
						)
						.join("")}${solutionAttachments
						.map(
							(file) => `
    <div class="file">
      ${attachmentIconSvg(file.fileName)}
      <span>${escapeHtml(file.fileName)}<div class="sub">Solution</div></span>
      <span class="sz">${formatFileSize(file.fileSize)}</span>
    </div>`,
						)
						.join("")}`
		}
  </div>

  <div class="sec">
    <div class="sec-head">Approval Chain</div>
    ${data.approvalPhases
			.map(
				(phase) => `
    <div class="phase">
      <div class="subhead">${escapeHtml(phase.phaseName)}</div>
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
            <td><span class="pill ${statusClass(approval.status)}">${escapeHtml(approval.status)}</span></td>
            <td class="nowrap">${approval.approvedAt ? formatDate(approval.approvedAt) : "-"}</td>
            <td>${escapeHtml(approval.comments || "-")}</td>
          </tr>`,
						)
						.join("")}
        </tbody>
      </table>
    </div>`,
			)
			.join("")}
  </div>

  <div class="sec">
    <div class="sec-head">Activity Log</div>
    <table>
      <thead>
        <tr><th style="width:21%">Action</th><th style="width:12%">User</th><th style="width:25%">Date</th><th style="width:42%">Comments</th></tr>
      </thead>
      <tbody>
        ${data.activities
					.map(
						(activity) => `
        <tr>
          <td>${escapeHtml(activity.action)}</td>
          <td>${escapeHtml(activity.userName)}</td>
          <td class="nowrap">${formatDate(activity.createdAt)}</td>
          <td>${escapeHtml(activity.comments || "-")}</td>
        </tr>`,
					)
					.join("")}
      </tbody>
    </table>
  </div>
</body>
</html>`;
}
