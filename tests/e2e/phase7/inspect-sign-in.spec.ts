import { test } from '@playwright/test';

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3000';

test('inspect sign-in page', async ({ page }) => {
  await page.goto(`${BASE_URL}/sign-in`, { timeout: 30000 });
  
  await page.screenshot({ path: 'sign-in-page.png', fullPage: true });
  
  console.log('=== Page HTML ===');
  const bodyHtml = await page.evaluate(() => document.body.innerHTML);
  console.log(bodyHtml);
  
  console.log('\n=== All input elements ===');
  const inputs = await page.locator('input').all();
  for (const input of inputs) {
    const type = await input.getAttribute('type');
    const name = await input.getAttribute('name');
    const id = await input.getAttribute('id');
    const placeholder = await input.getAttribute('placeholder');
    console.log(`Input: type=${type}, name=${name}, id=${id}, placeholder=${placeholder}`);
  }
  
  console.log('\n=== All buttons ===');
  const buttons = await page.locator('button').all();
  for (const button of buttons) {
    const text = await button.textContent();
    const type = await button.getAttribute('type');
    console.log(`Button: text="${text}", type=${type}`);
  }
  
  console.log('\n=== All elements with class containing "input" ===');
  const inputElements = await page.locator('[class*="input"]').all();
  for (const el of inputElements) {
    const tag = await el.evaluate(e => e.tagName);
    const className = await el.getAttribute('class');
    console.log(`${tag}: class="${className}"`);
  }
});
