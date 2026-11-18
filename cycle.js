// ===== 확장 프로토타입: 시나리오 충격 + 권역별 다회 피드백 사이클 =====
// compute.js(DATA, simplexMin, ols2, stage1One 등) 위에서 동작
const FARM_FOOD = { "쌀": "백미", "양파": "양파", "가을배추": "가을배추", "사과": "사과" };
const PROCESSED = ["라면", "참치통조림", "즉석죽", "초코과자"];
const BASE_TARGET = 149835;           // 기본 시나리오 타겟 인원 (48,200t ÷ 881g×365)
const FB_STEP = 0.25;                 // 피드백 1회당 하한 상향폭 (비례 지분 대비)
const GAP_LINE = 90;                  // 충족률 90% 미만을 공백으로 판정
const MAX_CYCLES = 10;
const CONV_GAIN = 0.5;               // 사이클당 개선 < 0.5%p 이면 수렴으로 판정

const SCENARIOS = {
  base:    { name: "기본 (2026 평년)",       desc: "공표 통계 기반 기본값",
             ns: 15, aq: 10, shock: { "쌀": 0, "양파": 0, "가을배추": 0, "사과": 0 }, demand: 0 },
  cabbage: { name: "가을배추 흉작",           desc: "배추 생산 −25% (이상기상)",
             ns: 15, aq: 10, shock: { "쌀": 0, "양파": 0, "가을배추": -25, "사과": 0 }, demand: 0 },
  onion:   { name: "양파 대풍",               desc: "양파 생산 +20% → 잉여 급증",
             ns: 15, aq: 10, shock: { "쌀": 0, "양파": 20, "가을배추": 0, "사과": 0 }, demand: 0 },
  metro:   { name: "수도권 수요 급증",        desc: "수도권 지원 대상 +30%",
             ns: 15, aq: 10, shock: { "쌀": 0, "양파": 0, "가을배추": 0, "사과": 0 }, demand: 30 },
  combo:   { name: "복합 충격",               desc: "배추 −25% · 사과 −20% · 수도권 수요 +30%",
             ns: 15, aq: 10, shock: { "쌀": 0, "양파": 0, "가을배추": -25, "사과": -20 }, demand: 30 },
  scaleup: { name: "확보율 20% 확대",         desc: "세제혜택·aT 중개 강화로 확보율 2배",
             ns: 15, aq: 20, shock: { "쌀": 0, "양파": 0, "가을배추": 0, "사과": 0 }, demand: 0 },
};

// Stage 1: 회귀 예측 × 생산 충격
function cycStage1(p) {
  const base = stage1(p.ns / 100, p.aq / 100, 2026);
  const out = {};
  for (const it of DATA.items) {
    const r = base[it], pred = r.pred * (1 + p.shock[it] / 100);
    let surplus;
    if (it === "쌀") {
      const [d1, d2] = DATA.riceDemand, slope = (d2[1] - d1[1]) / (d2[0] - d1[0]);
      surplus = pred - (d2[1] + slope * (2026 - d2[0]));
    } else surplus = pred * p.ns / 100;
    out[it] = { pred, basePred: r.pred, pool: Math.max(surplus, 0) * p.aq / 100 * 1000 };
  }
  return out;
}

// 권역별 타겟 인원
function targets(p) {
  const tot = Object.values(DATA.zoneRecipients).reduce((a, v) => a + v, 0);
  return DATA.zones.map((z, k) => BASE_TARGET * DATA.zoneRecipients[z] / tot * (k === 0 ? 1 + p.demand / 100 : 1));
}

// Stage 2: 수송 LP + 셀별 하한 L (톤)
function cycStage2(pools, N, L) {
  const nI = 4, nZ = 5, supply = DATA.items.map(it => pools[it]);
  const total = supply.reduce((a, v) => a + v, 0), Ntot = N.reduce((a, v) => a + v, 0);
  const share = N.map(n => n / Ntot);
  const c = DATA.dist.flat().map(d => d + 1e-6 * d * d);
  const Aeq = [], beq = [], Aub = [], bub = [];
  for (let i = 0; i < nI; i++) { const r = new Array(20).fill(0); for (let z = 0; z < nZ; z++) r[i * nZ + z] = 1; Aeq.push(r); beq.push(supply[i]); }
  for (let z = 0; z < nZ; z++) { const r = new Array(20).fill(0); for (let i = 0; i < nI; i++) r[i * nZ + z] = 1; Aeq.push(r); beq.push(total * share[z]); }
  for (let i = 0; i < nI; i++) for (let z = 0; z < nZ; z++) if (L[i][z] > 0) {
    const r = new Array(20).fill(0); r[i * nZ + z] = -1; Aub.push(r); bub.push(-L[i][z]);
  }
  const res = simplexMin(c, Aub, bub, Aeq, beq, null);
  if (!res.ok) return null;
  const alloc = DATA.items.map((_, i) => DATA.zones.map((_, z) => Math.max(res.x[i * nZ + z], 0)));
  let cost = 0, naive = 0;
  for (let i = 0; i < nI; i++) for (let z = 0; z < nZ; z++) {
    cost += alloc[i][z] * DATA.dist[i][z]; naive += supply[i] * share[z] * DATA.dist[i][z];
  }
  return { alloc, cost, naive, share, supply, total };
}

// Stage 3: 권역별 · 1인 가용량을 섭취 상한으로 반영한 영양 LP
function cycStage3(alloc, N) {
  const CAP0 = Object.fromEntries(Object.keys(DATA.foods).map(f => [f, DATA.foods[f].cap]));
  const out = DATA.zones.map((z, k) => {
    const avail = {};
    DATA.items.forEach((it, i) => { avail[it] = alloc[i][k] * 1e6 / (N[k] * 365); });
    const foods = PROCESSED.slice();
    DATA.items.forEach(it => { if (avail[it] > 1) foods.push(FARM_FOOD[it]); });
    // 섭취 상한 = min(권장 1일 상한, 1인 가용량)
    DATA.items.forEach(it => { const f = FARM_FOOD[it]; DATA.foods[f].cap = Math.min(CAP0[f], avail[it]); });
    const zs = [], scores = [];
    for (const ben of DATA.beneficiaries) { const r = stage3One(ben, foods); zs.push(r.z); scores.push(r.score); }
    Object.keys(CAP0).forEach(f => DATA.foods[f].cap = CAP0[f]);
    const m = DATA.nutrients.map((_, n) => zs.reduce((a, v) => a + Math.max(v[n], 0), 0) / zs.length);
    return { zone: z, z: m, score: scores.reduce((a, v) => a + v, 0) / scores.length, avail };
  });
  return out;
}

// 현행(가공식품만) 기준선
function baselineScore() {
  return DATA.beneficiaries.reduce((a, b) => a + stage3One(b, PROCESSED).score, 0) / 3;
}

// 피드백: 권역별 최저 영양소 → 그 영양소가 풍부한 품목의 하한 상향
function feedback(S2, S3, L, signals) {
  const actions = [];
  const avgDri = DATA.nutrients.map((_, n) => DATA.beneficiaries.reduce((a, b) => a + b.dri[n], 0) / 3);
  S3.forEach((reg, k) => {
    const order = DATA.nutrients.map((_, n) => n).filter(n => reg.z[n] < GAP_LINE).sort((a, b) => reg.z[a] - reg.z[b]);
    for (const n of order) {
      // 이 영양소를 공급할 수 있는 품목 중, 더 받을 여지가 있는 것
      const cand = DATA.items.map((it, i) => {
        const f = DATA.foods[FARM_FOOD[it]];
        const potential = f.v[n] * f.cap / 100 / avgDri[n];      // 상한까지 먹으면 채우는 비율
        const room = reg.avail[it] < f.cap - 1 && L[i][k] < S2.supply[i] * S2.share[k] - 1;
        return { it, i, potential, room };
      }).filter(c => c.potential >= 0.10 && c.room).sort((a, b) => b.potential - a.potential);
      if (cand.length) {
        const c = cand[0], prop = S2.supply[c.i] * S2.share[k];
        const before = S2.alloc[c.i][k];
        L[c.i][k] = Math.min(prop, Math.max(L[c.i][k], before) + FB_STEP * prop);
        actions.push({ zone: reg.zone, nutrient: DATA.nutrientsKr[n], level: reg.z[n], item: c.it,
                       before, after: L[c.i][k], k, i: c.i });
        return;
      }
      // 어떤 품목으로도 채울 수 없는 영양소 → 신규 품목 신호
      const maxPot = Math.max(...DATA.items.map(it => { const f = DATA.foods[FARM_FOOD[it]]; return f.v[n] * f.cap / 100 / avgDri[n]; }));
      if (maxPot < 0.15 || DATA.items.every((it, i) => !(reg.avail[it] < DATA.foods[FARM_FOOD[it]].cap - 1 && L[i][k] < S2.supply[i] * S2.share[k] - 1) || DATA.foods[FARM_FOOD[it]].v[n] === 0))
        signals[DATA.nutrientsKr[n]] = (signals[DATA.nutrientsKr[n]] || new Set()).add(reg.zone);
    }
  });
  return actions;
}

// 다음 시즌 확보 우선순위 신호: Σ_n (영양 공백 × 품목의 영양 기여) — 잠재가격의 근사
function seasonSignal(S3, N) {
  const avgDri = DATA.nutrients.map((_, n) => DATA.beneficiaries.reduce((a, b) => a + b.dri[n], 0) / 3);
  const Ntot = N.reduce((a, v) => a + v, 0);
  const w = {};
  DATA.items.forEach(it => {
    const f = DATA.foods[FARM_FOOD[it]];
    w[it] = S3.reduce((acc, reg, k) => acc + N[k] / Ntot *
      DATA.nutrients.reduce((s, _, n) => s + Math.max(0, 100 - reg.z[n]) / 100 * f.v[n] / avgDri[n], 0), 0);
  });
  const mx = Math.max(...Object.values(w));
  Object.keys(w).forEach(k => w[k] = mx > 0 ? w[k] / mx : 0);
  return w;
}

// 시뮬레이션 상태 객체
function newSim(p) {
  const S1 = cycStage1(p), N = targets(p);
  const pools = Object.fromEntries(DATA.items.map(it => [it, S1[it].pool]));
  const L = DATA.items.map(() => DATA.zones.map(() => 0));
  return { p, S1, N, pools, L, cycles: [], signals: {}, done: false, base: baselineScore() };
}

function runCycle(sim) {
  if (sim.done) return null;
  const S2 = cycStage2(sim.pools, sim.N, sim.L);
  const S3 = cycStage3(S2.alloc, sim.N);
  const Ntot = sim.N.reduce((a, v) => a + v, 0);
  const dri = S3.reduce((a, r, k) => a + r.score * sim.N[k] / Ntot, 0);
  const zeros = S2.alloc.flat().filter(v => v < 1).length;
  const minReg = Math.min(...S3.map(r => r.score));
  const Lsnap = sim.L.map(r => r.slice());
  const actions = feedback(S2, S3, sim.L, sim.signals);
  const prev = sim.cycles[sim.cycles.length - 1];
  const cyc = { n: sim.cycles.length + 1, S2, S3, dri, zeros, minReg, L: Lsnap, actions,
                gain: prev ? dri - prev.dri : null, signal: seasonSignal(S3, sim.N) };
  sim.cycles.push(cyc);
  if (prev && dri - prev.dri < CONV_GAIN) { sim.done = true; cyc.reason = "수렴: 추가 재배분으로 얻는 개선이 0.5%p 미만"; }
  else if (!actions.length) { sim.done = true; cyc.reason = "수렴: 재배분으로 채울 수 있는 영양 공백 없음"; }
  else if (sim.cycles.length >= MAX_CYCLES) { sim.done = true; cyc.reason = "최대 사이클 도달"; }
  if (sim.done) { cyc.actions = []; sim.L = Lsnap; }
  return cyc;
}

if (typeof module !== "undefined") module.exports = { SCENARIOS, newSim, runCycle };
