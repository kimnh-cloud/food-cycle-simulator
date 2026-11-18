// ─────────────────────────────────────────────────────────────
// 잉여 농산물 순환 재배분 시뮬레이터 — 계산 엔진
// (node 테스트와 웹페이지가 동일 코드 사용)
// ─────────────────────────────────────────────────────────────

// ===== Big-M 단체법 (min c·x, Aub x<=bub, Aeq x=beq, 0<=x<=ub) =====
function simplexMin(c, Aub, bub, Aeq, beq, ub) {
  const n = c.length;
  const rows = [];
  // 상한 → 부등식 행
  if (ub) for (let j = 0; j < n; j++) {
    if (ub[j] != null && isFinite(ub[j])) {
      const r = new Array(n).fill(0); r[j] = 1;
      rows.push({ a: r, b: ub[j], type: "le" });
    }
  }
  (Aub || []).forEach((a, i) => rows.push({ a: a.slice(), b: bub[i], type: "le" }));
  (Aeq || []).forEach((a, i) => rows.push({ a: a.slice(), b: beq[i], type: "eq" }));
  // b >= 0 정규화
  rows.forEach(r => {
    if (r.b < 0) {
      r.a = r.a.map(v => -v); r.b = -r.b;
      r.type = r.type === "le" ? "ge" : r.type === "ge" ? "le" : "eq";
    }
  });
  const m = rows.length;
  let nSlack = 0, nArt = 0;
  rows.forEach(r => { if (r.type !== "eq") nSlack++; if (r.type !== "le") nArt++; });
  const N = n + nSlack + nArt;
  const T = rows.map(() => new Array(N + 1).fill(0));
  const basis = new Array(m).fill(-1);
  let si = n, ai = n + nSlack;
  const artCols = [];
  rows.forEach((r, i) => {
    for (let j = 0; j < n; j++) T[i][j] = r.a[j];
    T[i][N] = r.b;
    if (r.type === "le") { T[i][si] = 1; basis[i] = si; si++; }
    else if (r.type === "ge") { T[i][si] = -1; si++; T[i][ai] = 1; basis[i] = ai; artCols.push(ai); ai++; }
    else { T[i][ai] = 1; basis[i] = ai; artCols.push(ai); ai++; }
  });
  // 목적행 (Big-M)
  let maxAbs = 1;
  c.forEach(v => maxAbs = Math.max(maxAbs, Math.abs(v)));
  rows.forEach(r => { maxAbs = Math.max(maxAbs, Math.abs(r.b)); });
  const M = maxAbs * 1e5;
  const obj = new Array(N + 1).fill(0);
  for (let j = 0; j < n; j++) obj[j] = c[j];
  artCols.forEach(j => obj[j] = M);
  // 기저 인공변수 소거
  basis.forEach((bj, i) => {
    if (obj[bj] !== 0) {
      const f = obj[bj];
      for (let j = 0; j <= N; j++) obj[j] -= f * T[i][j];
    }
  });
  const EPS = 1e-9;
  for (let iter = 0; iter < 5000; iter++) {
    let piv = -1;                                   // Bland: 최소 인덱스
    for (let j = 0; j < N; j++) if (obj[j] < -EPS) { piv = j; break; }
    if (piv === -1) break;
    let pr = -1, best = Infinity;
    for (let i = 0; i < m; i++) {
      if (T[i][piv] > EPS) {
        const ratio = T[i][N] / T[i][piv];
        if (ratio < best - EPS || (Math.abs(ratio - best) < EPS && basis[i] < (pr >= 0 ? basis[pr] : Infinity))) {
          best = ratio; pr = i;
        }
      }
    }
    if (pr === -1) return { ok: false, reason: "unbounded" };
    const pv = T[pr][piv];
    for (let j = 0; j <= N; j++) T[pr][j] /= pv;
    for (let i = 0; i < m; i++) if (i !== pr && Math.abs(T[i][piv]) > EPS) {
      const f = T[i][piv];
      for (let j = 0; j <= N; j++) T[i][j] -= f * T[pr][j];
    }
    if (Math.abs(obj[piv]) > EPS) {
      const f = obj[piv];
      for (let j = 0; j <= N; j++) obj[j] -= f * T[pr][j];
    }
    basis[pr] = piv;
  }
  const x = new Array(n).fill(0);
  basis.forEach((bj, i) => { if (bj < n) x[bj] = T[i][N]; });
  // 인공변수 잔존 검사
  for (let i = 0; i < m; i++)
    if (artCols.includes(basis[i]) && T[i][N] > 1e-5) return { ok: false, reason: "infeasible" };
  let cost = 0;
  for (let j = 0; j < n; j++) cost += c[j] * x[j];
  return { ok: true, x, cost };
}

// ===== 실데이터 =====
const DATA = {
  items: ["쌀", "양파", "가을배추", "사과"],
  production: {   // [year, kt, weatherEvent]  통계청·농식품부 공표치
    "쌀": [[2015,4327,0],[2016,4197,0],[2017,3972,0],[2018,3868,0],[2019,3744,0],
           [2020,3507,1],[2021,3882,0],[2022,3764,1],[2023,3702,0],[2024,3585,1]],
    "양파": [[2019,1594,0],[2020,1168,0],[2021,1577,0],[2022,1196,1],[2023,1173,0],[2024,1175,0]],
    "가을배추": [[2020,1340,0],[2021,1147,1],[2022,1267,0],[2023,1242,0],[2024,1164,1],[2025,1201,0]],
    "사과": [[2019,422,0],[2020,422,1],[2021,516,0],[2022,566,0],[2023,394,1],[2024,460,0],[2025,448,0]],
  },
  riceDemand: [[2022,3609],[2024,3529]],       // 농식품부 공표 수요량(kt)
  zones: ["수도권","충청권","호남권","영남권","강원·제주"],
  zoneRecipients: {                             // KOSIS 2025 시도별 수급자 수 합산(명)
    "수도권":1212632, "충청권":288823, "호남권":362762, "영남권":839201, "강원·제주":133288 },
  origins: { "쌀":"김제", "양파":"무안", "가을배추":"해남", "사과":"안동" },
  dist: [[200,90,70,280,230],[330,220,60,320,360],[380,270,110,290,410],[230,160,290,150,130]],
  nutrients: ["energy","protein","fiber","vitc","calcium","potassium"],
  nutrientsKr: ["에너지","단백질","식이섬유","비타민C","칼슘","칼륨"],
  foods: {        // 100g당, 국가표준식품성분DB 기반
    "라면":       {cat:"가공", v:[450,9.0,2.0,0,20,120],   cap:120},
    "참치통조림": {cat:"가공", v:[150,20.0,0,0,10,230],    cap:100},
    "즉석죽":     {cat:"가공", v:[60,1.5,0.3,0,5,30],      cap:300},
    "초코과자":   {cat:"가공", v:[500,5.0,1.5,0,40,150],   cap:60},
    "백미":       {cat:"농산물", v:[357,6.4,0.8,0,7,84],   cap:250, item:"쌀"},
    "양파":       {cat:"농산물", v:[27,1.0,1.5,5.9,15,145],cap:150, item:"양파"},
    "가을배추":   {cat:"농산물", v:[13,1.3,1.1,24.8,29,240],cap:300, item:"가을배추"},
    "사과":       {cat:"농산물", v:[53,0.2,2.0,1.4,3,107], cap:300, item:"사과"},
  },
  beneficiaries: [
    {id:"A", profile:"70대 여성 독거노인", dri:[1600,50,20,100,800,3500]},
    {id:"B", profile:"60대 남성 당뇨",     dri:[1900,60,25,100,750,3500]},
    {id:"C", profile:"10세 아동 한부모가정", dri:[1700,40,20,70,800,2900]},
  ],
};

// ===== Stage 1: OLS 회귀 (생산량 ~ 추세 + 이상기상) =====
function ols2(X, y) {            // X: [[x1,x2],...] → [b0,b1,b2]
  const n = X.length;
  const A = [[n,0,0],[0,0,0],[0,0,0]], b = [0,0,0];
  for (let i = 0; i < n; i++) {
    const [t, w] = X[i];
    A[0][1]+=t; A[0][2]+=w; A[1][1]+=t*t; A[1][2]+=t*w; A[2][2]+=w*w;
    b[0]+=y[i]; b[1]+=t*y[i]; b[2]+=w*y[i];
  }
  A[1][0]=A[0][1]; A[2][0]=A[0][2]; A[2][1]=A[1][2];
  // 3x3 가우스 소거
  const Ab = A.map((r,i)=>[...r,b[i]]);
  for (let c0=0;c0<3;c0++){
    let p=c0; for(let r=c0+1;r<3;r++) if(Math.abs(Ab[r][c0])>Math.abs(Ab[p][c0])) p=r;
    [Ab[c0],Ab[p]]=[Ab[p],Ab[c0]];
    for(let r=0;r<3;r++) if(r!==c0 && Math.abs(Ab[c0][c0])>1e-12){
      const f=Ab[r][c0]/Ab[c0][c0];
      for(let k=c0;k<4;k++) Ab[r][k]-=f*Ab[c0][k];
    }
  }
  return [Ab[0][3]/Ab[0][0], Ab[1][3]/Ab[1][1], Ab[2][3]/Ab[2][2]];
}

function stage1(nonstdRate, acqRate, targetYear) {
  nonstdRate = nonstdRate ?? 0.15; acqRate = acqRate ?? 0.10; targetYear = targetYear ?? 2026;
  const out = {};
  for (const item of DATA.items) {
    const rows = DATA.production[item];
    const X = rows.map(r => [r[0]-2015, r[2]]), y = rows.map(r => r[1]);
    const [b0,b1,b2] = ols2(X, y);
    const yhat = X.map(x => b0 + b1*x[0] + b2*x[1]);
    const ymean = y.reduce((a,v)=>a+v,0)/y.length;
    const ssRes = y.reduce((a,v,i)=>a+(v-yhat[i])**2,0);
    const ssTot = y.reduce((a,v)=>a+(v-ymean)**2,0);
    const r2 = 1 - ssRes/ssTot;
    // 백테스트
    const [c0,c1,c2] = ols2(X.slice(0,-1), y.slice(0,-1));
    const last = X[X.length-1];
    const btPred = c0 + c1*last[0] + c2*last[1];
    const btErr = Math.abs(btPred - y[y.length-1]) / y[y.length-1] * 100;
    const pred = b0 + b1*(targetYear-2015);          // 평년 기상
    let surplus;
    if (item === "쌀") {
      const [d1, d2] = DATA.riceDemand;
      const slope = (d2[1]-d1[1])/(d2[0]-d1[0]);
      surplus = pred - (d2[1] + slope*(targetYear-d2[0]));
    } else surplus = pred * nonstdRate;
    out[item] = { r2, btErr, trend: b1, weatherEff: b2, pred,
                  surplus: Math.max(surplus,0), pool: Math.max(surplus,0)*acqRate*1000 }; // 톤
  }
  return out;
}

// ===== Stage 2: 수송 LP =====
function stage2(pools, minShareRatio) {   // pools: {item: tons}, minShareRatio: 0~1 (0=제약 없음)
  const nI = 4, nZ = 5;
  const supply = DATA.items.map(it => pools[it]);
  const totRec = Object.values(DATA.zoneRecipients).reduce((a,v)=>a+v,0);
  const share = DATA.zones.map(z => DATA.zoneRecipients[z]/totRec);
  const total = supply.reduce((a,v)=>a+v,0);
  // 목적계수: 거리 + 미세 비선형 페널티(거리²×ε) — 복수 최적해의 타이브레이커.
  // 장거리 수송일수록 신선도 저하·비용이 비선형 증가한다는 현실 반영 (총비용에는 사실상 무영향)
  const c = DATA.dist.flat().map(d => d + 1e-6 * d * d);
  const Aeq = [], beq = [];
  for (let i=0;i<nI;i++){ const r=new Array(20).fill(0); for(let z=0;z<nZ;z++) r[i*nZ+z]=1; Aeq.push(r); beq.push(supply[i]); }
  for (let z=0;z<nZ;z++){ const r=new Array(20).fill(0); for(let i=0;i<nI;i++) r[i*nZ+z]=1; Aeq.push(r); beq.push(total*share[z]); }
  const Aub=[], bub=[];
  if (minShareRatio > 0) for (let i=0;i<nI;i++) for (let z=0;z<nZ;z++){
    const r=new Array(20).fill(0); r[i*nZ+z]=-1; Aub.push(r); bub.push(-supply[i]*share[z]*minShareRatio);
  }
  const res = simplexMin(c, Aub, bub, Aeq, beq, null);
  if (!res.ok) return { ok:false };
  const alloc = DATA.items.map((_,i)=>DATA.zones.map((_,z)=>res.x[i*nZ+z]));
  // 보고용 비용은 순수 톤·km로 재계산 (ε 페널티 제외)
  res.cost = 0;
  for (let i=0;i<nI;i++) for (let z=0;z<nZ;z++) res.cost += alloc[i][z]*DATA.dist[i][z];
  // 단순 비례배분
  let naive = 0;
  for (let i=0;i<nI;i++) for (let z=0;z<nZ;z++) naive += supply[i]*share[z]*DATA.dist[i][z];
  return { ok:true, alloc, cost:res.cost, naive, share, supply, total };
}

// ===== Stage 3: 영양 LP =====
function stage3One(ben, foodList) {
  const fl = foodList.map(f => ({name:f, ...DATA.foods[f]}));
  const nf = fl.length, nn = 6;
  const c = new Array(nf+nn).fill(0); for (let k=0;k<nn;k++) c[nf+k] = -1/nn;
  const Aub=[], bub=[];
  for (let k=0;k<nn;k++){
    const r=new Array(nf+nn).fill(0);
    for (let j=0;j<nf;j++) r[j] = -fl[j].v[k]/100/ben.dri[k];
    r[nf+k]=1; Aub.push(r); bub.push(0);
  }
  { const r=new Array(nf+nn).fill(0); for(let j=0;j<nf;j++) r[j]=fl[j].v[0]/100; Aub.push(r); bub.push(1.05*ben.dri[0]); }
  { const r=new Array(nf+nn).fill(0); for(let j=0;j<nf;j++) r[j]=1; Aub.push(r); bub.push(1500); }
  const ub = fl.map(f=>f.cap).concat(new Array(nn).fill(1));
  const res = simplexMin(c, Aub, bub, [], [], ub);
  if (!res.ok) return null;
  const basket = {}; fl.forEach((f,j)=>{ if(res.x[j]>1) basket[f.name]=Math.round(res.x[j]); });
  const z = res.x.slice(nf).map(v=>v*100);
  return { score: -res.cost*100, z, basket };
}

function stage3Scenarios(allocNoFb, allocFb, hubIndex) {
  hubIndex = hubIndex ?? 0;   // 수도권
  const processed = ["라면","참치통조림","즉석죽","초코과자"];
  const farm = name => Object.keys(DATA.foods).filter(f=>DATA.foods[f].cat==="농산물");
  const arrived = alloc => farm().filter(f => {
    const i = DATA.items.indexOf(DATA.foods[f].item);
    return alloc[i][hubIndex] > 1;
  });
  const scen = {
    "S1 현행": processed,
    "S2 1차 사이클": processed.concat(arrived(allocNoFb)),
    "S3 피드백 반영": processed.concat(arrived(allocFb)),
  };
  const out = {};
  for (const [name, list] of Object.entries(scen)) {
    out[name] = { foods:list, byBen:{} };
    for (const ben of DATA.beneficiaries) out[name].byBen[ben.id] = stage3One(ben, list);
    out[name].avg = DATA.beneficiaries.reduce((a,b)=>a+out[name].byBen[b.id].score,0)/3;
  }
  return out;
}

if (typeof module !== "undefined") module.exports = { simplexMin, stage1, stage2, stage3Scenarios, stage3One, DATA };
