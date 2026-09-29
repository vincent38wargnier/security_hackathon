// Browser QA for the attack lab main path (Try -> Understand -> Protect -> Check).
// Simulation for the full loop; Live AI only against a local lab server (key-less failure path).
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const url = process.env.LAB_URL || 'http://127.0.0.1:8793/protect';
const approvedLive = process.env.LAB_LIVE_QA === '1' && new URL(url).origin === 'https://mycompass.world' && new URL(url).pathname === '/protect';
if (!['127.0.0.1', 'localhost'].includes(new URL(url).hostname) && !approvedLive) throw new Error('Lab QA runs against localhost, or the deployed scripted /protect with LAB_LIVE_QA=1.');
if (approvedLive && process.env.LAB_QA_LIVE_FAILURE !== '0') throw new Error('Set LAB_QA_LIVE_FAILURE=0 for the public page: Live AI is disabled there.');
const output = process.env.LAB_QA_OUTPUT || '/tmp/compass-lab-qa';
const checkLive = process.env.LAB_QA_LIVE_FAILURE !== '0';
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
const errors = [], external = [], api = [], checks = [];
try {
  for (const width of [390, 768, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 900 }, reducedMotion: width === 390 ? 'reduce' : 'no-preference' });
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error' && !/status of 50\d/.test(m.text())) errors.push(m.text()); });
    page.on('request', r => { const d = new URL(r.url()); if (['http:', 'https:'].includes(d.protocol) && d.origin !== new URL(url).origin) external.push(r.url()); if (d.pathname.includes('api/')) api.push(`${width}:${r.method()} ${d.pathname}`); });
    const lab = () => page.evaluate(() => JSON.parse(window.render_lab_to_text()));
    const primary = page.getByTestId('lab-primary');
    const action = () => primary.getAttribute('data-action');
    const idle = () => page.waitForFunction(() => { const s = JSON.parse(window.render_lab_to_text()); return !s.pending; });
    const settle = async () => { await page.waitForTimeout(50); await idle(); await page.waitForTimeout(80); await idle(); };
    const detailsClosed = async () => assert.equal(await page.getByTestId('lab-details').evaluate(d => d.open), false, 'technical details stay closed');
    const shot = async (name, full = false) => {
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false, `${width}/${name}: horizontal overflow`);
      await page.waitForTimeout(350);
      await page.screenshot({ path: resolve(output, `${width}-${name}.png`), fullPage: full });
    };
    const protectAndCheck = async () => {
      assert.equal(await action(), 'protect');
      await primary.click();
      assert.equal((await lab()).view, 'protect');
      await page.getByTestId('lab-protect-card').waitFor();
      assert.equal(await action(), 'apply');
      await primary.click();
      await page.waitForFunction(() => { const s = JSON.parse(window.render_lab_to_text()); return !s.pending && s.stage === 'done'; });
      assert.match(await page.getByTestId('lab-check-attack').textContent(), /Blocked in this run/);
      assert.match(await page.getByTestId('lab-check-normal').textContent(), /Still works/);
    };

    await page.goto(url);
    await page.waitForFunction(() => typeof window.render_lab_to_text === 'function');
    let s = await lab();
    assert.equal(s.view, 'try'); assert.equal(s.level, 'direct');
    assert.match(await page.getByTestId('lab-badge').textContent(), /Simulation/);
    assert.match(await page.getByTestId('lab-progress').textContent(), /Challenge 1 of 5/);
    assert.match(await page.getByTestId('lab-message').inputValue(), /verbatim/, 'example attack is prefilled');
    assert.equal(await action(), 'test');
    assert.match(await primary.textContent(), /Test the agent/);
    await detailsClosed();
    await shot('01-first-screen');
    // Keyboard: Tab to the primary action and press Enter.
    await primary.focus();
    await page.keyboard.press('Enter');
    await settle();
    s = await lab();
    assert.equal(s.view, 'understand'); assert.equal(s.stage, 'patch');
    assert.match(await page.getByTestId('lab-outcome').textContent(), /^It worked\./);
    assert.match(await page.getByTestId('lab-answer').textContent(), /BrendaZen/);
    await detailsClosed();
    await shot('02-result');
    await page.getByTestId('lab-hint').click();
    assert.match(await page.getByTestId('lab-hint-text').textContent(), /protection rule/);
    await primary.click();
    await shot('03-protect');
    await page.getByRole('button', { name: 'Back' }).click();
    assert.equal((await lab()).view, 'understand');
    await protectAndCheck();
    await detailsClosed();
    await shot('04-check');
    assert.equal(await action(), 'next');
    await primary.click();
    assert.equal((await lab()).level, 'toolpoison');
    assert.equal((await lab()).view, 'try');

    // Challenge 2: a protection that removes the useful tool is not a win.
    await primary.click(); await settle();
    assert.equal((await lab()).stage, 'patch');
    await page.getByTestId('lab-details').locator(':scope > summary').click();
    await page.getByTestId('lab-remove-get_focus_tip').click();
    assert.equal(await action(), 'retest-protected');
    await primary.click();
    await page.waitForFunction(() => { const s = JSON.parse(window.render_lab_to_text()); return !s.pending && s.currentRuns.some(r => r.kind === 'control' && r.status !== 'pending'); });
    assert.match(await page.getByTestId('lab-check-attack').textContent(), /Blocked in this run/);
    assert.match(await page.getByTestId('lab-check-normal').textContent(), /Broken by the protection/);
    assert.notEqual((await lab()).stage, 'done');
    await shot('05-normal-task-broken');
    await page.getByTestId('lab-restore').click();
    await page.getByTestId('lab-details').locator(':scope > summary').click();
    await protectAndCheck();

    // Challenge 3: cancel counts nothing, retry works.
    await page.getByTestId('lab-challenge').selectOption('2');
    assert.equal((await lab()).level, 'mcp');
    await primary.click();
    await page.getByTestId('lab-cancel').click();
    await settle();
    s = await lab();
    assert.equal(s.stage, 'attack');
    assert.match(await page.getByTestId('lab-outcome').textContent(), /Cancelled/);
    assert.equal(await action(), 'retest');
    await primary.click(); await settle();
    assert.equal((await lab()).stage, 'patch');
    await protectAndCheck();

    // Challenge 4: a stale answer after switching challenge is ignored.
    await page.getByTestId('lab-challenge').selectOption('3');
    await primary.click();
    await page.getByTestId('lab-challenge').selectOption('4');
    await page.waitForTimeout(1200);
    s = await lab();
    assert.equal(s.level, 'confused'); assert.equal(s.currentRuns.length, 0); assert.equal(s.view, 'try');
    await page.getByTestId('lab-challenge').selectOption('3');
    await primary.click(); await settle();
    await protectAndCheck();

    // Challenge 5, then last-challenge primary.
    await primary.click();
    assert.equal((await lab()).level, 'confused');
    await primary.click(); await settle();
    await protectAndCheck();
    assert.equal(await action(), 'restart');

    // Reset and escaped input: free text in Simulation is not counted and stays text.
    await page.getByTestId('lab-reset').click();
    assert.equal((await lab()).view, 'try');
    await page.getByTestId('lab-message').fill('<img src=x onerror="window.pwned=true">');
    await primary.click(); await settle();
    assert.equal(await page.evaluate(() => window.pwned), undefined);
    s = await lab();
    assert.equal(s.stage, 'attack');
    assert.match(await page.getByTestId('lab-outcome').textContent(), /No usable answer/);

    if (checkLive) {
      await page.getByTestId('lab-source-live').click();
      assert.match(await page.getByTestId('lab-badge').textContent(), /Live AI/);
      await page.waitForFunction(() => { const h = JSON.parse(window.render_lab_to_text()).health; return h && h.state !== 'checking'; });
      assert.match(await page.getByTestId('lab-connection').textContent(), /no model key|not reachable/);
      await primary.click();
      assert.match(await page.getByTestId('lab-toast').textContent(), /budget approval/);
      await page.getByTestId('lab-consent').check();
      await primary.click();
      assert.match(await page.getByTestId('lab-toast').textContent(), /not ready\. Nothing was sent/);
      assert.equal((await lab()).currentRuns.length, 0, 'no live run when the server is not ready');
      await shot('06-live-not-ready');
      await page.getByTestId('lab-details').locator(':scope > summary').click();
      await page.locator('.lab-scan summary').click();
      await page.waitForFunction(() => /Engine:|Not available/.test(document.querySelector('.lab-scan').textContent));
      assert.equal(/Server score/.test(await page.locator('.lab-scan').textContent()), false, 'no score without a completed status');
      await page.getByTestId('lab-source-fixture').click();
    }
    await page.getByTestId('mode-drills').click();
    await page.waitForFunction(() => typeof window.render_game_to_text === 'function');
    assert.equal(JSON.parse(await page.evaluate(() => window.render_game_to_text())).phase, 'briefing');
    checks.push({ width, firstScreenTry: true, keyboard: true, hint: true, protectCheck: 5, brokenNormalTaskNotAWin: true, cancelRetry: true, staleIgnored: true, reset: true, escapedInput: true, liveNotReady: checkLive, detailsClosedByDefault: true, drillsPreserved: true });
    await context.close();
  }
  assert.deepEqual(errors, [], 'console/page errors');
  assert.deepEqual(external, [], 'unexpected external requests');
  assert.equal(api.some(a => a.includes('/api/') && !a.includes('/lab-api/')), false, 'only /lab-api is ever called');
  assert.equal(api.some(a => a.includes('POST')), false, 'no chat request was sent to the live server');
  const report = { url, checks, errors, external, apiCalls: api };
  await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); }
