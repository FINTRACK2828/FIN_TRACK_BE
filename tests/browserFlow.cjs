const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

module.exports = async function browserFlow({ base, email, password, fetch }) {
  const targets = await (await fetch(`${process.env.E2E_BROWSER_URL}/json/list`)).json();
  const target = targets.find(t => t.type === 'page');
  assert.ok(target, 'Headless browser page must exist');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  const pending = new Map(); let nextId = 0;
  const errors = [];
  ws.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
    if (message.id) { const item = pending.get(message.id); if (item) { pending.delete(message.id); message.error ? item.reject(new Error(message.error.message)) : item.resolve(message.result); } }
  };
  const command = (method, params = {}) => new Promise((resolve, reject) => { const id = ++nextId; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
  const evaluate = async expression => {
    const result = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  };
  const wait = async expression => {
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) { if (await evaluate(expression)) return; await new Promise(resolve => setTimeout(resolve, 200)); }
    throw new Error(`Browser timed out: ${expression}\n${(await evaluate('document.body.innerText')).slice(-1800)}`);
  };
  const click = text => evaluate(`(() => {const label=${JSON.stringify(text)}; const button = [...document.querySelectorAll('button')].find(b => b.getClientRects().length && (b.innerText.trim() === label || b.innerText.trim().startsWith(label+'\\n'))); if(!button) throw new Error('Missing button: '+label); button.click();})()`);
  const input = (selector, value) => evaluate(`(() => {const input=document.querySelector(${JSON.stringify(selector)}); if(!input) throw new Error('Missing input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)}); input.dispatchEvent(new Event('input',{bubbles:true})); input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  const screenshots = path.join(__dirname, '../artifacts/e2e'); fs.mkdirSync(screenshots, { recursive: true });
  try {
    await command('Runtime.enable'); await command('Page.enable');
    await command('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
    await command('Page.navigate', { url: `${base}/register` });
    await wait("Boolean(document.querySelector('input[placeholder=\"e.g. Ananya Rao\"]'))");
    await new Promise(resolve => setTimeout(resolve, 700));
    await input('input[placeholder="e.g. Ananya Rao"]', 'Browser Signup');
    await input('input[placeholder="name@example.com"]', `browser-${email}`);
    await input('input[placeholder="At least 10 characters"]', password);
    await input('input[placeholder="Repeat password"]', password);
    await click('Create FINTRACK Account');
    await wait("location.pathname === '/login'");
    console.log('PASS: real browser signup reaches the API and redirects to login');
    await wait("Boolean(document.querySelector('input[type=email]'))");
    await new Promise(resolve => setTimeout(resolve, 700));
    await input('input[type=email]', email); await input('input[type=password]', password);
    await click('Sign In to FINTRACK');
    await wait("document.body.innerText.includes('Welcome back, Alice!')");
    for (const [label, expected] of [['Transactions', 'Updated groceries'], ['Budgets', 'E2E Groceries'], ['Savings Goals', 'Updated laptop'], ['Recurring & Bills', 'Updated internet'], ['Reports & Analytics', 'Historical Monthly Performance'], ['Settings', 'Alice Updated'], ['Dashboard', 'Welcome back, Alice!']]) {
      await click(label); await wait(`document.body.innerText.includes(${JSON.stringify(expected)})`);
      const screenshot = await command('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(screenshots, `${label.replace(/[^a-z]/gi, '-').toLowerCase()}.png`), Buffer.from(screenshot.data, 'base64'));
    }
    await click('Add Transaction');
    await wait("Boolean(document.querySelector('input[placeholder=\"0.00\"]'))");
    await input('input[placeholder="0.00"]', '17.25');
    await input('input[placeholder^="e.g. Swiggy"]', 'Browser persisted expense');
    await click('Record Transaction');
    await wait("document.body.innerText.includes('Transaction saved')");
    await command('Page.reload');
    await wait("document.body.innerText.includes('Welcome back, Alice!')");
    await click('Transactions'); await wait("document.body.innerText.includes('Browser persisted expense')");
    await click('Budgets'); await click('Set New Budget');
    await wait("Boolean(document.querySelector('input[placeholder=\"e.g. 15000\"]'))");
    await input('input[placeholder="e.g. 15000"]', '250'); await click('Create Budget');
    await wait("document.body.innerText.includes('Budget created')");
    await click('Savings Goals'); await click('Create New Goal');
    await wait("Boolean(document.querySelector('input[placeholder=\"300000\"]'))");
    await input('input[placeholder="e.g. Home Down Payment, Paris Vacation"]', 'Browser savings goal');
    await input('input[placeholder="300000"]', '250');
    await input('input[placeholder="0"]', '25');
    await click('Create Goal'); await wait("document.body.innerText.includes('Savings goal created')");
    await click('Recurring & Bills'); await click('Add Recurring Bill');
    await wait("Boolean(document.querySelector('input[placeholder=\"1500\"]'))");
    await input('input[placeholder="e.g. JioFiber, Tata AIA Term Insurance, SIP"]', 'Browser recurring bill');
    await input('input[placeholder="1500"]', '30');
    await input('input[type=date]', new Date().toISOString().slice(0, 10));
    await click('Save Recurring Bill'); await wait("document.body.innerText.includes('Recurring bill created')");
    await click('Settings'); await input('form input[type=text]', 'Alice Browser');
    await click('Save Settings'); await wait("document.body.innerText.includes('Profile saved')");
    await command('Page.reload'); await wait("document.body.innerText.includes('Welcome back, Alice!')");
    await click('Savings Goals'); await wait("document.body.innerText.includes('Browser savings goal')");
    await click('Recurring & Bills'); await wait("document.body.innerText.includes('Browser recurring bill')");
    await click('Budgets'); await wait("document.body.innerText.includes('250')");
    await command('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await command('Page.reload'); await wait("document.body.innerText.includes('Welcome back, Alice!')");
    await evaluate("document.querySelector('button[aria-label=\"Open Navigation\"]').click()");
    await click('Savings Goals'); await wait("document.body.innerText.includes('Updated laptop')");
    const mobileScreenshot = await command('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(screenshots, 'mobile-savings.png'), Buffer.from(mobileScreenshot.data, 'base64'));
    assert.deepEqual(errors, [], 'No uncaught browser errors');
    console.log('PASS: real Chrome login, seven modules, all creation forms, profile save, refresh persistence and mobile navigation');
  } finally { ws.close(); }
};
