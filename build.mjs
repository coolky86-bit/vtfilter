// 빈티지톡 상품필터 — 분류별 상품 목록 파일 만들기 (GitHub Actions에서 1시간마다 실행)
// 1) 쇼핑몰 공개 자료 파일(vtf_data.html)로 대분류 상품을 읽음: 이름·브랜드·가격·할인가·실측·품절·사진
// 2) 카페24 앱(빈티지톡 상품필터, 읽기 전용 Front API)으로 상품 검색어 태그와 분류(소분류까지) 소속을 읽음
// 3) out/c/<분류번호>.json 으로 저장 → GitHub Pages가 인터넷에 올림 → 필터가 파일 하나만 받음
// 비밀값 없음: Front API는 앱 번호(Client ID)만 씀. 앱 권한 = 상품·상품분류 읽기.
import fs from "node:fs/promises";

const MALL = "oldmarket";
const CID = process.env.CAFE24_CLIENT_ID || "Jx8qsVH5ChOjryWdkLC64A";
const API = `https://${MALL}.cafe24api.com/api/v2`;
const SITE = `https://${MALL}.cafe24.com`;
const SKIN = process.env.VTF_SKIN || "/skin-skin69"; // vtf_data.html 이 있는 디자인 (대표에 넣으면 "" 로)
const OUT = process.env.OUT_DIR || "out";
const TOPS = (process.env.VTF_TOPS || "2459,2460,1835,2422,2421,2140,2175,2141,2134").split(",");
const UA = { "user-agent": "vtfilter-index/1.0 (+https://github.com/coolky86-bit/vtfilter)" };
const log = (...a) => {
  const line = [new Date().toISOString().slice(11, 19), ...a.map((x) => (typeof x === "string" ? x : JSON.stringify(x)))].join(" ");
  console.log(line);
  if (process.env.LOG_FILE) fs.appendFile(process.env.LOG_FILE, line + "\n").catch(() => {});
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- 카페24 Front API (1초에 1번 정도만 허용 → 천천히) ---------- */
let lastCall = 0, calls = 0;
async function api(path) {
  for (let t = 0; t < 8; t++) {
    const wait = lastCall + 1050 - Date.now();
    if (wait > 0) await sleep(wait);
    lastCall = Date.now(); calls++;
    const r = await fetch(API + path, { headers: { "X-Cafe24-Client-Id": CID, "Content-Type": "application/json", ...UA } });
    if (r.status === 429) { await sleep(2500); continue; }
    if (!r.ok) { const b = await r.text(); throw new Error(`API ${r.status} ${path} ${b.slice(0, 200)}`); }
    return r.json();
  }
  throw new Error("API 429 계속 " + path);
}

/* ---------- 쇼핑몰 자료 파일 vtf_data.html (필터가 지금 쓰는 것과 같은 것) ---------- */
const num = (s) => { s = String(s || "").replace(/[^\d]/g, ""); return s ? +s : 0; };
const ENT = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&#039;": "'", "&nbsp;": " " };
const dec = (s) => String(s || "").replace(/<[^>]*>/g, "").replace(/&(?:amp|lt|gt|quot|#0?39|nbsp);/g, (m) => ENT[m] || m).replace(/&#(\d+);/g, (_, c) => String.fromCharCode(+c));
const attr = (tag, n) => { const m = tag.match(new RegExp("\\s" + n + '="([^"]*)"')); return m ? dec(m[1]) : ""; };
function parsePage(html) {
  const t = html.match(/id="vtfTotal"[^>]*>([^<]*)</);
  const total = t ? num(t[1]) : 0;
  const s = html.indexOf('id="vtfData"');
  if (s < 0) return { total, items: [] };
  const body = html.slice(s, html.indexOf("</ul>", s));
  const items = [];
  for (const chunk of body.split("<li ").slice(1)) {
    const tag = " " + chunk.slice(0, chunk.indexOf(">"));
    const n = attr(tag, "data-n"); if (!n) continue;
    const it = { n: +n, i: attr(tag, "data-i"), b: attr(tag, "data-b").trim(), p: num(attr(tag, "data-p")), s: 0, m: "", x: 0 };
    const nm = chunk.match(/<b[^>]*>([\s\S]*?)<\/b>/); it.t = dec(nm ? nm[1] : "").replace(/\s+/g, " ").trim();
    chunk.replace(/<i[^>]*>([\s\S]*?)<\/i>/g, (_, x) => {
      const tx = dec(x).replace(/\s+/g, " ").trim(), k = tx.split("=")[0], v = tx.slice(k.length + 1);
      if (/할인판매가/.test(k)) it.s = num(v); else if (/판매가/.test(k) && !it.p) it.p = num(v); else if (/실측/.test(k)) it.m = v.trim();
    });
    const so = chunk.match(/<s>([\s\S]*?)<\/s>/); if (so && so[1].trim()) it.x = 1;
    items.push(it);
  }
  return { total, items };
}
async function page(cate, p) {
  for (let t = 0; t < 4; t++) {
    try { const r = await fetch(`${SITE}${SKIN}/product/vtf_data.html?cate_no=${cate}&page=${p}`, { headers: UA }); if (r.ok) return parsePage(await r.text()); } catch (e) {}
    await sleep(1500 * (t + 1));
  }
  return { total: 0, items: [] };
}
async function crawlTop(cate) {
  const first = await page(cate, 1);
  const last = Math.max(1, Math.ceil(first.total / 200));
  const pages = [first.items];
  let next = 2;
  async function worker() { while (next <= last) { const p = next++; pages[p - 1] = (await page(cate, p)).items; } }
  await Promise.all(Array.from({ length: 6 }, worker));
  return pages.flat();
}

/* ---------- 실행 ---------- */
const t0 = Date.now();
const master = new Map(); // 상품번호 → 상품
const order = {};         // 분류 → 상품번호 순서
for (const c of TOPS) {
  const list = await crawlTop(c);
  order[c] = list.map((it) => it.n);
  for (const it of list) if (!master.has(it.n)) master.set(it.n, it);
  log("자료파일", c, list.length, "누적", master.size);
}

// 분류 목록
const cats = [];
for (let off = 0; ; off += 100) { const j = await api(`/categories?limit=100&offset=${off}`); cats.push(...j.categories); if (j.categories.length < 100) break; }
const kids = {}; for (const c of cats) (kids[c.parent_category_no] = kids[c.parent_category_no] || []).push(c.category_no);
log("분류", cats.length);

// 소분류(자식이 없는 분류)마다 소속 상품
const member = {};
const leaves = cats.filter((c) => !kids[c.category_no] && !TOPS.includes(String(c.category_no)));
for (const c of leaves) {
  const ids = [];
  for (let off = 0; off < 8000; off += 100) {
    const j = await api(`/categories/${c.category_no}/products?display_group=1&limit=100&offset=${off}`);
    for (const p of j.products) { ids.push(p.product_no); const m = master.get(p.product_no); if (m && !m.s && p.discount_price) m.s = Math.round(+p.discount_price); }
    if (j.products.length < 100) break;
  }
  if (ids.length) member[c.category_no] = ids;
}
log("소분류 소속 읽음", Object.keys(member).length, "API", calls);
// 위 분류 = 자기 자신 + 아래 분류 합 (순서: 대분류 목록 순서 → 그 외)
const rank = new Map(); { let r = 0; for (const c of TOPS) for (const n of order[c] || []) if (!rank.has(n)) rank.set(n, r++); }
function collect(no) {
  no = String(no);
  if (order[no]) return order[no];
  const set = new Set(member[+no] || []);
  for (const k of kids[+no] || []) for (const n of collect(k)) set.add(n);
  return [...set].sort((a, b) => (rank.get(a) ?? 1e9) - (rank.get(b) ?? 1e9));
}

// 검색어 태그 (상품 목록, 공개 상품만)
const tags = new Map();
for (let since = 0; ; ) {
  const j = await api(`/products?limit=100&since_product_no=${since}&display=T&selling=T&fields=product_no,product_tag,sold_out`);
  if (!j.products.length) break;
  for (const p of j.products) { if (p.product_tag && p.product_tag.length) tags.set(p.product_no, p.product_tag.join(",")); const m = master.get(p.product_no); if (m && p.sold_out === "T") m.x = 1; }
  since = j.products[j.products.length - 1].product_no;
  if (j.products.length < 100) break;
}
log("태그", tags.size, "API", calls);

// 파일 쓰기: [번호, 이름, 브랜드, 판매가, 할인가, 품절, 사진파일, 실측, 태그]
const IMG = "/web/product/medium/";
const row = (n) => { const m = master.get(n); if (!m) return null; const img = m.i.includes(IMG) ? m.i.slice(m.i.indexOf(IMG) + IMG.length) : m.i; return [n, m.t, m.b, m.p, m.s || 0, m.x ? 1 : 0, img, m.m, tags.get(n) || ""]; };
await fs.mkdir(`${OUT}/c`, { recursive: true });
const stamp = new Date().toISOString();
let files = 0, bytes = 0;
const all = new Set([...cats.map((c) => String(c.category_no)), ...TOPS]);
for (const no of all) {
  const ids = collect(no);
  const items = ids.map(row).filter(Boolean);
  if (!items.length) continue;
  const body = JSON.stringify({ v: 1, t: stamp, c: +no, total: items.length, img: SITE + IMG, items });
  await fs.writeFile(`${OUT}/c/${no}.json`, body); files++; bytes += body.length;
}
await fs.writeFile(`${OUT}/status.json`, JSON.stringify({ t: stamp, products: master.size, tags: tags.size, files, mb: +(bytes / 1048576).toFixed(1), api_calls: calls, seconds: Math.round((Date.now() - t0) / 1000) }));
await fs.writeFile(`${OUT}/index.html`, `<!doctype html><meta charset=utf-8><title>빈티지톡 상품필터</title><p>빈티지톡 상품필터 자료 (${stamp}) — <a href="status.json">status.json</a></p>`);
await fs.writeFile(`${OUT}/callback.html`, `<!doctype html><meta charset=utf-8><title>빈티지톡 상품필터</title><p>앱 설치가 끝났습니다. 이 창을 닫으셔도 됩니다.</p>`);
await fs.writeFile(`${OUT}/.nojekyll`, "");
log("끝", { products: master.size, files, MB: (bytes / 1048576).toFixed(1), api: calls, sec: Math.round((Date.now() - t0) / 1000) });
