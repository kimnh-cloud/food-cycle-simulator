// ===== 몬테카를로: 생산량·비규격률 불확실성 하에서 피드백 효과 =====
// 불확실성 파라미터는 Stage 1 회귀(montecarlo.py)에서 추정한 값
//  σ: 회귀 잔차 표준오차(자유도 보정), p_w: 관측 연도 중 이상기상 비율, βw: 이상기상 회귀계수
const MC_PARAM = {
  "쌀":     { sigma: 157.8, p_w: 0.30, beta_w: -134.8 },
  "양파":   { sigma: 205.9, p_w: 0.17, beta_w: -100.9 },
  "가을배추": { sigma: 36.4,  p_w: 0.33, beta_w: -107.0 },
  "사과":   { sigma: 58.7,  p_w: 0.29, beta_w: -75.5 },
};
const MC_RUNS = 1000, MC_CHUNK = 20, MC_ALPHA = 0.5, MC_ACQ = 0.10;

// 재현 가능한 난수 (mulberry32 + Box-Muller)
function rng(seed){ return function(){ seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
let R = rng(2026);
const normal = () => { let u = 0, v = 0; while (!u) u = R(); while (!v) v = R(); return Math.sqrt(-2*Math.log(u)) * Math.cos(2*Math.PI*v); };

const PRED = (() => { const b = stage1(0.15, 0.1, 2026); return Object.fromEntries(DATA.items.map(it => [it, b[it].pred])); })();
const RICE_DEMAND = (() => { const [d1, d2] = DATA.riceDemand; return d2[1] + (d2[1]-d1[1])/(d2[0]-d1[0]) * (2026 - d2[0]); })();
const N_MC = targets({ demand: 0 }), NTOT = N_MC.reduce((a,v)=>a+v,0);
const BASE_DRI = baselineScore();

function oneRun(){
  // 보고서와 동일한 1,000회 입력을 순서대로 재생 (montecarlo.py, seed 2026)
  const d = MC_DRAWS[runs.length];
  const prod = { "쌀": d[0], "양파": d[1], "가을배추": d[2], "사과": d[3] }, ns = d[4];
  const pools = {};
  DATA.items.forEach(it => { const kt = it === "쌀" ? Math.max(prod[it] - RICE_DEMAND, 0) : prod[it] * ns; pools[it] = kt * MC_ACQ * 1000; });
  const out = { pools };
  for (const [tag, a] of [["c1", 0], ["fb", MC_ALPHA]]) {
    const L = DATA.items.map(it => N_MC.map(n => a * pools[it] * n / NTOT));
    const S2 = cycStage2(pools, N_MC, L), S3 = cycStage3(S2.alloc, N_MC);
    out[tag] = { dri: S3.reduce((s, r, k) => s + r.score * N_MC[k] / NTOT, 0), saving: (1 - S2.cost / S2.naive) * 100,
                 hubCabbage: S2.alloc[2][0] };
  }
  out.gain = out.fb.dri - out.c1.dri;
  return out;
}

// ---------- UI ----------
const $ = s => document.querySelector(s);
const fmt = v => Math.round(v).toLocaleString("ko-KR");
const ITEM_COLOR = { "쌀":"var(--s4)", "양파":"var(--s2)", "가을배추":"var(--s3)", "사과":"var(--s8)" };
let runs = [], timer = null;

$("#inpBody").innerHTML = DATA.items.map(it => { const p = MC_PARAM[it];
  return `<tr><td>${it}</td><td>${p.sigma} kt</td><td>${Math.round(p.p_w*100)}%</td><td>${p.beta_w} kt</td></tr>`; }).join("");

const median = a => { const s = [...a].sort((x,y)=>x-y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m-1]+s[m])/2; };
const pct = (a, q) => { const s = [...a].sort((x,y)=>x-y); return s[Math.min(s.length-1, Math.max(0, Math.round(q*(s.length-1))))]; };

function hist(series, colors, lo, hi, step, refLine, refLab){
  const W = 620, H = 260, nb = Math.round((hi-lo)/step);
  const counts = series.map(s => { const c = new Array(nb).fill(0); s.forEach(v => { const b = Math.floor((v-lo)/step); if (b >= 0 && b < nb) c[b]++; }); return c; });
  const mx = Math.max(10, ...counts.flat());
  const sx = v => 40 + (v-lo)/(hi-lo)*(W-60), sy = c => H-28 - c/mx*(H-50), bw = (W-60)/nb;
  let g = "";
  for (let t = 0; t <= 4; t++) { const c = Math.round(mx*t/4); g += `<line x1="36" x2="${W-14}" y1="${sy(c)}" y2="${sy(c)}" stroke="var(--grid)"/><text x="32" y="${sy(c)+4}" text-anchor="end" font-size="10" fill="var(--ink-muted)">${c}</text>`; }
  counts.forEach((c, k) => c.forEach((n, b) => { if (!n) return;
    g += `<rect x="${sx(lo+b*step)+1}" y="${sy(n)}" width="${bw-2}" height="${H-28-sy(n)}" rx="2" fill="${colors[k]}" opacity=".85" data-tip="${(lo+b*step).toFixed(0)}~${(lo+(b+1)*step).toFixed(0)}: ${n}회"/>`; }));
  if (refLine != null) g += `<line x1="${sx(refLine)}" x2="${sx(refLine)}" y1="18" y2="${H-28}" stroke="var(--ink-muted)" stroke-dasharray="4 4"/><text x="${sx(refLine)+5}" y="28" font-size="10.5" fill="var(--ink-2)">${refLab}</text>`;
  for (let v = lo; v <= hi; v += (hi-lo) > 30 ? 10 : 5) g += `<text x="${sx(v)}" y="${H-10}" text-anchor="middle" font-size="10.5" fill="var(--ink-muted)">${v}</text>`;
  g += `<line x1="36" x2="${W-14}" y1="${H-28}" y2="${H-28}" stroke="var(--axis)"/>`;
  return `<svg viewBox="0 0 ${W} ${H}">${g}</svg>`;
}

function render(){
  const n = runs.length;
  $("#badge").innerHTML = `<b>${n.toLocaleString()}</b> / 1,000회${n === MC_RUNS ? " · <span style='color:var(--good);font-weight:700'>완료</span>" : ""}`;
  $("#h1").innerHTML = hist([runs.map(r=>r.c1.dri), runs.map(r=>r.fb.dri)], ["var(--s1)","var(--s3)"], 25, 75, 1, BASE_DRI, `현행 ${BASE_DRI.toFixed(1)}%`);
  $("#h2").innerHTML = hist([runs.map(r=>r.gain)], ["var(--s3)"], 0, 25, 1, 0, "");
  if (!n) { ["t1","t2","t3","t4"].forEach(id => $("#"+id).textContent = "–"); ["t1d","t2d","t4d"].forEach(id => $("#"+id).textContent = ""); $("#cur").innerHTML = ""; bindTips(); return; }
  const g = runs.map(r=>r.gain);
  $("#t1").textContent = (runs.filter(r=>r.gain>0).length/n*100).toFixed(1) + "%";
  $("#t1d").textContent = `최소 +${Math.min(...g).toFixed(1)}%p`;
  $("#t2").textContent = "+" + median(g).toFixed(1) + "%p";
  $("#t2d").textContent = `95% 구간 +${pct(g,.025).toFixed(1)} ~ +${pct(g,.975).toFixed(1)}%p`;
  $("#t3").textContent = (runs.filter(r=>r.c1.hubCabbage<1).length/n*100).toFixed(1) + "%";
  $("#t4").textContent = (runs.filter(r=>r.fb.saving>0).length/n*100).toFixed(1) + "%";
  $("#t4d").textContent = `절감률 중앙값 ${median(runs.map(r=>r.fb.saving)).toFixed(1)}%`;
  // 이번 회차 확보 물량
  const last = runs[n-1].pools, W = 620, H = 150, mx = 50000;
  let s = "";
  DATA.items.forEach((it, i) => { const y = 8 + i*34, w = Math.min(last[it]/mx, 1) * (W-170);
    s += `<text x="0" y="${y+16}" font-size="12" fill="var(--ink-2)">${it}</text><rect x="70" y="${y+3}" width="${Math.max(w,1)}" height="18" rx="4" fill="${ITEM_COLOR[it]}"/>
          <text x="${76+w}" y="${y+16}" font-size="11.5" font-weight="600" fill="var(--ink-1)">${fmt(last[it])}</text>`; });
  $("#cur").innerHTML = `<svg viewBox="0 0 ${W} ${H}">${s}</svg>`;
  bindTips();
}
function bindTips(){ const tip = $("#tip"); document.querySelectorAll("[data-tip]").forEach(el => {
  el.onmousemove = e => { tip.textContent = el.dataset.tip; tip.style.left = Math.min(e.clientX+12, innerWidth-250)+"px"; tip.style.top = (e.clientY+14)+"px"; tip.style.opacity = 1; };
  el.onmouseleave = () => tip.style.opacity = 0; }); }

function stop(){ if (timer) { clearTimeout(timer); timer = null; } $("#bRun").textContent = runs.length >= MC_RUNS ? "✓ 완료" : "▶ 1,000회 실행"; $("#bRun").disabled = runs.length >= MC_RUNS; }
function tick(){
  for (let k = 0; k < MC_CHUNK && runs.length < MC_RUNS; k++) runs.push(oneRun());
  render();
  if (runs.length < MC_RUNS) timer = setTimeout(tick, 0); else stop();
}
$("#bRun").onclick = () => { if (timer) { stop(); return; } $("#bRun").textContent = "⏸ 멈춤"; tick(); };
$("#bReset").onclick = () => { stop(); runs = []; R = rng(2026); $("#bRun").disabled = false; $("#bRun").textContent = "▶ 1,000회 실행"; render(); };
render();
// URL로 바로 실행: mc.html?run=1000
{ const q = +(new URLSearchParams(location.search).get("run") || 0);
  if (q) { while (runs.length < Math.min(q, MC_RUNS)) runs.push(oneRun()); render(); stop(); } }
