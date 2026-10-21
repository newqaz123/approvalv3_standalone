/** The slice of Playwright's Page that the sign-in sequence uses. */
export interface SignInPage {
  goto(url: string): Promise<unknown>
  waitForFunction(pageFunction: () => boolean): Promise<unknown>
  locator(selector: string): { fill(value: string): Promise<void> }
  getByRole(role: 'button', options: { name: string }): { click(): Promise<void> }
  waitForURL(predicate: (url: URL) => boolean): Promise<void>
}

/** Runs in the browser: React attaches its props key to a field once it hydrates it. */
function isEmailFieldHydrated(): boolean {
  const input = document.querySelector('#email')
  return input !== null && Object.keys(input).some((key) => key.startsWith('__reactProps$'))
}

/**
 * Signs in through the real form. The form has no `method`, so submitting it
 * before React hydrates falls back to a native GET that puts the email and
 * password in the URL and never signs in. Wait for hydration first; if the
 * page never hydrates (for example the server died mid-page) this fails here
 * with a timeout instead of later with a misleading navigation error.
 */
export async function signInThroughUi(
  page: SignInPage,
  input: { baseUrl: string; email: string; password: string },
): Promise<void> {
  await page.goto(`${input.baseUrl}/sign-in`)
  await page.waitForFunction(isEmailFieldHydrated)
  await page.locator('#email').fill(input.email)
  await page.locator('#password').fill(input.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL((url) => !url.pathname.includes('/sign-in'))
}
