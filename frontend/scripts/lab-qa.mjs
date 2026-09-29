// Browser QA for the attack lab. Scripted fixture for the full loop; Live AI only against a
// local lab server (the key-less failure path by default). Never targets a public deployment.
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
    const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 960 }, reducedMotion: width === 390 ? 'reduce' : 'no-preference', acceptDownloads: true });
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error' && !/lab-api\/(health|chat).*50\d|status of 50\d/.test(m.text())) errors.push(m.text()); });
    page.on('request', r => { const d = new URL(r.url()); if (['http:', 'https:'].includes(d.protocol) && d.origin !== new URL(url).origin) external.push(r.url()); if (d.pathname.includes('api/')) api.push(`${width}:${r.method()} ${d.pathname}`); });
    const lab = () => page.evaluate(() => JSON.parse(window.render_lab_to_text()));
    const click = id => page.getByTestId(id).click();
    const shot = async name => {
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false, `${width}/${name}: horizontal overflow`);
      await page.waitForTimeout(400);
      await page.screenshot({ path: resolve(output, `${width}-${name}.png`), fullPage: name.endsWith('full') });
    };
    const waitIdle = () => page.waitForFunction(() => !JSON.parse(window.render_lab_to_text()).pending);
    await page.goto(url);
    await page.waitForFunction(() => typeof window.render_lab_to_text === 'function');
    assert.equal((await lab()).stage, 'attack');
    assert.equal((await lab()).step, 'Inspect');
    assert.match(await page.getByTestId('lab-connection').textContent(), /Scripted fixture/);
    await shot('01-start');
    // Level 1, keyboard start: focus the primary action and press Enter.
    await page.getByTestId('lab-load-attack').focus();
    await page.keyboard.press('Enter');
    assert.match(await page.getByTestId('lab-draft').inputValue(), /verbatim/);
    await click('lab-attack');
    assert.equal((await lab()).pending, true);
    await waitIdle();
    let s = await lab();
    assert.equal(s.stage, 'patch');
    assert.match(await page.getByTestId('lab-verdict').textContent(), /Objective reached/);
    await shot('02-attack');
    // Replay without a patch is refused (button is Apply suggested patch).
    assert.equal(await page.getByTestId('lab-replay').count(), 0);
    await click('lab-hint');
    await click('lab-patch');
    await shot('03-patched');
    await click('lab-replay');
    await waitIdle();
    assert.equal((await lab()).stage, 'control');
    assert.match(await page.getByTestId('lab-after').textContent(), /Not observed in this run/);
    assert.match(await page.getByTestId('lab-compare').textContent(), /Identical input/);
    await click('lab-control');
    await waitIdle();
    s = await lab();
    assert.equal(s.stage, 'done');
    assert.match(await page.getByTestId('lab-control-result').textContent(), /Legitimate work observed/);
    assert.match(await page.getByTestId('lab-explain').textContent(), /not observed in this run/);
    assert.equal(s.step, 'Explain');
    await shot('04-done');
    // Level 2: removing the tool is not a win.
    await click('lab-next');
    assert.equal((await lab()).level, 'toolpoison');
    await click('lab-load-attack'); await click('lab-attack'); await waitIdle();
    assert.equal((await lab()).stage, 'patch');
    await page.getByTestId('lab-remove-get_focus_tip').click();
    await click('lab-replay'); await waitIdle();
    await click('lab-control'); await waitIdle();
    s = await lab();
    assert.equal(s.stage, 'patch', 'control failed after removing the useful tool');
    assert.match(await page.getByTestId('lab-control-result').textContent(), /Control failed/);
    await shot('05-control-failed');
    await page.getByRole('button', { name: 'Restore original' }).click();
    await click('lab-apply-fix');
    await click('lab-replay'); await waitIdle();
    await click('lab-control'); await waitIdle();
    assert.equal((await lab()).stage, 'done');
    // Levels 3-5 with the suggested patch; cancel once on level 3.
    for (const id of ['mcp', 'exfil', 'confused']) {
      await click(`lab-level-${id}`);
      await click('lab-load-attack');
      if (id === 'mcp') {
        await click('lab-attack');
        await click('lab-cancel');
        await waitIdle();
        assert.equal((await lab()).stage, 'attack', 'cancel counts nothing');
        await click('lab-retry');
        await waitIdle();
      } else {
        await click('lab-attack'); await waitIdle();
      }
      assert.equal((await lab()).stage, 'patch', `${id} attack observed`);
      if (id === 'confused') await shot('06-confused-attack');
      await click('lab-patch');
      await click('lab-replay'); await waitIdle();
      await click('lab-control'); await waitIdle();
      assert.equal((await lab()).stage, 'done', `${id} done`);
    }
    await page.getByTestId('lab-summary').waitFor();
    await shot('07-summary');
    // Rendered attack strings stay text.
    await click('lab-reset');
    await page.getByTestId('lab-draft').fill('<img src=x onerror="window.pwned=true">');
    await click('lab-attack'); await waitIdle();
    assert.equal(await page.evaluate(() => window.pwned), undefined);
    assert.equal((await lab()).stage, 'attack', 'free text in fixture mode is inconclusive, not counted');
    // Live mode against a local key-less server: disconnected/no-key label, nothing silently faked.
    if (checkLive) {
      await click('lab-source-live');
      await page.waitForFunction(() => { const h = JSON.parse(window.render_lab_to_text()).health; return h && h.state !== 'checking'; });
      const conn = await page.getByTestId('lab-connection').textContent();
      assert.match(conn, /Live: (server has no provider key|not connected)/);
      await click('lab-load-attack');
      await click('lab-attack');
      assert.equal((await lab()).currentRuns.length, 0, 'no live run without consent and readiness');
      await click('lab-consent');
      await click('lab-attack');
      assert.equal((await lab()).currentRuns.length, 0, 'no live run when the server is not ready');
      await shot('08-live-gate');
      await page.locator('.lab-scan summary').click();
      await page.waitForFunction(() => /Engine:|Not available/.test(document.querySelector('.lab-scan').textContent));
      assert.equal(/Server score/.test(await page.locator('.lab-scan').textContent()), false, 'no score without findings');
      await click('lab-source-fixture');
    }
    // Offline drills remain available and intact.
    await click('mode-drills');
    await page.waitForFunction(() => typeof window.render_game_to_text === 'function');
    assert.equal(JSON.parse(await page.evaluate(() => window.render_game_to_text())).phase, 'briefing');
    assert.match(page.url(), /mode=drills/);
    await shot('09-drills');
    checks.push({ width, keyboardStart: true, attackPatchReplayControl: 5, toolRemovalNotAWin: true, cancelRetry: true, escapedInput: true, liveGate: checkLive, drillsPreserved: true });
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
