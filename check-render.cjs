// Render check for the Agent Fit Check embed (708x400, 16:9, no scroll).
// Usage: node check-render.cjs <file-url-or-live-url> [shots] [quick]
// Needs: npm i puppeteer-core, and Google Chrome installed.
const puppeteer = require('puppeteer-core');
const url = process.argv[2];
const shots = process.argv.includes('shots');
const quick = process.argv.includes('quick');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SIZES = quick ? [[708, 400], [375, 211]] : [[708, 400], [629, 354], [560, 315], [375, 211], [629, 416], [708, 520]];
const wait = ms => new Promise(r => setTimeout(r, ms));
if (!url) { console.log('Usage: node check-render.cjs <url> [shots] [quick]'); process.exit(2); }

// every answer combination the quiz allows
const OPTS = {
  data: ['personal', 'work', 'client'], training: ['optout', 'strict'], region: ['na', 'europe', 'elsewhere'],
  help: ['everyday', 'computer', 'messages', 'models'], upkeep: ['nobody', 'technical'],
  budget: ['under20', 'upto30', 'chatgpt', 'google', 'more'],
};
function* combos() {
  for (const data of OPTS.data) for (const training of OPTS.training) for (const region of OPTS.region)
    for (const help of OPTS.help) for (const upkeep of OPTS.upkeep) for (const budget of OPTS.budget)
      yield { data, training, region, help, upkeep, budget };
}

const probe = () => {
  const vis = e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const card = document.querySelector('.card').getBoundingClientRect();
  const out = [];
  if (document.documentElement.scrollHeight > innerHeight + 1 || document.documentElement.scrollWidth > innerWidth + 1) out.push('page scrolls');
  document.querySelectorAll('.card *').forEach(e => {
    if (!vis(e)) return;
    const r = e.getBoundingClientRect();
    if (r.bottom > card.bottom + .5 || r.right > card.right + .5 || r.top < card.top - .5 || r.left < card.left - .5) out.push('outside card: ' + e.tagName + '.' + e.className);
  });
  // the active screen's content region must not clip its children
  const scr = [...document.querySelectorAll('.screen')].find(s => !s.hidden);
  const region = document.getElementById('s-r').hidden ? scr : document.getElementById('body');
  const rr = region.getBoundingClientRect();
  region.querySelectorAll('*').forEach(e => {
    if (!vis(e)) return;
    const r = e.getBoundingClientRect();
    if (r.bottom > rr.bottom + .5 || r.right > rr.right + .5) out.push('clipped: ' + e.tagName + '.' + e.className + ' "' + (e.textContent || '').slice(0, 24) + '"');
  });
  document.querySelectorAll('.tab,.btn,.qtitle,.name,h1').forEach(e => {
    if (vis(e) && e.scrollWidth > e.clientWidth + 1) out.push('truncated: ' + (e.className || e.tagName));
  });
  const tabs = document.getElementById('tabs');
  if (!document.getElementById('s-r').hidden && tabs.scrollWidth > tabs.clientWidth + 1) out.push('tabs overflow');
  return out;
};

(async () => {
  const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
  let fails = 0, checks = 0; const seen = new Set();
  for (const [w, h] of SIZES) {
    const p = await b.newPage();
    await p.setViewport({ width: w, height: h, deviceScaleFactor: 2 });
    await p.goto(url, { waitUntil: 'load' });
    await p.evaluate(() => document.fonts.ready);
    if (!(await p.evaluate(() => document.fonts.check('16px "Season Mix"') && document.fonts.check('16px Inter')))) { fails++; console.log(`FAIL ${w}x${h} fonts not loaded`); }
    const note = (label, issues) => { checks++; if (issues.length) { fails++; const k = `${w}x${h} ${label}: ${[...new Set(issues)].join(' | ')}`; if (!seen.has(k) && seen.size < 40) { seen.add(k); console.log('FAIL ' + k); } } };
    // intro
    note('intro', await p.evaluate(probe));
    if (shots) await p.screenshot({ path: `shot-${w}x${h}-intro.png` });
    // each question with its longest state: click through every option
    for (let qi = 0; qi < 6; qi++) {
      await p.evaluate(qi => { window.agentFitCheck.questions; }, qi);
    }
    await p.evaluate(() => document.getElementById('start').click());
    for (let qi = 0; qi < 6; qi++) {
      const n = await p.evaluate(() => document.querySelectorAll('.choice').length);
      for (let oi = 0; oi < n; oi++) {
        await p.evaluate(oi => document.querySelectorAll('.choice input')[oi].click(), oi);
        note(`question ${qi + 1} option ${oi + 1}`, await p.evaluate(probe));
      }
      if (shots) await p.screenshot({ path: `shot-${w}x${h}-q${qi + 1}.png` });
      if (qi < 5) await p.evaluate(() => document.getElementById('next').click());
    }
    // results: every answer combination, every tab it offers
    const all = [...combos()];
    const step = quick ? 9 : (w === 708 && h === 400 ? 1 : 7);
    for (let i = 0; i < all.length; i += step) {
      const a = all[i];
      const tabs = await p.evaluate(a => { window.agentFitCheck.showResult(a); return [...document.querySelectorAll('.tab')].map(t => t.dataset.tab); }, a);
      for (const t of tabs) {
        await p.evaluate((a, t) => window.agentFitCheck.showResult(a, t), a, t);
        note(`result ${Object.values(a).join('/')} tab ${t}`, await p.evaluate(probe));
      }
    }
    if (shots) {
      const demo = { data: 'work', training: 'optout', region: 'europe', help: 'computer', upkeep: 'technical', budget: 'more' };
      for (const t of ['pick', 'alt', 'why', 'setup', 'answers']) { await p.evaluate((a, t) => window.agentFitCheck.showResult(a, t), demo, t); await p.screenshot({ path: `shot-${w}x${h}-r-${t}.png` }); }
    }
    await p.close();
  }
  await b.close();
  console.log(fails ? `${fails} failure(s) in ${checks} checks` : `PASS: ${SIZES.length} sizes, ${checks} checks (intro, every question option, every answer combination and result tab), nothing clipped, nothing scrolls`);
  process.exit(fails ? 1 : 0);
})();
