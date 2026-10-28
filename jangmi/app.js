(() => {
  const $ = (sel) => document.querySelector(sel);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const COMPLEXES = ["장미1차", "장미2차", "장미3차"];

  function won(n) {
    if (n === null || n === undefined) return "-";
    const eok = Math.floor(n / 1e8);
    const man = Math.round((n % 1e8) / 1e4);
    if (eok && man) return `${eok}억 ${man.toLocaleString("ko-KR")}만원`;
    if (eok) return `${eok}억원`;
    return `${man.toLocaleString("ko-KR")}만원`;
  }

  function pct(cur, prev) {
    if (!prev) return "";
    const p = ((cur - prev) / prev) * 100;
    const cls = p > 0 ? "up" : p < 0 ? "down" : "";
    return `<span class="${cls}">${p > 0 ? "▲" : p < 0 ? "▼" : ""} ${Math.abs(p).toFixed(2)}%</span>`;
  }

  function fmtTime(iso) {
    return iso ? new Date(iso).toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" }) : "아직 없음";
  }

  function issueUrl(repo, action, unit) {
    const title = `[공시가격 알림] ${action} ${unit.complex} ${unit.dong} ${unit.ho}`;
    const body = [`요청: ${action}`, `단지: ${unit.complex}`, `동: ${unit.dong}`, `호: ${unit.ho}`, "", "(이 내용 그대로 Create를 누르면 자동 처리됩니다.)"].join("\n");
    return `https://github.com/${repo}/issues/new?labels=${encodeURIComponent("공시가격-알림")}&title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
  }

  function normalize(v, suffix) {
    v = v.replace(/\s+/g, "");
    return /^\d+$/.test(v) ? v + suffix : v;
  }

  function renderUnits(watch, data) {
    const box = $("#units");
    const units = watch.units || [];
    if (!units.length) {
      box.innerHTML = `<p class="empty">아직 등록된 세대가 없습니다. 아래 <b>세대 추가</b>에서 동·호를 입력해 주세요. 세대를 등록하지 않아도 장미1·2·3차에 새 공시가격이 발표되면 알림이 옵니다.</p>`;
      return;
    }
    box.innerHTML = units
      .map((u) => {
        const d = (data.units || []).find((x) => x.complex === u.complex && x.dong === u.dong && x.ho === u.ho);
        const history = d?.history || [];
        const [latest, prev] = history;
        const removeUrl = issueUrl(watch.repo, "삭제", u);
        let body;
        if (!d) body = `<p class="hint">다음 확인 때 공시가격을 불러옵니다.</p>`;
        else if (!latest) body = `<p class="hint up">${esc(d.error || "공시가격 없음")}</p>`;
        else
          body = `
            <div><span class="hint">${latest.year}년 공시가격</span> <span class="price">${won(latest.priceWon)}</span> ${pct(latest.priceWon, prev?.priceWon)}</div>
            <p class="hint">${latest.areaSqm ? `전용 ${latest.areaSqm}㎡ · ` : ""}${latest.noticeDate ? `공시일 ${latest.noticeDate}` : ""}</p>
            ${d.error ? `<p class="hint up">최근 확인 오류: ${esc(d.error)}</p>` : ""}
            <details><summary>연도별 보기</summary>
              <table><thead><tr><th>연도</th><th>공시가격</th><th>전년 대비</th></tr></thead><tbody>
              ${history.map((h, i) => `<tr><td>${h.year}</td><td>${h.priceWon.toLocaleString("ko-KR")}원</td><td>${pct(h.priceWon, history[i + 1]?.priceWon) || "-"}</td></tr>`).join("")}
              </tbody></table>
            </details>`;
        return `<div class="unit"><div class="unit-head"><span class="unit-name">${esc(u.complex)} ${esc(u.dong)} ${esc(u.ho)}</span>
          <a class="btn danger small" href="${esc(removeUrl)}" target="_blank" rel="noopener">해지 요청</a></div>${body}</div>`;
      })
      .join("");
  }

  function renderComplexes(data) {
    const list = data.complexes || [];
    $("#complexes").innerHTML = list.length
      ? list
          .map((c) => `<div><b>${esc(c.name)}</b><small>${esc(c.roadAddress || c.landAddress)}</small><small>최근 공시: ${esc(c.noticeDate.slice(0, 4))}년 (${esc(c.noticeDate.replace(/(\d{4})(\d{2})(\d{2})/, "$1.$2.$3"))})</small></div>`)
          .join("")
      : `<p class="empty">첫 확인이 끝나면 표시됩니다.</p>`;
  }

  async function init() {
    let watch, data;
    try {
      [watch, data] = await Promise.all(["watch.json", "data/prices.json"].map((f) => fetch(`${f}?t=${Date.now()}`).then((r) => r.json())));
    } catch (err) {
      $("#status").textContent = `데이터를 불러오지 못했습니다: ${err.message}`;
      return;
    }

    $("#status").textContent = `매일 오전 9시·오후 6시 자동 확인 · 데이터 갱신 ${fmtTime(data.updatedAt)}`;
    if (data.status === "error") {
      const banner = $("#errorBanner");
      banner.hidden = false;
      banner.textContent = `최근 확인에서 공시가격 사이트 조회에 실패했습니다: ${data.error}`;
    }

    $("#topic").textContent = watch.ntfyTopic;
    $("#webSub").href = `https://ntfy.sh/${encodeURIComponent(watch.ntfyTopic)}`;
    $("#runsLink").href = `https://github.com/${watch.repo}/actions`;
    $("#copyTopic").addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(watch.ntfyTopic);
        $("#copyTopic").textContent = "복사됨";
      } catch {
        $("#copyTopic").textContent = "직접 복사해 주세요";
      }
    });

    const names = (data.complexes || []).map((c) => c.name);
    $("#complexSelect").innerHTML = (names.length ? names : COMPLEXES).map((n) => `<option>${esc(n)}</option>`).join("");

    $("#addForm").addEventListener("submit", (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      const unit = { complex: f.get("complex"), dong: normalize(f.get("dong"), "동"), ho: normalize(f.get("ho"), "호") };
      if (!unit.dong || !unit.ho) return;
      window.open(issueUrl(watch.repo, "추가", unit), "_blank", "noopener");
    });

    renderUnits(watch, data);
    renderComplexes(data);
  }

  init();
})();
