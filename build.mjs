// 빈티지톡 상품필터 — 분류별 상품 목록 파일 만들기 (GitHub Actions, 15분마다)
// 빠른 실행(보통): 쇼핑몰 자료 파일(vtf_data.html)로 대분류 상품 전체(이름·브랜드·가격·할인가·실측·품절·사진)를 새로 읽고,
//   새로 올라온 상품만 카페24 앱(Front API)으로 소분류·태그를 물어봄 → 2~3분
// 전체 실행(하루 1번 또는 처음): 소분류마다 자료 파일을 읽어 소속을 다시 만들고(2~3분), 카페24 앱으로 태그 전체를 다시 받음(약 10분)
// 이전 결과(state.json)는 GitHub Pages에 같이 올려 두고 다음 실행이 받아 씀.
// 비밀값 없음: 앱 번호(Client ID)만 씀. 앱 권한 = 상품·상품분류 읽기.
import fs from "node:fs/promises";

const MALL = "oldmarket";
const CID = process.env.CAFE24_CLIENT_ID || "Jx8qsVH5ChOjryWdkLC64A";
const API = `https://${MALL}.cafe24api.com/api/v2`;
const SITE = `https://${MALL}.cafe24.com`;
const SKIN = process.env.VTF_SKIN ?? "/skin-skin69"; // vtf_data.html 이 있는 디자인 (대표에 넣으면 "")
const OUT = process.env.OUT_DIR || "out";
const PAGES = process.env.PAGES_URL || "https://coolky86-bit.github.io/vtfilter";
const TOPS = (process.env.VTF_TOPS || "2459,2460,1835,2422,2421,2140,2175,2141,2134").split(",");
const FULL_EVERY_H = 24, NEW_LIMIT = 150; // 새 상품은 한 번에 150개까지만 물어봄(약 2.5분), 나머지는 다음 실행
const UA = { "user-agent": "vtfilter-index/2.0 (+https://github.com/coolky86-bit/vtfilter)" };
const log = (...a) => {
  const line = [new Date().toISOString().slice(11, 19), ...a.map((x) => (typeof x === "string" ? x : JSON.stringify(x)))].join(" ");
  console.log(line);
  if (process.env.LOG_FILE) fs.appendFile(process.env.LOG_FILE, line + "\n").catch(() => {});
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- 카페24 Front API (1초에 1번 정도만 허용) ---------- */
let lastCall = 0, calls = 0;
async function api(path) {
  for (let t = 0; t < 10; t++) {
    const wait = lastCall + 1050 - Date.now();
    if (wait > 0) await sleep(wait);
    lastCall = Date.now(); calls++;
    let r;
    try { r = await fetch(API + path, { headers: { "X-Cafe24-Client-Id": CID, "Content-Type": "application/json", ...UA } }); } catch (e) { await sleep(3000); continue; }
    if (r.status === 429 || r.status >= 500) { await sleep(2500); continue; }
    if (r.status === 404) return null;
    if (!r.ok) { const b = await r.text(); throw new Error(`API ${r.status} ${path} ${b.slice(0, 200)}`); }
    return r.json();
  }
  throw new Error("API 계속 실패 " + path);
}

/* ---------- 쇼핑몰 자료 파일 vtf_data.html ---------- */
const num = (s) => { s = String(s || "").replace(/[^\d]/g, ""); return s ? +s : 0; };
const ENT = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&#039;": "'", "&nbsp;": " " };
const dec = (s) => String(s || "").replace(/<[^>]*>/g, "").replace(/&(?:amp|lt|gt|quot|#0?39|nbsp);/g, (m) => ENT[m] || m).replace(/&#(\d+);/g, (_, c) => String.fromCharCode(+c));
const attr = (tag, n) => { const m = tag.match(new RegExp("\\s" + n + '="([^"]*)"')); return m ? dec(m[1]) : ""; };
function parsePage(html) {
  const t = html.match(/id="vtfTotal"[^>]*>([^<]*)</);
  const total = t ? num(t[1]) : -1;
  const s = html.indexOf('id="vtfData"');
  if (s < 0) return { total, items: [], ok: false };
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
  return { total, items, ok: true };
}
async function page(cate, p) {
  for (let t = 0; t < 5; t++) {
    try { const r = await fetch(`${SITE}${SKIN}/product/vtf_data.html?cate_no=${cate}&page=${p}`, { headers: UA }); if (r.ok) { const x = parsePage(await r.text()); if (x.ok) return x; } } catch (e) {}
    await sleep(1500 * (t + 1));
  }
  throw new Error(`자료 파일을 못 읽음 cate=${cate} page=${p}`); // 반만 읽은 목록을 올리지 않도록 멈춤
}
async function crawlTop(cate) {
  const first = await page(cate, 1);
  const last = Math.max(1, Math.ceil(first.total / 200));
  const pages = [first.items];
  let next = 2;
  async function worker() { while (next <= last) { const p = next++; pages[p - 1] = (await page(cate, p)).items; } }
  await Promise.all(Array.from({ length: 8 }, worker));
  return pages.flat();
}

/* ---------- 실행 ---------- */
const t0 = Date.now();
let prev = null;
try { const r = await fetch(`${PAGES}/state.json?t=${Date.now()}`, { headers: UA }); if (r.ok) prev = await r.json(); } catch (e) {}
const full = !prev || !prev.v2 || process.env.FULL === "1" || Date.now() - Date.parse(prev.t_full || 0) > FULL_EVERY_H * 3600e3;
log(full ? "전체 실행" : "빠른 실행", prev ? "이전 " + prev.t : "이전 없음");

const master = new Map();
const order = {};
for (const c of TOPS) {
  const list = await crawlTop(c);
  order[c] = list.map((it) => it.n);
  for (const it of list) if (!master.has(it.n)) master.set(it.n, it);
  log("자료파일", c, list.length, "누적", master.size);
}
if (master.size < 1000) throw new Error("상품이 너무 적음(" + master.size + ") — 쇼핑몰 응답 이상, 올리지 않음");

let cats, member = {}, tags = {}, tFull;
if (full) {
  cats = [];
  for (let off = 0; ; off += 100) { const j = await api(`/categories?limit=100&offset=${off}`); cats.push(...j.categories.map((c) => ({ category_no: c.category_no, parent_category_no: c.parent_category_no }))); if (j.categories.length < 100) break; }
  const hasKid = new Set(cats.map((c) => c.parent_category_no));
  // 소분류 소속은 카페24 앱(1초에 1번, 30분 넘게 걸림) 대신 쇼핑몰 자료 파일로 분류마다 읽음 → 2~3분
  const leaves = cats.filter((c) => !hasKid.has(c.category_no) && !TOPS.includes(String(c.category_no)));
  let li = 0, failed = 0;
  async function leafWorker() {
    while (li < leaves.length) {
      const c = leaves[li++];
      try {
        const list = await crawlTop(c.category_no);
        if (list.length) { member[c.category_no] = list.map((it) => it.n); for (const it of list) if (!master.has(it.n)) master.set(it.n, it); }
      } catch (e) { failed++; log("소분류 못 읽음", c.category_no); }
    }
  }
  await Promise.all(Array.from({ length: 2 }, leafWorker));
  log("소분류 소속", Object.keys(member).length, "못 읽음", failed);
  if (prev && prev.tags) tags = prev.tags; // 태그는 아래에서 이어 받기 (한 번에 다 받으면 너무 오래 걸림)
  tFull = new Date().toISOString();
} else {
  cats = prev.cats; member = prev.member; tags = prev.tags; tFull = prev.t_full;
  // 새로 올라온 상품만 소분류·태그 물어보기
  const known = new Set(prev.known || []);
  const fresh = [...master.keys()].filter((n) => !known.has(n)).slice(0, NEW_LIMIT);
  const leafSet = new Set(Object.keys(member).map(Number));
  for (const n of fresh) {
    const j = await api(`/products/${n}?fields=product_no,category,product_tag`);
    const p = j && j.product; if (!p) continue;
    if (p.product_tag && p.product_tag.length) tags[n] = p.product_tag.join(",");
    for (const c of p.category || []) { const k = c.category_no; if (!member[k]) member[k] = []; if (!member[k].includes(n)) member[k].unshift(n); leafSet.add(k); }
  }
  log("새 상품", fresh.length, "API", calls);
}

// 태그 이어 받기: 실행마다 정해진 시간만(전체 8분·빠른 3분) 받고, 어디까지 받았는지(tag_since) 저장해 다음 실행이 이어 받음
let tagSince = prev && prev.tag_since ? prev.tag_since : 0, tagPass = prev && prev.tag_pass ? prev.tag_pass : null;
{
  const until = Date.now() + (full ? 8 : 3) * 60e3;
  let got = 0;
  while (Date.now() < until) {
    const j = await api(`/products?limit=100&since_product_no=${tagSince}&display=T&selling=T&fields=product_no,product_tag`);
    if (!j || !j.products.length) { tagSince = 0; tagPass = new Date().toISOString(); break; }
    for (const p of j.products) { got++; if (p.product_tag && p.product_tag.length) tags[p.product_no] = p.product_tag.join(","); }
    tagSince = j.products[j.products.length - 1].product_no;
    if (j.products.length < 100) { tagSince = 0; tagPass = new Date().toISOString(); break; }
  }
  log("태그 받음", got, "다음 시작", tagSince, "API", calls);
}

// 위 분류 = 자기 자신 + 아래 분류 합. 순서 = 대분류 자료 파일 순서(신상품 순)
const kids = {}; for (const c of cats) (kids[c.parent_category_no] = kids[c.parent_category_no] || []).push(c.category_no);
const rank = new Map(); { let r = 0; for (const c of TOPS) for (const n of order[c] || []) if (!rank.has(n)) rank.set(n, r++); }
function collect(no, depth = 0) {
  no = String(no);
  if (order[no]) return order[no];
  if (depth > 8) return [];
  // 소분류(아래 분류 없음) = 그 분류 자료 파일 순서 그대로(쇼핑몰 목록과 같은 순서)
  if (!(kids[+no] || []).length) return (member[no] || []).filter((n) => master.has(n));
  // 중간 분류 = 아래 분류를 합쳐 최신 상품 먼저(상품 번호 큰 순)
  const set = new Set(member[no] || []);
  for (const k of kids[+no] || []) for (const n of collect(k, depth + 1)) set.add(n);
  return [...set].filter((n) => master.has(n)).sort((a, b) => b - a);
}

// 파일: [번호, 이름, 브랜드, 판매가, 할인가, 품절, 사진파일, 실측, 태그]
const IMG = "/web/product/medium/";
const row = (n) => { const m = master.get(n); if (!m) return null; const img = m.i.includes(IMG) ? m.i.slice(m.i.indexOf(IMG) + IMG.length) : m.i; return [n, m.t, m.b, m.p, m.s || 0, m.x ? 1 : 0, img, m.m, tags[n] || ""]; };
await fs.mkdir(`${OUT}/c`, { recursive: true });
const stamp = new Date().toISOString();
let files = 0, bytes = 0;
for (const no of new Set([...cats.map((c) => String(c.category_no)), ...TOPS])) {
  const items = collect(no).map(row).filter(Boolean);
  if (!items.length) continue;
  const body = JSON.stringify({ v: 1, t: stamp, c: +no, total: items.length, img: SITE + IMG, items });
  await fs.writeFile(`${OUT}/c/${no}.json`, body); files++; bytes += body.length;
}
// 다음 실행이 쓸 상태 (안 쓰는 상품 태그는 정리)
const live = new Set(master.keys());
for (const k of Object.keys(tags)) if (!live.has(+k)) delete tags[k];
await fs.writeFile(`${OUT}/state.json`, JSON.stringify({ v2: 1, t: stamp, t_full: tFull, tag_since: tagSince, tag_pass: tagPass, cats, member, tags, known: [...live] }));
const status = { t: stamp, mode: full ? "전체" : "빠른", t_full: tFull, tag_since: tagSince, tag_pass: tagPass, products: master.size, tags: Object.keys(tags).length, files, mb: +(bytes / 1048576).toFixed(1), api_calls: calls, seconds: Math.round((Date.now() - t0) / 1000) };
await fs.writeFile(`${OUT}/status.json`, JSON.stringify(status));
await fs.writeFile(`${OUT}/index.html`, `<!doctype html><meta charset=utf-8><title>빈티지톡 상품필터</title><p>빈티지톡 상품필터 자료 (${stamp}, ${status.mode} 실행) — <a href="status.json">status.json</a></p>`);
await fs.writeFile(`${OUT}/callback.html`, `<!doctype html><meta charset=utf-8><title>빈티지톡 상품필터</title><p>앱 설치가 끝났습니다. 이 창을 닫으셔도 됩니다.</p>`);
await fs.writeFile(`${OUT}/.nojekyll`, "");
if (process.env.GITHUB_OUTPUT) await fs.appendFile(process.env.GITHUB_OUTPUT, `full=${full ? 1 : 0}\n`);
log("끝", status);
