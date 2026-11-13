// 경제 브리핑 화면
const $ = (sel) => document.querySelector(sel);

const TABS = ['news', 'market', 'picks'];
const SIDES = ['fx', 'indices', 'terms'];
const TAB_KEY = 'briefing.tab';
const SIDE_KEY = 'briefing.side';

const params = new URLSearchParams(location.search);
let activeTab = pickOf(TABS, params.get('tab') ?? safeGet(TAB_KEY), 'news');
let activeSide = pickOf(SIDES, params.get('side') ?? safeGet(SIDE_KEY), 'fx');
let state = null;
let stateTimer = null;

function pickOf(list, v, fallback) { return list.includes(v) ? v : fallback; }
function safeGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function safeSet(k, v) { try { localStorage.setItem(k, v); } catch { /* 무시 */ } }

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
function safeUrl(u) {
  return /^https?:\/\//i.test(u ?? '') ? esc(u) : '#';
}
function timeKo(iso) {
  return new Date(iso).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Seoul' });
}
function dateTimeKo(iso) {
  return new Date(iso).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Seoul' });
}
function isToday(iso) {
  const f = (d) => d.toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' });
  return f(new Date(iso)) === f(new Date());
}
function whenKo(iso) {
  return `${isToday(iso) ? '오늘 ' + timeKo(iso) : dateTimeKo(iso)}`;
}
const ARROW = { up: '▲', down: '▼', flat: '–' };

// ───── 탭 ─────
function selectTab(tab) {
  activeTab = tab;
  safeSet(TAB_KEY, tab);
  document.querySelectorAll('.tab').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
  for (const t of TABS) $(`#panel-${t}`).hidden = t !== tab;
  renderChrome();
}
function selectSide(side) {
  activeSide = side;
  safeSet(SIDE_KEY, side);
  document.querySelectorAll('.side-tab').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.side === side)));
  for (const s of SIDES) $(`#side-${s}`).hidden = s !== side;
}
document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => selectTab(b.dataset.tab)));
document.querySelectorAll('.side-tab').forEach((b) => b.addEventListener('click', () => selectSide(b.dataset.side)));

// ───── 핸드폰 하단 탭 ─────
// 뉴스·증시·종목은 본문 탭, 시세(환율+지수)·용어는 사이드 내용을 전체 화면으로 보여준다.
const VIEW_KEY = 'briefing.view';
function selectView(view) {
  document.body.dataset.view = view;
  safeSet(VIEW_KEY, view);
  document.querySelectorAll('.bottom-nav button').forEach((b) => b.setAttribute('aria-current', String(b.dataset.view === view)));
  if (TABS.includes(view)) selectTab(view);
  else if (view === 'terms') selectSide('terms');
  window.scrollTo({ top: 0 });
}
document.querySelectorAll('.bottom-nav button').forEach((b) => b.addEventListener('click', () => selectView(b.dataset.view)));

// ───── 새로고침 ─────
$('#refresh').addEventListener('click', async () => {
  $('#refresh').disabled = true;
  try {
    const res = checkAuth(await fetch(`api/refresh?target=${activeTab}`, { method: 'POST' }));
    const data = await res.json();
    if (state) state.status = data.status;
    renderChrome();
    scheduleState(1500);
  } catch {
    showBanner('서버에 연결하지 못했습니다.', true);
    $('#refresh').disabled = false;
  }
});

// ───── 상태 불러오기 ─────
const LAST_STATE_KEY = 'briefing.lastState';
let offline = false;

/** PIN 이 필요하면 입력 화면으로 */
function checkAuth(res) {
  if (res.status === 401) { location.replace('login.html'); throw new Error('auth'); }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res;
}

async function loadState() {
  try {
    const res = checkAuth(await fetch('api/state', { cache: 'no-store' }));
    state = await res.json();
    offline = false;
    safeSet(LAST_STATE_KEY, JSON.stringify({ savedAt: new Date().toISOString(), state }));
    renderNews();
    renderMarket();
    renderPicks();
    renderTerms();
    renderChrome();
    const anyRunning = Object.values(state.status).some((s) => s.running);
    scheduleState(anyRunning ? 3000 : 60_000);
  } catch (err) {
    if (err.message === 'auth') return;
    // PC가 꺼져 있거나 절전 중 — 이 기기에 저장해 둔 마지막 브리핑을 보여준다
    const saved = (() => { try { return JSON.parse(safeGet(LAST_STATE_KEY)); } catch { return null; } })();
    if (!state && saved?.state) {
      state = saved.state;
      renderNews(); renderMarket(); renderPicks(); renderTerms(); renderChrome();
    }
    offline = true;
    renderChrome();
    scheduleState(15_000);
  }
}
function scheduleState(ms) {
  clearTimeout(stateTimer);
  stateTimer = setTimeout(loadState, ms);
}

function showBanner(text, isError) {
  const b = $('#banner');
  b.hidden = !text;
  b.className = 'banner' + (isError ? ' error' : '');
  b.innerHTML = text ? `<span class="dot"></span><span>${esc(text)}</span>` : '';
}

const LABEL = { news: '뉴스 요약', market: '나스닥 이슈 검색·정리', picks: '관심 종목 분석' };
const DURATION = { news: '보통 1분 안팎', market: '보통 3~5분', picks: '보통 3~6분' };

/** 상단 갱신 시각·새로고침 버튼·배너를 현재 탭 기준으로 그린다 */
function renderChrome() {
  $('#today').textContent = new Date().toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short', timeZone: 'Asia/Seoul' });
  if (offline) {
    const btn = $('#refresh');
    btn.disabled = true;
    btn.classList.remove('spinning');
    showBanner(state
      ? '인터넷에 연결할 수 없어 이 기기에 저장된 마지막 브리핑을 보여줍니다'
      : '인터넷에 연결할 수 없습니다.', true);
    if (!state) return;
    const data = state[activeTab];
    $('#updated').textContent = data ? `${whenKo(data.generatedAt)} 업데이트` : '';
    return;
  }
  if (!state) return;
  const s = state.status[activeTab];
  const data = state[activeTab];
  const btn = $('#refresh');
  btn.disabled = s.running;
  btn.classList.toggle('spinning', s.running);

  $('#updated').textContent = data ? `${whenKo(data.generatedAt)} 업데이트` : '';

  if (s.running) {
    showBanner(`${LABEL[activeTab]} 업데이트 중 (${DURATION[activeTab]})${s.progress ? ' — ' + s.progress : ''}${data ? ' · 아래는 직전 브리핑입니다' : ''}`);
  } else if (!data && activeTab === 'picks' && state.status.market.running) {
    showBanner('증시 브리핑이 끝나면 이어서 종목을 분석합니다');
  } else if (s.error) {
    showBanner(`${LABEL[activeTab]} 실패: ${s.error}`, true);
  } else {
    showBanner('');
  }
}

function placeholder(text) {
  return `<div class="empty">${esc(text)}…<div style="max-width:520px;margin:18px auto 0">
    <div class="skeleton" style="width:90%"></div><div class="skeleton" style="width:70%"></div><div class="skeleton" style="width:80%"></div>
  </div></div>`;
}

// ───── 뉴스 탭 ─────
function renderNews() {
  const el = $('#panel-news');
  const data = state.news;
  if (!data) {
    el.innerHTML = placeholder('언론사별 랭킹 뉴스를 요약하고 있습니다');
    return;
  }
  el.innerHTML = `<div class="press-grid">${data.presses.map((p) => `
    <article class="press">
      <div class="press-head">
        <h3>${esc(p.press)}</h3>
        <a href="${safeUrl(p.rankingUrl)}" target="_blank" rel="noopener">랭킹 전체 ↗</a>
      </div>
      <ol>${p.items.length ? p.items.map((it) => `
        <li>
          <span class="rank">${it.rank}</span>
          <div>
            <a class="n-title" href="${safeUrl(it.url)}" target="_blank" rel="noopener">${esc(it.title)}</a>
            ${it.summary ? `<p class="n-summary">${esc(it.summary)}</p>` : ''}
            <div class="n-meta">${esc(it.publishedAt ? it.publishedAt.slice(5, 16).replace('-', '.') : it.ago)}</div>
          </div>
        </li>`).join('') : '<li><span></span><div class="n-meta">랭킹 기사를 가져오지 못했습니다</div></li>'}
      </ol>
    </article>`).join('')}</div>`;
}

// ───── 증시 탭 ─────
function renderOverview(o) {
  if (!o) return '';
  if (typeof o === 'string') return `<div class="overview"><div class="ov-label">오늘의 나스닥</div><p class="ov-recap">${esc(o)}</p></div>`;
  return `
    <div class="overview">
      <div class="ov-label">오늘의 나스닥</div>
      <h2 class="ov-headline">${esc(o.headline)}</h2>
      <p class="ov-recap">${esc(o.recap)}</p>
      <div class="ov-grid">
        <section>
          <h4>왜 이렇게 움직였나</h4>
          <ol class="ov-drivers">${(o.drivers ?? []).map((d) => `<li><b>${esc(d.title)}</b><p>${esc(d.detail)}</p></li>`).join('')}</ol>
        </section>
        <section>
          <h4>앞으로 볼 일정</h4>
          <ul class="ov-watch">${(o.watch ?? []).map((w) => `<li><span class="when">${esc(w.when)}</span><b>${esc(w.event)}</b><p>${esc(w.why)}</p></li>`).join('')}</ul>
        </section>
      </div>
      ${o.takeaway ? `<p class="ov-takeaway"><b>정리</b>${esc(o.takeaway)}</p>` : ''}
    </div>`;
}

function renderMarket() {
  const el = $('#panel-market');
  const data = state.market;
  if (!data) {
    el.innerHTML = placeholder('나스닥 이슈를 검색하고 있습니다');
    return;
  }
  const impactClass = { 호재: 'good', 악재: 'bad' };
  el.innerHTML = `
    ${renderOverview(data.overview)}
    <ol class="issues">${data.items.map((it) => `
      <li class="issue">
        <span class="rank">${it.rank}</span>
        <div>
          <div class="chips">
            <span class="chip ${impactClass[it.impact] ?? ''}">${esc(it.impact)}</span>
            <span class="chip">${esc(it.category)}</span>
          </div>
          <h3 class="i-title">${esc(it.title)}</h3>
          <p class="i-summary">${esc(it.summary)}</p>
          ${it.whyItMatters ? `<p class="i-why">${esc(it.whyItMatters)}</p>` : ''}
          <div class="i-foot">
            <span>${esc(it.source)}${it.published ? ' · ' + esc(it.published) : ''}</span>
            <a href="${safeUrl(it.url)}" target="_blank" rel="noopener">원문 보기 ↗</a>
            ${it.linkOk ? '' : `<span class="warn">링크가 열리지 않을 수 있음</span>
              <a href="https://www.google.com/search?q=${encodeURIComponent(it.source + ' ' + it.title)}" target="_blank" rel="noopener">검색으로 찾기 ↗</a>`}
          </div>
        </div>
      </li>`).join('')}
    </ol>`;
}

// ───── 종목 탭 ─────
function money(snap, v) {
  if (v == null || Number.isNaN(v)) return '—';
  return snap.currency === 'USD'
    ? '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : Math.round(v).toLocaleString('ko-KR') + '원';
}

/** 3개월 종가 미니 차트 (+20일 이동평균선) */
function sparkline(closes) {
  if (!closes?.length) return '';
  const W = 220, H = 64, P = 3;
  const ys = closes.map((c) => c.close);
  const min = Math.min(...ys), max = Math.max(...ys);
  const x = (i) => P + (i * (W - 2 * P)) / (ys.length - 1);
  const y = (v) => H - P - ((v - min) / (max - min || 1)) * (H - 2 * P);
  const line = ys.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const ma = ys.map((_, i) => (i < 19 ? null : ys.slice(i - 19, i + 1).reduce((a, b) => a + b, 0) / 20));
  const maPath = ma.map((v, i) => (v == null ? '' : `${ma[i - 1] == null ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`)).join('');
  const up = ys.at(-1) >= ys[0];
  return `<svg class="spark ${up ? 'up' : 'down'}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="최근 3개월 주가">
    <path class="ma" d="${maPath}" /><path class="px" d="${line}" /></svg>`;
}

function renderPicks() {
  const el = $('#panel-picks');
  const data = state.picks;
  const disclaimer = `<p class="disclaimer">AI가 오늘의 공개 뉴스와 네이버 증권 시세로 만든 <b>참고용 분석</b>입니다. 투자 권유가 아니며, 투자 판단과 책임은 본인에게 있습니다.</p>`;
  if (!data) {
    el.innerHTML = disclaimer + placeholder('오늘 증시 이슈와 연결된 종목을 찾고 있습니다');
    return;
  }
  const basis = data.basedOnMarketAt ? `<p class="picks-basis">${esc(whenKo(data.basedOnMarketAt))} 증시 브리핑 기준 · 가격은 분석 시점 값</p>` : '';
  if (!data.items.length) {
    el.innerHTML = `${disclaimer}${basis}<div class="no-picks"><b>오늘은 추천할 종목이 없습니다</b><p>${esc(data.note || '오늘 이슈와 연결고리가 뚜렷한 종목을 찾지 못했습니다.')}</p></div>`;
    return;
  }
  const viewClass = { 긍정: 'good', 신중: 'bad' };
  el.innerHTML = `${disclaimer}${basis}
    ${data.note ? `<p class="picks-note">${esc(data.note)}</p>` : ''}
    <div class="picks">${data.items.map((p) => {
      const s = p.snapshot;
      return `
      <article class="pick">
        <header class="pick-head">
          <div class="pick-id">
            <div class="chips">
              <span class="chip ${p.market === 'US' ? 'us' : 'kr'}">${p.market === 'US' ? '미국' : '국내'}</span>
              <span class="chip">${esc(p.sector)}</span>
            </div>
            <h3><a href="${safeUrl(s.url)}" target="_blank" rel="noopener">${esc(p.name)}</a></h3>
            <div class="pick-code">${esc(s.symbol)} · ${esc(s.exchange)}</div>
          </div>
          <div class="pick-price">
            <div class="px-now">${money(s, s.price)}</div>
            <div class="fx-change ${s.direction}">${ARROW[s.direction]} ${money(s, s.change)} (${s.changePct}%)</div>
            <div class="px-when">${s.status === 'OPEN' ? '장중' : '종가'} · ${esc(dateTimeKo(s.tradedAt))}</div>
          </div>
        </header>
        <div class="pick-chart">
          ${sparkline(s.closes)}
          <div class="pick-stats">
            <span>3개월 <b class="${s.tech.return3m >= 0 ? 'pos' : 'neg'}">${s.tech.return3m > 0 ? '+' : ''}${s.tech.return3m}%</b></span>
            <span>고가 ${money(s, s.tech.high3m)}</span>
            <span>저가 ${money(s, s.tech.low3m)}</span>
            <span>20일선 ${money(s, s.tech.ma20)}</span>
          </div>
        </div>
        <p class="pick-issue">연결 이슈 · ${esc(p.linkedIssue)}</p>
        <dl class="pick-body">
          <dt>추천 이유</dt><dd>${esc(p.reason)}</dd>
          <dt>회사 정보</dt><dd>${esc(p.companyInfo)}</dd>
          <dt>3개월 전망 <span class="chip ${viewClass[p.outlook.view] ?? ''}">${esc(p.outlook.view)}</span></dt><dd>${esc(p.outlook.summary)}</dd>
          <dt>매수 타점</dt>
          <dd class="buy">
            <div class="zone">${esc(p.buyPoint.zone)}</div>
            <p>${esc(p.buyPoint.summary)}</p>
            ${p.buyPoint.recheck ? `<p class="recheck">재검토 · ${esc(p.buyPoint.recheck)}</p>` : ''}
          </dd>
          <dt>리스크</dt><dd>${esc(p.risk)}</dd>
        </dl>
      </article>`;
    }).join('')}</div>`;
}

// ───── 사이드: 용어 ─────
function renderTerms() {
  const el = $('#terms');
  const data = state.terms;
  const st = state.status.terms;
  if (!data || !isToday(data.generatedAt)) {
    if (st.running) { el.innerHTML = `<p class="side-meta">오늘 기사에서 용어를 고르는 중…</p>`; return; }
    if (!data) { el.innerHTML = `<p class="side-meta">뉴스·증시 브리핑이 모두 준비되면 오늘의 용어를 정리합니다.</p>`; return; }
  }
  const group = (title, items) => `
    <h3 class="terms-title">${title} <span>${items.length}</span></h3>
    <ul class="terms">${items.map((t) => `
      <li>
        <div class="term-head"><b>${esc(t.term)}</b><span class="chip">${esc(t.category)}</span></div>
        <p class="term-exp">${esc(t.explanation)}</p>
        <p class="term-ctx">${esc(t.context)}</p>
        <p class="term-src">${esc(t.source)}</p>
      </li>`).join('')}
    </ul>`;
  // 옛 형식(items) 호환
  const news = data.news ?? [];
  const market = data.market ?? data.items ?? [];
  el.innerHTML = `${group('뉴스 용어', news)}${group('증시 용어', market)}
    <p class="side-meta">${esc(whenKo(data.generatedAt))} 정리 · 하루 한 번 업데이트</p>`;
}

// ───── 사이드: 환율·지수 ─────
function quoteRow({ href, title, code, sub, value, direction, changeText }) {
  return `
    <li><a href="${safeUrl(href)}" target="_blank" rel="noopener" title="${esc(title)}">
      <div class="q-row"><span class="q-name"><b>${code}</b></span><span class="q-value">${value}</span></div>
      <div class="q-row"><span class="q-name">${sub}</span><span class="fx-change ${direction}">${changeText}</span></div>
    </a></li>`;
}

/** 시세를 받아오고 기기에 보관한다. PC에 연결할 수 없으면 보관해 둔 값을 돌려준다 */
async function fetchQuotes(url, key) {
  try {
    const res = checkAuth(await fetch(url, { cache: 'no-store' }));
    const data = await res.json();
    safeSet(key, JSON.stringify(data));
    return { data, stale: false };
  } catch (err) {
    if (err.message === 'auth') throw err;
    const saved = (() => { try { return JSON.parse(safeGet(key)); } catch { return null; } })();
    if (!saved) throw err;
    return { data: saved, stale: true };
  }
}

async function loadFx() {
  try {
    const { data: { fetchedAt, rates }, stale } = await fetchQuotes('api/fx', 'briefing.lastFx');
    $('#fx').innerHTML = rates.map((r) => quoteRow({
      href: r.url,
      title: `${r.name} 상세 보기`,
      code: `${esc(r.code)}${r.unit > 1 ? ` <small>${r.unit}</small>` : ''}`,
      sub: esc(r.name),
      value: r.rate == null ? '—' : r.rate.toLocaleString('ko-KR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      direction: r.direction,
      changeText: r.change == null ? '' : `${ARROW[r.direction]} ${r.change.toFixed(2)}${r.changePct == null ? '' : ` (${r.changePct.toFixed(2)}%)`}`,
    })).join('');
    $('#fx-meta').textContent = `원(KRW) 기준 · 하나은행 매매기준율\n${stale ? `PC 연결 안 됨 · ${dateTimeKo(fetchedAt)} 저장값` : `${timeKo(fetchedAt)} 조회 · 1분마다 갱신`}`;
  } catch {
    $('#fx-meta').textContent = '환율을 불러오지 못했습니다';
  }
}

async function loadIndices() {
  try {
    const { data: { fetchedAt, indices }, stale } = await fetchQuotes('api/indices', 'briefing.lastIndices');
    const sections = [['US', '미국'], ['KR', '국내']];
    $('#indices').innerHTML = sections.map(([region, label]) => `
      <li class="q-group">${label}</li>
      ${indices.filter((i) => i.region === region).map((i) => quoteRow({
        href: i.url,
        title: `${i.name} 상세 보기`,
        code: esc(i.name),
        sub: i.tradedAt ? `${i.status === 'OPEN' ? '<span class="live">장중</span>' : '마감'} · ${esc(i.region === 'US' ? i.tradedAt.slice(5, 10).replace('-', '/') + ' 현지' : timeKo(i.tradedAt))}` : '',
        value: i.value == null ? '—' : i.value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
        direction: i.direction,
        changeText: i.change == null ? '' : `${ARROW[i.direction]} ${i.change.toLocaleString('en-US', { maximumFractionDigits: 2 })} (${i.changePct.toFixed(2)}%)`,
      })).join('')}`).join('');
    $('#indices-meta').textContent = `네이버 증권 · ${stale ? `PC 연결 안 됨 · ${dateTimeKo(fetchedAt)} 저장값` : `${timeKo(fetchedAt)} 조회 · 1분마다 갱신`}`;
  } catch {
    $('#indices-meta').textContent = '지수를 불러오지 못했습니다';
  }
}

selectTab(activeTab);
selectSide(activeSide);
selectView(pickOf([...TABS, 'quotes', 'terms'], params.get('view') ?? safeGet(VIEW_KEY), activeTab));
selectTab(activeTab);

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === '127.0.0.1')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
loadState();
loadFx();
loadIndices();
setInterval(() => { loadFx(); loadIndices(); }, 60_000);
setInterval(renderChrome, 60_000);

// 핸드폰에서 앱을 다시 열거나 네트워크가 돌아오면 타이머를 기다리지 않고 바로 최신으로 갱신한다
// (백그라운드의 브라우저는 타이머를 멈추므로, 돌아온 순간 옛 브리핑이 보이는 것을 막는다)
let lastWake = 0;
function refreshNow() {
  const now = Date.now();
  if (now - lastWake < 2000) return; // visibilitychange·focus·pageshow 가 연달아 와도 한 번만
  lastWake = now;
  loadState();
  loadFx();
  loadIndices();
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refreshNow(); });
window.addEventListener('focus', refreshNow);
window.addEventListener('pageshow', (e) => { if (e.persisted) refreshNow(); });
window.addEventListener('online', refreshNow);
