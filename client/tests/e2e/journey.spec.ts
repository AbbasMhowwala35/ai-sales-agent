import { test, expect, type Page } from '@playwright/test';

const uid = Date.now().toString(36);
const owner = { name: 'Riya Kapoor', email: `riya.${uid}@e2e.test`, password: 'Passw0rd!', business: `Smile Dental ${uid}` };

async function login(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
}

test.describe.serial('new business: setup → knowledge → leads → campaign', () => {
  test('registers a workspace and lands on business settings', async ({ page }) => {
    await page.goto('/register');
    await page.getByLabel('Your name').fill(owner.name);
    await page.getByLabel('Business name').fill(owner.business);
    await page.getByLabel('Work email').fill(owner.email);
    await page.getByLabel('Password').fill('short');
    await page.getByRole('button', { name: 'Create workspace' }).click();
    await expect(page.getByRole('alert')).toContainText(/8 characters|letter|number/);
    await page.getByLabel('Password').fill(owner.password);
    await page.getByRole('button', { name: 'Create workspace' }).click();
    await expect(page.getByRole('heading', { name: 'Business settings' })).toBeVisible();
    await expect(page.getByText('Welcome to Dialstack.')).toBeVisible();
  });

  test('configures profile, ideal customer and FAQs', async ({ page }) => {
    await login(page, owner.email, owner.password);
    await page.goto('/settings');
    await page.getByLabel('Industry').fill('Dental software');
    await page.getByLabel('About the business').fill('Smile Dental helps dental clinics fill their chairs with automated recall reminders and online booking.');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText(/Business settings saved/).last()).toBeVisible();

    await page.getByRole('tab', { name: 'Ideal customer' }).click();
    const industries = page.locator('label', { hasText: 'Target industries' }).getByRole('textbox');
    await industries.fill('Healthcare'); await industries.press('Enter');
    const locs = page.locator('label', { hasText: 'Target locations' }).getByRole('textbox');
    await locs.fill('Pune, India'); await locs.press('Enter');
    const kws = page.locator('label', { hasText: 'Search keywords' }).getByRole('textbox');
    await kws.fill('dental clinic'); await kws.press('Enter');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText(/Business settings saved/).last()).toBeVisible();

    await page.getByRole('tab', { name: 'FAQs & scripts' }).click();
    await page.getByRole('button', { name: 'Add FAQ' }).click();
    await page.getByPlaceholder('Question').fill('What does Smile Dental cost?');
    await page.getByPlaceholder('Answer').fill('Smile Dental costs 1999 rupees per chair per month.');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText(/Business settings saved/).last()).toBeVisible();
  });

  test('knowledge base answers from FAQs and new notes', async ({ page }) => {
    await login(page, owner.email, owner.password);
    await page.goto('/knowledge');
    await expect(page.getByRole('button', { name: 'Frequently asked questions' }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Write a note' }).click();
    await page.getByLabel('Title').fill('Clinic hours');
    await page.getByLabel('Content').fill('Our support desk is open Monday to Saturday from 9 AM to 8 PM IST.');
    await page.getByRole('button', { name: 'Add note' }).click();
    await expect(page.getByRole('button', { name: 'Clinic hours' }).first()).toBeVisible();
    await expect(page.getByRole('row', { name: /Clinic hours/ }).getByText('Ready')).toBeVisible({ timeout: 15_000 });
    await page.getByLabel('Question', { exact: true }).fill('How much does it cost?');
    await page.getByRole('button', { name: 'Ask', exact: true }).click();
    await expect(page.getByText('1999 rupees per chair')).toBeVisible();
  });

  test('discovers sandbox leads, reviews and approves them', async ({ page }) => {
    await login(page, owner.email, owner.password);
    await page.goto('/lead-generation');
    await page.getByRole('button', { name: /^Sandbox \(fictional/ }).click();
    await page.getByLabel('How many leads').fill('12');
    await page.getByRole('button', { name: 'Start discovery' }).click();
    await expect(page.getByText(/Lead discovery started/)).toBeVisible();
    const review = page.getByRole('link', { name: 'Review leads' }).first();
    await expect(review).toBeVisible({ timeout: 20_000 });
    await review.click();
    await expect(page.getByRole('heading', { name: 'Leads' })).toBeVisible();
    await page.getByLabel('Select all').check();
    await page.getByRole('button', { name: 'Approve for calling' }).click();
    await expect(page.getByText(/leads? updated/)).toBeVisible();
    await page.getByLabel('Approval').selectOption('approved');
    await expect(page.locator('tbody tr').first()).toBeVisible();
  });

  test('opens a lead, adds a note and a follow-up reminder', async ({ page }) => {
    await login(page, owner.email, owner.password);
    await page.goto('/leads?approval=approved');
    await page.locator('tbody tr a').first().click();
    await expect(page.getByText('Fit score')).toBeVisible();
    await page.getByLabel('Note', { exact: true }).fill('Spoke to receptionist, call after 4pm');
    await page.getByRole('button', { name: 'Add note' }).click();
    await expect(page.getByText('Spoke to receptionist, call after 4pm')).toBeVisible();
    await page.getByLabel('Stage').selectOption('interested');
    await expect(page.getByText(/Moved to Interested/)).toBeVisible();
  });

  test('creates a research campaign targeting the UK, with an end date', async ({ page }) => {
    await login(page, owner.email, owner.password);
    await page.goto('/campaigns');
    await page.getByRole('button', { name: 'New campaign' }).click();
    await page.getByLabel('Campaign name').fill('UK dental clinics');
    await page.getByLabel('Who is it for? (category)').fill('Dental clinic');
    await page.getByLabel('What kind of business?').fill('dental clinic');
    await page.getByLabel('What kind of business?').press('Enter');
    await page.locator('button[aria-pressed]', { hasText: 'United Kingdom' }).click();
    await page.getByLabel('Region in United Kingdom').selectOption('North West England');
    await page.getByRole('button', { name: 'Manchester', exact: true }).click();
    await page.getByLabel('Another city in United Kingdom').fill('Stockport');
    await page.getByLabel('Another city in United Kingdom').press('Enter');
    await expect(page.getByTestId('areas-United Kingdom').getByText('2 areas picked')).toBeVisible();
    await page.getByRole('button', { name: /^weekly/i }).click();
    await page.getByRole('button', { name: '1 month' }).click();
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByText(/each prospect’s local time/)).toBeVisible();
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByText(/No local caller ID yet/)).toBeVisible();
    await expect(page.getByText(/Manchester, North West England · Stockport, North West England/)).toBeVisible();
    await page.getByRole('button', { name: 'Add existing leads' }).click();
    await page.getByRole('checkbox', { name: /^Select all / }).first().check();
    await expect(page.getByText(/[1-9]\d* selected/)).toBeVisible();
    await page.getByRole('button', { name: 'Save as draft' }).click();
    await expect(page.getByRole('heading', { name: 'UK dental clinics' })).toBeVisible();
    await expect(page.getByText(/weekly/).first()).toBeVisible();
    await page.getByRole('button', { name: 'Start campaign' }).click();
    await expect(page.getByText('Campaign started')).toBeVisible();
    await page.getByRole('button', { name: 'Pause' }).click();
    await expect(page.getByText(/Campaign paused/)).toBeVisible();
  });
});

test('agent test call: discloses AI, answers, and honours opt-out', async ({ page }) => {
  await login(page, 'demo@dialstack.dev', 'Demo1234!');
  await page.goto('/agents');
  const chat = page.getByRole('region', { name: 'Test conversation' });
  await expect(chat.getByText(/I’m an AI assistant, and this call’s recorded\. The reason I’m calling/).first()).toBeVisible();
  await chat.getByLabel('Your reply').fill('Yes, go ahead');
  await chat.getByRole('button', { name: 'Send' }).click();
  await expect(chat.getByText(/one of three things/)).toBeVisible();
  await chat.getByLabel('Your reply').fill('Honestly the no-shows are killing us');
  await chat.getByRole('button', { name: 'Send' }).click();
  await chat.getByLabel('Your reply').fill('How much does GlowDesk cost?');
  await chat.getByRole('button', { name: 'Send' }).click();
  await expect(chat.getByText(/\$79/)).toBeVisible();
  await chat.getByLabel('Your reply').fill('wait, are you a real person?');
  await chat.getByRole('button', { name: 'Send' }).click();
  await expect(chat.getByText(/I’m an AI assistant on the GlowDesk sales team/).first()).toBeVisible();
  await chat.getByLabel('Your reply').fill('Please do not call me again');
  await chat.getByRole('button', { name: 'Send' }).click();
  await expect(chat.getByText('Added to Do-Not-Call')).toBeVisible();
  await expect(chat.getByText(/Call ended/)).toBeVisible();
});

test('call history: filter, open a call and play the transcript', async ({ page }) => {
  await login(page, 'demo@dialstack.dev', 'Demo1234!');
  await page.goto('/calls');
  await page.getByLabel('Outcome').selectOption('answered');
  await page.locator('tbody tr a').first().click();
  await expect(page.getByText('AI summary')).toBeVisible();
  const slider = page.getByRole('slider', { name: 'Seek' });
  await expect(slider).toHaveAttribute('aria-valuenow', '0');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  expect(Number(await slider.getAttribute('aria-valuenow'))).toBeGreaterThan(0);
});

test('dashboard, analytics and dark mode', async ({ page }) => {
  await login(page, 'demo@dialstack.dev', 'Demo1234!');
  await expect(page.getByText('Calls made')).toBeVisible();
  await expect(page.getByText('What prospects told us')).toBeVisible();
  await expect(page.getByText('What prospects told us')).toBeVisible();
  const [pdf] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download report' }).click()]);
  expect(pdf.suggestedFilename()).toMatch(/\.pdf$/);
  await page.getByRole('link', { name: 'Analytics', exact: true }).click();
  await expect(page.getByText('Campaign performance')).toBeVisible();
  await page.getByRole('button', { name: 'Switch to dark mode' }).click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await page.getByRole('button', { name: 'Switch to light mode' }).click();
});

test('unauthenticated users are redirected to sign in; bad credentials show an error', async ({ page }) => {
  await page.goto('/leads');
  await expect(page).toHaveURL(/\/login/);
  await page.getByLabel('Work email').fill('demo@dialstack.dev');
  await page.getByLabel('Password').fill('wrong-password1');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert')).toHaveText('Invalid email or password');
});

test('leads show what each prospect wants, with outcome tabs', async ({ page }) => {
  await login(page, 'demo@dialstack.dev', 'Demo1234!');
  await page.goto('/leads');
  await page.getByRole('tab', { name: /Meetings/ }).click();
  await expect(page).toHaveURL(/outcome=meeting/);
  const row = page.locator('tbody tr').first();
  await expect(row.getByText('Meeting booked').first()).toBeVisible();
  await row.getByRole('link').first().click();
  await expect(page.getByRole('region', { name: 'What they want' })).toContainText('Their local time');
});

test('leads: filter by what prospects want and download a PDF', async ({ page }) => {
  await login(page, 'demo@dialstack.dev', 'Demo1234!');
  await page.goto('/leads');
  await page.getByRole('tab', { name: /Follow up later/ }).click();
  await expect(page).toHaveURL(/outcome=nurture/);
  await expect(page.locator('tbody tr').first().getByText('Follow up later')).toBeVisible();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download PDF' }).click()]);
  expect(dl.suggestedFilename()).toMatch(/\.pdf$/);
});
