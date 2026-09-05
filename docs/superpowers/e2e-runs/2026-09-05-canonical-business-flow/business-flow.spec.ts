import { test, expect, Page } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const config = JSON.parse(readFileSync('/Users/red-copperpot/.config/portly/config.json', 'utf8'));
const server = config.projects.find((p: any) => p.name === 'ApprovalAppV3-CanonicalForms').servers.find((s: any) => s.port === 3201);
const prisma = new PrismaClient({ datasources: { db: { url: server.env.DATABASE_URL } } });

test('canonical request through rejection, solution and final completion', async ({ browser }, info) => {
  let title = `Canonical business flow ${new Date().toISOString()}`;
  const contexts: any[] = [];
  const diagnostics: any[] = [];
  const evidence: any[] = [];
  let requestId: string | undefined = process.env.RESUME_REQUEST_ID;
  let resumeStatus = '';
  if (requestId) {
    const existing = await prisma.requests.findUniqueOrThrow({ where: { id: requestId }, include: { requester: true } });
    expect(existing.requester.email).toBe('canonical.requester@example.com');
    expect(['SentToEngineer', 'DesignCostEstimationApproval']).toContain(existing.status);
    resumeStatus = existing.status;
    title = existing.title;
  }
  async function snap(page: Page, name: string) {
    await page.bringToFront();
    // Deliberate viewing pause requested by the user, not a readiness wait.
    await page.waitForTimeout(6000);
    await page.screenshot({ path: info.outputPath(`${name}.png`), fullPage: true });
    console.log(`CAPTURE ${name}`);
  }
  async function actor(name: string) {
    const context = await browser.newContext({ baseURL: 'http://localhost:3201', viewport: { width: 1440, height: 1000 }, recordVideo: { dir: info.outputPath('videos') } });
    contexts.push(context);
    context.on('page', (p: Page) => {
      p.on('pageerror', e => diagnostics.push({ actor: name, type: 'pageerror', message: e.message }));
      p.on('console', m => { if (m.type() === 'error') diagnostics.push({ actor: name, type: 'console', message: m.text() }); });
      p.on('response', r => { if (r.status() >= 400) diagnostics.push({ actor: name, type: 'http', status: r.status(), url: r.url() }); });
    });
    const page = await context.newPage();
    await page.bringToFront();
    await page.goto('/sign-in');
    await page.getByRole('textbox', { name: 'Email address' }).fill(`canonical.${name}@example.com`);
    await page.getByRole('textbox', { name: 'Password' }).fill('changeme');
    await page.waitForTimeout(3000);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.waitForURL(u => !u.pathname.includes('sign-in'));
    return page;
  }
  async function record() {
    return prisma.requests.findUnique({ where: { id: requestId! }, include: { approvals: { orderBy: { order: 'asc' } }, solutions: { include: { approvals: { orderBy: { order: 'asc' } } } } } });
  }
  async function state(label: string, status: string) {
    await expect.poll(async () => (await record())?.status).toBe(status);
    const row = await record(); evidence.push({ label, row });
    console.log(`STATE ${label}: ${row?.status}`);
  }
  async function open(page: Page) {
    await page.bringToFront();
    await page.goto(`/requests?requestId=${encodeURIComponent(requestId!)}`);
    await expect.poll(async () => {
      return page.evaluate(expected => [...document.querySelectorAll('[role="dialog"]')].some(dialog =>
        (dialog.textContent || '').includes(expected)
        || (dialog.querySelector('#title') as HTMLInputElement)?.value === expected), title);
    }).toBe(true);
  }
  async function decision(page: Page, reject = false) {
    await page.bringToFront();
    await page.waitForTimeout(5000);
    const entry = page.getByRole('button', { name: 'Approve or Reject', exact: true });
    if (await entry.isVisible()) await entry.click();
    await page.getByRole('button', { name: reject ? /^(Reject|Reject Solution)$/ : /^(Approve|Approve Solution)$/, exact: true }).click();
    if (reject) {
      await page.getByPlaceholder('Please explain the reason for rejection...').fill('Please clarify the expected business benefit.');
      await page.waitForTimeout(5000);
      await page.getByRole('button', { name: 'Confirm Rejection', exact: true }).click();
    } else {
      const confirm = page.getByRole('button', { name: 'Confirm Approval', exact: true });
      if (await confirm.isVisible()) {
        await page.getByPlaceholder('Add an optional comment for your approval...').fill('Verified canonical business flow.');
        await page.waitForTimeout(5000);
        await confirm.click();
      }
    }
  }
  try {
    const requester = await actor('requester');
    const requestApprover = await actor('request.approver');
    if (!process.env.RESUME_REQUEST_ID) {
    await requester.bringToFront();
    await requester.goto('/requests');
    await requester.getByRole('button', { name: 'New Request', exact: true }).click();
    await requester.locator('#title').fill(title);
    await requester.locator('.rich-text[role="textbox"]').fill('Improve the PD1 inspection station to reduce inspection time and improve safety.');
    await snap(requester, '01-create-form');
    await requester.getByRole('button', { name: 'Submit Request', exact: true }).click();
    await expect.poll(async () => (await prisma.requests.findFirst({ where: { title } }))?.id).toBeTruthy();
    requestId = (await prisma.requests.findFirstOrThrow({ where: { title } })).id;
    console.log(`REQUEST ${requestId} ${title}`);
    await state('created', 'ImprovementRequest');
    await open(requester); await snap(requester, '02-created');

    await open(requestApprover); await decision(requestApprover, true);
    await expect.poll(async () => (await record())?.approvals.some(a => a.status === 'rejected')).toBe(true);
    await state('rejected', 'ImprovementRequest');
    await open(requester); await snap(requester, '03-rejected');
    await requester.locator('.rich-text[role="textbox"]').fill('Clarified benefit: reduce inspection time by 20 percent and improve operator safety.');
    await requester.getByRole('button', { name: 'Resubmit Request', exact: true }).click();
    await expect.poll(async () => (await record())?.approvals.every(a => a.status === 'pending')).toBe(true);
    await state('resubmitted', 'ImprovementRequest');
    await open(requester); await snap(requester, '04-resubmitted');
    await open(requestApprover); await decision(requestApprover);
    await state('request-approved', 'SentToEngineer');
    await open(requester); await snap(requester, '05-request-approved');
    } else {
      await state('resumed', resumeStatus);
    }

    if (resumeStatus !== 'DesignCostEstimationApproval') {
    const engineer = await actor('engineer');
    await engineer.goto('/engineering');
    await engineer.getByRole('button', { name: /Follow up work/i }).click();
    const row = engineer.getByTestId('engineering-request-row').filter({ hasText: title });
    await row.getByRole('button', { name: 'Submit solution', exact: true }).click();
    await snap(engineer, '05b-engineer-request-review');
    await engineer.getByRole('dialog').getByRole('button', { name: 'Submit Solution', exact: true }).click();
    await engineer.locator('#solutionTitle').fill(`Inspection station solution ${requestId}`);
    await engineer.locator('.rich-text[role="textbox"]').fill('Install an adjustable inspection fixture with improved guarding and operator instructions.');
    await engineer.locator('#cost').fill('12000');
    await engineer.locator('#timeline').fill('2 weeks');
    await snap(engineer, '06-solution-form');
    const link = engineer.getByRole('link', { name: 'View Original Request' });
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    const popupPromise = engineer.waitForEvent('popup');
    await link.click();
    const popup = await popupPromise;
    await popup.waitForURL(`**/requests?requestId=${requestId}`);
    await expect(popup.getByRole('dialog').last()).toContainText(title);
    await snap(popup, '07-original-before-submission');
    await engineer.bringToFront();
    await engineer.getByRole('button', { name: 'Submit Solution', exact: true }).click();
    await state('solution-submitted', 'DesignCostEstimationApproval');
    await expect(engineer.locator('#solutionTitle')).toBeHidden();
    await snap(engineer, '08-solution-submitted');
    await popup.bringToFront();
    await expect(popup).toHaveURL(`http://localhost:3201/requests?requestId=${requestId}`);
    await expect(popup.getByRole('dialog').last()).toContainText(title);
    await snap(popup, '09-original-retained-after-submission');
    await popup.reload();
    await expect(popup.getByRole('dialog').last()).toContainText(title);
    await snap(popup, '10-original-reloaded-after-submission');
    }

    const solutionApprover = await actor('solution.approver');
    await open(solutionApprover); await decision(solutionApprover);
    await state('solution-approved', 'SendBackToRequester');
    await open(requester); await snap(requester, '11-solution-approved');
    await requester.getByRole('button', { name: 'Submit Final Approval', exact: true }).click();
    await snap(requester, '12-final-approval-form');
    await requester.getByRole('button', { name: 'Start Final Approval', exact: true }).click();
    await state('final-initiated', 'FinalApproval');
    await open(requester); await snap(requester, '13-final-pending');
    await open(requestApprover); await decision(requestApprover);
    await state('completed', 'Completed');
    await open(requester);
    await expect(requester.getByText('Final Approval Completed', { exact: true })).toBeVisible();
    await expect(requester.getByText('All Approvals Complete', { exact: true })).toBeVisible();
    await snap(requester, '14-completed-reopened');
    const final = await record();
    expect(final!.approvals.filter(a => a.isFinalApproval)).toHaveLength(1);
    expect(final!.approvals.every(a => a.status === 'approved')).toBe(true);
    expect(final!.solutions).toHaveLength(1);
    expect(final!.solutions[0].approvals).toHaveLength(1);
    expect(final!.solutions[0].approvals[0].status).toBe('approved');
    expect(diagnostics.filter(d => d.type === 'pageerror')).toEqual([]);
  } finally {
    writeFileSync(info.outputPath('database-evidence.json'), JSON.stringify({ title, requestId, evidence }, null, 2));
    writeFileSync(info.outputPath('browser-diagnostics.json'), JSON.stringify(diagnostics, null, 2));
    for (let i = 0; i < contexts.length; i++) {
      for (const [j, p] of contexts[i].pages().entries()) {
        await p.screenshot({ path: info.outputPath(`last-actor-${i}-page-${j}.png`), fullPage: true }).catch(() => {});
        writeFileSync(info.outputPath(`last-actor-${i}-page-${j}.txt`), await p.locator('body').innerText().catch(() => 'unavailable'));
      }
      await contexts[i].close();
    }
    await prisma.$disconnect();
  }
});
