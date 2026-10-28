(() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const STORAGE_KEY = "jangmi-alert-tokens";

  const state = { config: null, complex: null, dong: null, ho: null };

  async function api(path, options = {}) {
    const res = await fetch(path, {
      ...options,
      headers: options.body ? { "Content-Type": "application/json" } : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `요청 실패 (HTTP ${res.status})`);
    return data;
  }

  function won(n) {
    if (n === null || n === undefined) return "-";
    const eok = Math.floor(n / 1e8);
    const man = Math.round((n % 1e8) / 1e4);
    if (eok && man) return `${eok}억 ${man.toLocaleString("ko-KR")}만원`;
    if (eok) return `${eok}억원`;
    return `${man.toLocaleString("ko-KR")}만원`;
  }

  function pctText(cur, prev) {
    if (!prev) return "";
    const pct = ((cur - prev) / prev) * 100;
    const cls = pct > 0 ? "up" : pct < 0 ? "down" : "";
    return `<span class="${cls}">${pct > 0 ? "▲" : pct < 0 ? "▼" : ""} ${Math.abs(pct).toFixed(2)}%</span>`;
  }

  function fmtTime(iso) {
    if (!iso) return "아직 없음";
    return new Date(iso).toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" });
  }

  // ---------- 로컬에 저장한 관리 토큰 ----------
  function savedTokens() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
    } catch {
      return [];
    }
  }
  function saveTokens(tokens) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...new Set(tokens)]));
    } catch {}
  }

  // ---------- 알림 방법·조건 폼 ----------
  function randomTopic() {
    const bytes = crypto.getRandomValues(new Uint8Array(6));
    return `jangmi-${[...bytes].map((b) => b.toString(36).padStart(2, "0")).join("").slice(0, 10)}`;
  }

  function buildChannelFields(container, channels = {}) {
    container.replaceChildren($("#channelTpl").content.cloneNode(true));
    const cfg = state.config;
    const enabled = { email: cfg.channels.email, telegram: cfg.channels.telegram, ntfy: true, webhook: true };
    const values = { email: channels.email, ntfy: channels.ntfyTopic, telegram: channels.telegramChatId, webhook: channels.webhookUrl };

    for (const field of $$(".field", container)) {
      const name = field.dataset.channel;
      const toggle = $("[data-toggle]", field);
      const input = $("input:not([data-toggle])", field);
      if (!enabled[name]) {
        toggle.disabled = true;
        field.classList.add("off");
        $$("[data-off]", field).forEach((el) => (el.hidden = false));
        $$("[data-on]", field).forEach((el) => (el.hidden = true));
        continue;
      }
      if (values[name]) input.value = values[name];
      toggle.checked = Boolean(values[name]) || (name === "ntfy" && !Object.values(values).some(Boolean));
      const sync = () => field.classList.toggle("off", !toggle.checked);
      toggle.addEventListener("change", () => {
        sync();
        if (toggle.checked) input.focus();
      });
      sync();
    }

    const ntfyInput = $("[name=ntfyTopic]", container);
    if (!ntfyInput.value) ntfyInput.value = randomTopic();
    $("[data-regen]", container).addEventListener("click", () => (ntfyInput.value = randomTopic()));
    $("[data-server]", container).textContent = cfg.ntfyServer;
    const bot = $("[data-bot]", container);
    if (cfg.telegramBotName) {
      bot.href = `https://t.me/${cfg.telegramBotName}`;
      bot.textContent = `@${cfg.telegramBotName}`;
    }
  }

  function buildOptionFields(container, options) {
    container.replaceChildren($("#optionTpl").content.cloneNode(true));
    $("[data-reminders]", container).innerHTML = state.config.reminders
      .map((r) => `<li>${esc(r.date.replace("-", "월 "))}일 — ${esc(r.title)}</li>`)
      .join("");
    if (options) {
      $("[name=notifyNewNotice]", container).checked = options.notifyNewNotice !== false;
      $("[name=scheduleReminders]", container).checked = Boolean(options.scheduleReminders);
      $("[name=minChangePct]", container).value = options.minChangePct ?? 0;
    }
  }

  function readChannels(container) {
    const out = {};
    const pick = (channel, key) => {
      const field = $(`[data-channel=${channel}]`, container);
      if ($("[data-toggle]", field).checked) out[key] = $("input:not([data-toggle])", field).value.trim();
    };
    pick("email", "email");
    pick("ntfy", "ntfyTopic");
    pick("telegram", "telegramChatId");
    pick("webhook", "webhookUrl");
    return out;
  }

  function readOptions(container) {
    return {
      notifyNewNotice: $("[name=notifyNewNotice]", container).checked,
      scheduleReminders: $("[name=scheduleReminders]", container).checked,
      minChangePct: Number($("[name=minChangePct]", container).value) || 0,
    };
  }

  const CHANNEL_NAMES = { email: "이메일", telegram: "텔레그램", ntfy: "ntfy 푸시", webhook: "웹훅" };
  function deliveryHtml(results = []) {
    if (!results.length) return "";
    return `<ul class="delivery">${results
      .map((r) =>
        r.ok
          ? `<li class="ok">✓ ${CHANNEL_NAMES[r.channel]} 발송 완료</li>`
          : `<li class="fail">✕ ${CHANNEL_NAMES[r.channel]} 발송 실패: ${esc(r.error)}</li>`
      )
      .join("")}</ul>`;
  }

  // ---------- 세대 선택 ----------
  async function loadComplexes(q) {
    const box = $("#complexes");
    box.innerHTML = `<p class="hint">단지를 찾는 중…</p>`;
    resetDong();
    try {
      const list = await api(`/api/complexes?q=${encodeURIComponent(q)}`);
      if (!list.length) {
        box.innerHTML = `<p class="hint">${esc(state.config.defaultRegion)}에서 “${esc(q)}” 단지를 찾지 못했습니다.</p>`;
        return;
      }
      box.innerHTML = "";
      for (const c of list) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "complex";
        btn.setAttribute("role", "radio");
        btn.setAttribute("aria-checked", "false");
        btn.innerHTML = `<b>${esc(c.name)}</b><small>${esc(c.roadAddress || c.landAddress)}</small>`;
        btn.addEventListener("click", () => selectComplex(c, btn));
        box.append(btn);
      }
      if (list.length === 1) box.firstChild.click();
    } catch (err) {
      box.innerHTML = `<p class="hint">${esc(err.message)}</p>`;
    }
  }

  function resetDong() {
    state.complex = state.dong = state.ho = null;
    $("#dongSelect").innerHTML = `<option value="">단지를 먼저 고르세요</option>`;
    $("#dongSelect").disabled = true;
    resetHo();
  }

  function resetHo() {
    state.ho = null;
    $("#hoSelect").innerHTML = `<option value="">동을 먼저 고르세요</option>`;
    $("#hoSelect").disabled = true;
    $("#historyBox").hidden = true;
    updateSubmit();
  }

  async function selectComplex(c, btn) {
    $$(".complex").forEach((b) => b.setAttribute("aria-checked", String(b === btn)));
    resetDong();
    state.complex = c;
    const sel = $("#dongSelect");
    sel.innerHTML = `<option value="">불러오는 중…</option>`;
    try {
      const dongs = await api(`/api/dongs?aptCode=${encodeURIComponent(c.aptCode)}&noticeDate=${encodeURIComponent(c.noticeDate)}`);
      sel.innerHTML = `<option value="">동 선택 (${dongs.length}개)</option>` + dongs.map((d) => `<option value="${esc(d.code)}">${esc(d.name)}</option>`).join("");
      sel.disabled = false;
      sel._items = dongs;
    } catch (err) {
      sel.innerHTML = `<option value="">${esc(err.message)}</option>`;
    }
  }

  $("#dongSelect").addEventListener("change", async (e) => {
    resetHo();
    const dong = (e.target._items || []).find((d) => d.code === e.target.value);
    state.dong = dong || null;
    if (!dong) return;
    const sel = $("#hoSelect");
    sel.innerHTML = `<option value="">불러오는 중…</option>`;
    const c = state.complex;
    try {
      const hos = await api(`/api/hos?aptCode=${encodeURIComponent(c.aptCode)}&noticeDate=${encodeURIComponent(c.noticeDate)}&dongCode=${encodeURIComponent(dong.code)}`);
      sel.innerHTML = `<option value="">호 선택 (${hos.length}개)</option>` + hos.map((h) => `<option value="${esc(h.code)}">${esc(h.name)}</option>`).join("");
      sel.disabled = false;
      sel._items = hos;
    } catch (err) {
      sel.innerHTML = `<option value="">${esc(err.message)}</option>`;
    }
  });

  $("#hoSelect").addEventListener("change", async (e) => {
    const ho = (e.target._items || []).find((h) => h.code === e.target.value);
    state.ho = ho || null;
    updateSubmit();
    const box = $("#historyBox");
    if (!ho) {
      box.hidden = true;
      return;
    }
    box.hidden = false;
    box.innerHTML = `<p class="hint">공시가격을 불러오는 중…</p>`;
    const c = state.complex;
    try {
      const history = await api(
        `/api/history?aptCode=${encodeURIComponent(c.aptCode)}&noticeDate=${encodeURIComponent(c.noticeDate)}&dongCode=${encodeURIComponent(state.dong.code)}&hoCode=${encodeURIComponent(ho.code)}`
      );
      renderHistory(box, history);
    } catch (err) {
      box.innerHTML = `<p class="hint">${esc(err.message)}</p>`;
    }
  });

  function renderHistory(box, history) {
    if (!history.length) {
      box.innerHTML = `<p class="hint">공시된 가격이 없습니다.</p>`;
      return;
    }
    const [latest, prev] = history;
    const asc = [...history].reverse();
    const max = Math.max(...asc.map((h) => h.priceWon));
    const w = 600, h = 160, pad = 22, bw = (w / asc.length) * 0.6, gap = w / asc.length;
    const bars = asc
      .map((row, i) => {
        const bh = ((h - pad * 2) * row.priceWon) / max;
        const x = i * gap + (gap - bw) / 2;
        const y = h - pad - bh;
        return `<rect class="bar${i === asc.length - 1 ? " last" : ""}" x="${x}" y="${y}" width="${bw}" height="${bh}" rx="4"><title>${row.year}년 ${won(row.priceWon)}</title></rect>
          <text x="${x + bw / 2}" y="${h - 6}" text-anchor="middle">${row.year}</text>
          <text x="${x + bw / 2}" y="${y - 5}" text-anchor="middle">${(row.priceWon / 1e8).toFixed(1)}억</text>`;
      })
      .join("");
    box.innerHTML = `
      <div class="latest">
        <span>${latest.year}년 공시가격</span>
        <span class="price">${won(latest.priceWon)}</span>
        ${pctText(latest.priceWon, prev?.priceWon)}
      </div>
      <p class="hint">${latest.areaSqm ? `전용 ${latest.areaSqm}㎡ · ` : ""}${latest.noticeDate ? `공시일 ${latest.noticeDate}` : ""}</p>
      <svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="연도별 공시가격">${bars}</svg>
      <table>
        <thead><tr><th>연도</th><th>공시가격</th><th>전년 대비</th></tr></thead>
        <tbody>${history
          .map((row, i) => `<tr><td>${row.year}</td><td>${row.priceWon.toLocaleString("ko-KR")}원</td><td>${pctText(row.priceWon, history[i + 1]?.priceWon) || "-"}</td></tr>`)
          .join("")}</tbody>
      </table>`;
  }

  function updateSubmit() {
    const ready = Boolean(state.complex && state.dong && state.ho);
    $("#submitBtn").disabled = !ready;
    $("#submitHint").textContent = ready ? `${state.complex.name} ${state.dong.name} ${state.ho.name}` : "세대를 먼저 선택하세요.";
  }

  $("#searchForm").addEventListener("submit", (e) => {
    e.preventDefault();
    loadComplexes($("#searchInput").value.trim() || state.config.defaultSearch);
  });

  // ---------- 등록 ----------
  $("#subForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const result = $("#formResult");
    const btn = $("#submitBtn");
    btn.disabled = true;
    result.innerHTML = `<div class="result">등록 중…</div>`;
    try {
      const data = await api("/api/subscriptions", {
        method: "POST",
        body: JSON.stringify({
          complex: state.complex,
          unit: { dongName: state.dong.name, hoName: state.ho.name },
          channels: readChannels($("#channelFields")),
          options: readOptions($("#optionFields")),
        }),
      });
      saveTokens([...savedTokens(), data.subscription.token]);
      result.innerHTML = `<div class="result">
        <b>알림이 등록되었습니다.</b> 새 공시가격이 발표되면 알려드립니다.
        ${deliveryHtml(data.delivery)}
        <p class="hint">설정 변경·해지 링크 (다른 기기에서 관리하려면 보관하세요):<br><a href="${esc(data.manageUrl)}"><code>${esc(data.manageUrl)}</code></a></p>
      </div>`;
      renderMyList();
    } catch (err) {
      result.innerHTML = `<div class="result error">${esc(err.message)}</div>`;
    } finally {
      updateSubmit();
    }
  });

  // ---------- 내 알림 목록 ----------
  async function renderMyList() {
    const tokens = savedTokens();
    const card = $("#myCard");
    card.hidden = tokens.length === 0;
    if (!tokens.length) return;
    const list = $("#myList");
    const alive = [];
    const items = await Promise.all(tokens.map((t) => api(`/api/subscriptions/${t}`).catch(() => null)));
    list.innerHTML = "";
    items.forEach((sub, i) => {
      if (!sub) return;
      alive.push(tokens[i]);
      const li = document.createElement("li");
      const ways = Object.entries({ email: sub.channels.email, ntfy: sub.channels.ntfyTopic, telegram: sub.channels.telegramChatId, webhook: sub.channels.webhookUrl })
        .filter(([, v]) => v)
        .map(([k]) => CHANNEL_NAMES[k])
        .join(", ");
      li.innerHTML = `<div><b>${esc(sub.complex.name)} ${esc(sub.unit.dongName)} ${esc(sub.unit.hoName)}</b>
        <small>${esc(ways)} · 최근 공시 ${sub.lastNotifiedYear || "-"}년 ${won(sub.lastPriceWon)}</small></div>
        <div class="btns"><a class="btn secondary small" href="?manage=${encodeURIComponent(sub.token)}">관리</a></div>`;
      list.append(li);
    });
    saveTokens(alive);
    card.hidden = alive.length === 0;
  }

  // ---------- 관리 화면 ----------
  async function showManage(token) {
    $("#unitCard").hidden = true;
    $("#subForm").hidden = true;
    const card = $("#manageCard");
    card.hidden = false;
    const body = $("#manageBody");
    body.innerHTML = `<p class="hint">불러오는 중…</p>`;
    let sub;
    try {
      sub = await api(`/api/subscriptions/${encodeURIComponent(token)}`);
    } catch (err) {
      body.innerHTML = `<div class="result error">${esc(err.message)}</div>`;
      return;
    }
    saveTokens([...savedTokens(), token]);
    body.innerHTML = `
      <div class="summary">
        <span class="unit">${esc(sub.complex.name)} ${esc(sub.unit.dongName)} ${esc(sub.unit.hoName)}</span>
        <span class="hint">${esc(sub.complex.roadAddress || sub.complex.landAddress)}</span>
        <span class="hint">최근 공시가격: ${sub.lastNotifiedYear || "-"}년 ${won(sub.lastPriceWon)} · 마지막 확인 ${fmtTime(sub.lastCheckedAt)}</span>
        ${sub.lastError ? `<span class="hint up">최근 확인 오류: ${esc(sub.lastError)}</span>` : ""}
      </div>
      <form id="manageForm" novalidate>
        <div class="card-head"><h2>알림 받을 방법</h2></div>
        <div id="mChannels"></div>
        <div class="card-head"><h2>알림 조건</h2></div>
        <div id="mOptions"></div>
        <div class="actions">
          <button type="submit" class="btn primary">저장</button>
          <button type="button" class="btn secondary" id="testBtn">테스트 알림 보내기</button>
          <button type="button" class="btn danger" id="deleteBtn">알림 해지</button>
        </div>
        <div id="manageResult"></div>
      </form>`;
    buildChannelFields($("#mChannels"), sub.channels);
    buildOptionFields($("#mOptions"), sub.options);
    const out = $("#manageResult");

    $("#manageForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        await api(`/api/subscriptions/${encodeURIComponent(token)}`, {
          method: "PUT",
          body: JSON.stringify({ channels: readChannels($("#mChannels")), options: readOptions($("#mOptions")) }),
        });
        out.innerHTML = `<div class="result">저장했습니다.</div>`;
      } catch (err) {
        out.innerHTML = `<div class="result error">${esc(err.message)}</div>`;
      }
    });

    $("#testBtn").addEventListener("click", async () => {
      out.innerHTML = `<div class="result">보내는 중… (저장하지 않은 변경 사항은 반영되지 않습니다)</div>`;
      try {
        out.innerHTML = `<div class="result">테스트 알림 결과${deliveryHtml(await api(`/api/subscriptions/${encodeURIComponent(token)}/test`, { method: "POST" }))}</div>`;
      } catch (err) {
        out.innerHTML = `<div class="result error">${esc(err.message)}</div>`;
      }
    });

    $("#deleteBtn").addEventListener("click", async () => {
      if (!confirm("이 알림을 해지할까요?")) return;
      try {
        await api(`/api/subscriptions/${encodeURIComponent(token)}`, { method: "DELETE" });
        saveTokens(savedTokens().filter((t) => t !== token));
        body.innerHTML = `<div class="result">알림을 해지했습니다. <a href="./">처음으로</a></div>`;
      } catch (err) {
        out.innerHTML = `<div class="result error">${esc(err.message)}</div>`;
      }
    });
  }

  // ---------- 시작 ----------
  async function init() {
    try {
      state.config = await api("/api/config");
    } catch (err) {
      $("#status").textContent = `서버에 연결하지 못했습니다: ${err.message}`;
      return;
    }
    const cfg = state.config;
    $("#mockBanner").hidden = !cfg.mock;
    $("#status").textContent = `${cfg.checkIntervalHours}시간마다 새 공시가격을 확인합니다 · 마지막 확인 ${fmtTime(cfg.lastRunAt)}`;

    const manage = new URLSearchParams(location.search).get("manage");
    if (manage) {
      showManage(manage);
      return;
    }
    $("#searchInput").value = cfg.defaultSearch;
    buildChannelFields($("#channelFields"));
    buildOptionFields($("#optionFields"));
    loadComplexes(cfg.defaultSearch);
    renderMyList();
  }

  init();
})();
