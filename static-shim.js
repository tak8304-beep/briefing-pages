// 정적 사이트(GitHub Pages)용 — 서버 API 호출을 "암호화된 data.enc.json" 로 대신 받는다.
// app.js·login.html 은 서버 버전과 같은 코드를 쓰고, 이 파일이 fetch('/api/…') 를 가로채 같은 모양으로 돌려준다.
(() => {
  const realFetch = window.fetch.bind(window);
  const KEY = 'briefing.pass';
  const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const json = (body, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const store = {
    get() { try { return localStorage.getItem(KEY); } catch { return null; } },
    set(v) { try { localStorage.setItem(KEY, v); } catch { /* 무시 */ } },
    del() { try { localStorage.removeItem(KEY); } catch { /* 무시 */ } },
  };

  // 새로고침 버튼은 서버 전용이다 (브리핑은 매일 아침 자동으로 만들어진다)
  const style = document.createElement('style');
  style.textContent = '#refresh{display:none!important}';
  document.head.appendChild(style);

  class WrongPass extends Error {}

  async function decrypt(pass) {
    const res = await realFetch('data.enc.json?t=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const enc = await res.json();
    const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
    const key = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: b64(enc.salt), iterations: enc.iter, hash: 'SHA-256' },
      material, { name: 'AES-GCM', length: 256 }, false, ['decrypt'],
    );
    let plain;
    try {
      plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(enc.iv) }, key, b64(enc.ct));
    } catch { throw new WrongPass(); }
    return JSON.parse(new TextDecoder().decode(plain));
  }

  // 같은 화면에서 state·fx·indices 를 연달아 부르므로 잠깐 재사용한다
  let memo = null;
  function payload(pass) {
    if (!memo || memo.pass !== pass || Date.now() - memo.at > 10_000) {
      memo = { pass, at: Date.now(), p: decrypt(pass) };
      memo.p.catch(() => { memo = null; });
    }
    return memo.p;
  }

  async function handle(path, init) {
    if (path === '/api/login') {
      let given = '';
      try { given = String(JSON.parse(init?.body ?? '{}').pin ?? ''); } catch { /* 빈 값 */ }
      try {
        await payload(given);
        store.set(given);
        return json({ ok: true });
      } catch (e) {
        if (e instanceof WrongPass) return json({ error: '암호가 맞지 않습니다.' }, 401);
        throw e;
      }
    }
    const pass = store.get();
    if (!pass) return json({ error: '암호가 필요합니다' }, 401);
    let data;
    try {
      data = await payload(pass);
    } catch (e) {
      if (e instanceof WrongPass) { store.del(); return json({ error: '암호가 바뀌었습니다' }, 401); }
      throw e; // 인터넷 연결 문제 — app.js 가 이 기기에 저장해 둔 마지막 브리핑을 보여준다
    }
    if (path === '/api/state') return json(data.state);
    if (path === '/api/fx') return data.fx ? json(data.fx) : json({ error: 'no data' }, 502);
    if (path === '/api/indices') return data.indices ? json(data.indices) : json({ error: 'no data' }, 502);
    if (path === '/api/refresh') return json({ started: [], status: data.state.status });
    return json({ error: 'not found' }, 404);
  }

  window.fetch = (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href);
    const m = /\/(api\/(?:login|state|fx|indices|refresh))$/.exec(url.pathname);
    return m ? handle('/' + m[1], init) : realFetch(input, init);
  };
})();
