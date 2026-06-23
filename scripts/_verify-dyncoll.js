// Verify ④ (dynamic = saved search): apply a filter → save via the real button
// (prompt overridden so it doesn't block CDP) → check the dynamic card renders with
// ⚡ + condition chips + a LIVE count → open it and confirm the filter is restored.
// Cleans up the test collection at the end. Usage: CDP_PORT=9222 node scripts/_verify-dyncoll.js
const http = require('http');
const WebSocket = require('ws');
const PORT = process.env.CDP_PORT || 9222;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function getTarget() {
  return new Promise((resolve, reject) => {
    http.get(`http://localhost:${PORT}/json/list`, (res) => { let b = ''; res.on('data', (c) => b += c); res.on('end', () => { const l = JSON.parse(b); const p = l.find((t) => t.type === 'page' && t.url.includes('index.html')) || l.find((t) => t.type === 'page'); p ? resolve(p.webSocketDebuggerUrl) : reject(new Error('no page')); }); }).on('error', reject);
  });
}
async function main() {
  const ws = new WebSocket(await getTarget(), { maxPayload: 1 << 28 });
  let id = 0; const pe = new Map();
  ws.on('message', (d) => { const m = JSON.parse(d); if (m.id && pe.has(m.id)) { const { res, rej } = pe.get(m.id); pe.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } });
  await new Promise((r) => ws.on('open', r));
  const send = (me, pa) => new Promise((res, rej) => { const mid = ++id; pe.set(mid, { res, rej }); ws.send(JSON.stringify({ id: mid, method: me, params: pa })); });
  const ev = (e) => send('Runtime.evaluate', { expression: e, returnByValue: true }).then((r) => r.result.value);
  await send('Runtime.enable', {});
  const log = (k, v) => console.log(k.padEnd(22), typeof v === 'string' ? v : JSON.stringify(v));

  // 1) Library mode + clean filters + apply the 自分の絵 tag (tree has one leaf).
  await ev(`(()=>{const b=document.querySelector('.browse-toggle button[data-mode="posts"]');if(b)b.click();})()`); await wait(400);
  await ev(`(()=>{const r=document.getElementById('postResetBtn');if(r&&r.offsetParent!==null)r.click();})()`); await wait(300);
  await ev(`(()=>{ if(!document.querySelector('#filterRows [data-tag-group="__all"]')){const r=document.querySelector('#filterRows [data-qfrow="tag"]');if(r)r.click();} })()`); await wait(300);
  await ev(`(()=>{const s=document.querySelector('#filterRows [data-tag-group="__all"]');if(s)s.click();})()`); await wait(400);
  await ev(`(()=>{const o=document.querySelector('.qf-pop [data-qfval="自分の絵"]');if(o)o.click();})()`); await wait(400);
  await ev(`document.body.click()`); await wait(300);
  log('after filter', await ev(`(document.getElementById('postCount')||{}).textContent||null`));

  // 2) Save button visible? Then click it with prompt overridden to a fixed name.
  log('saveBtn visible', await ev(`(()=>{const b=document.getElementById('saveSearchBtn');return !!(b&&b.offsetParent!==null);})()`));
  const before = await ev(`(window.corpusFolders.allWithActive()||[]).filter(c=>c.kind==='dynamic').length`);
  await ev(`(()=>{ window.__op=window.prompt; window.prompt=()=>'⚡自分の絵テスト'; document.getElementById('saveSearchBtn').click(); window.prompt=window.__op; })()`);
  await wait(500);

  // 3) Inspect the created dynamic collection (tree + q persisted).
  const created = await ev(`(()=>{const d=(window.corpusFolders.allWithActive()||[]).filter(c=>c.kind==='dynamic'); const c=d.find(x=>x.name==='⚡自分の絵テスト'); if(!c)return JSON.stringify({err:'not found', dynCount:d.length}); return JSON.stringify({id:c.id,kind:c.kind,q:c.q||'',leaves:(c.tree&&c.tree.children||[]).map(n=>n.type+':'+n.value), items:(c.items||[]).length});})()`);
  log('dynBefore/after', `${before} -> created`);
  log('created', created);
  const cid = JSON.parse(created).id;

  // 4) Collections view: the card shows ⚡ (.col-bolt), condition chips, live count.
  await ev(`(()=>{const b=document.querySelector('.browse-toggle button[data-mode="collections"]');if(b)b.click();})()`); await wait(700);
  const card = await ev(`(()=>{const c=document.querySelector('.collection-card[data-cid="${cid}"]');if(!c)return JSON.stringify({err:'no card'});return JSON.stringify({hasDynClass:c.classList.contains('dynamic'),bolt:!!c.querySelector('.col-bolt'),cond:[...c.querySelectorAll('.collection-cond .cc')].map(e=>e.textContent),count:(c.querySelector('.collection-count')||{}).textContent||'',star:!!c.querySelector('.col-star')});})()`);
  log('card render', card);

  // 5) Open it → filter restored (count should match 19).
  await ev(`(()=>{const c=document.querySelector('.collection-card[data-cid="${cid}"]');if(c)c.click();})()`); await wait(800);
  const opened = await ev(`(()=>({count:(document.getElementById('postCount')||{}).textContent||null, chips:[...document.querySelectorAll('#queryChips .qb-pill')].map(e=>e.textContent.trim()), search:document.getElementById('searchBox').value}))()`);
  log('opened (restored)', opened);

  // 6) Right-click menu on a dynamic card: should show 更新, NOT アクティブにする.
  await ev(`(()=>{const b=document.querySelector('.browse-toggle button[data-mode="collections"]');if(b)b.click();})()`); await wait(600);
  const menu = await ev(`(()=>{const c=document.querySelector('.collection-card[data-cid="${cid}"]');if(!c)return JSON.stringify({err:'no card'});c.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:200,clientY:200}));const rows=[...document.querySelectorAll('.fold-menu.show .fm-row')].map(r=>r.dataset.cmAct+':'+r.textContent.trim());document.body.click();return JSON.stringify(rows);})()`);
  log('dyn menu rows', menu);

  // 7) Cleanup: remove the test dynamic collection.
  const removed = await ev(`(()=>{window.corpusFolders.removeCollection('${cid}');return !window.corpusFolders.byId('${cid}');})()`);
  log('cleanup removed', removed);
  ws.close();
}
main().catch((e) => { console.error('ERR', e.message); process.exit(1); });
