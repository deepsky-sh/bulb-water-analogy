// 구독마다 최신 공시가격을 확인해 새 연도가 공시되면 알림을 보낸다.
// 같은 세대를 구독한 사람이 여러 명이어도 공시가격 사이트에는 한 번만 묻는다.

function seoulToday() {
  // "YYYY-MM-DD" (Asia/Seoul)
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
}

function won(n) {
  if (n === null || n === undefined) return "-";
  const eok = Math.floor(n / 100_000_000);
  const man = Math.round((n % 100_000_000) / 10_000);
  if (eok && man) return `${eok}억 ${man.toLocaleString("ko-KR")}만원`;
  if (eok) return `${eok}억원`;
  return `${man.toLocaleString("ko-KR")}만원`;
}

function unitLabel(sub) {
  return `${sub.complex.name} ${sub.unit.dongName} ${sub.unit.hoName}`;
}

function unitKey(sub) {
  return [sub.complex.aptCode, sub.complex.name, sub.unit.dongName, sub.unit.hoName].join("|");
}

// 해마다 공시 기준일(notice_date)이 바뀌어 코드가 달라질 수 있으므로 이름으로 다시 찾는다.
async function resolveHistory(api, sub) {
  const candidates = await api.searchComplexes(sub.complex.name);
  const complex =
    candidates.find((c) => c.aptCode === sub.complex.aptCode) ||
    candidates.find((c) => c.name === sub.complex.name && c.landAddress === sub.complex.landAddress);
  if (!complex) throw new Error(`단지를 찾지 못했습니다: ${sub.complex.name}`);

  const dongs = await api.listDongs(complex.aptCode, complex.noticeDate);
  const dong = dongs.find((d) => d.name === sub.unit.dongName);
  if (!dong) throw new Error(`동을 찾지 못했습니다: ${sub.unit.dongName}`);

  const hos = await api.listHos(complex.aptCode, complex.noticeDate, dong.code);
  const ho = hos.find((h) => h.name === sub.unit.hoName);
  if (!ho) throw new Error(`호를 찾지 못했습니다: ${sub.unit.hoName}`);

  return api.priceHistory(complex.aptCode, complex.noticeDate, dong.code, ho.code);
}

function priceMessage(sub, latest, previous, manageLink) {
  const lines = [`${unitLabel(sub)}`, `${latest.year}년 공시가격: ${won(latest.priceWon)} (${latest.priceWon.toLocaleString("ko-KR")}원)`];
  if (previous) {
    const diff = latest.priceWon - previous.priceWon;
    const pct = ((diff / previous.priceWon) * 100).toFixed(2);
    lines.push(`전년(${previous.year}) 대비: ${diff >= 0 ? "+" : "-"}${won(Math.abs(diff))} (${diff >= 0 ? "+" : ""}${pct}%)`);
  }
  if (latest.noticeDate) lines.push(`공시일: ${latest.noticeDate}`);
  if (latest.areaSqm) lines.push(`전용면적: ${latest.areaSqm}㎡`);
  lines.push("", "출처: 부동산공시가격알리미 https://www.realtyprice.kr");
  return { title: `[공시가격] ${unitLabel(sub)} ${latest.year}년 ${won(latest.priceWon)}`, text: lines.join("\n"), link: manageLink };
}

function changePct(latest, previous) {
  if (!previous) return null;
  return ((latest.priceWon - previous.priceWon) / previous.priceWon) * 100;
}

function createChecker({ api, store, notifier, config, log = console }) {
  const manageLink = (sub) => `${config.publicUrl}/?manage=${sub.token}`;

  async function checkPrices() {
    const groups = new Map();
    for (const sub of store.all()) {
      if (sub.options?.notifyNewNotice === false) continue;
      const key = unitKey(sub);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(sub);
    }

    const summary = { units: groups.size, notified: 0, errors: 0 };
    for (const subs of groups.values()) {
      let history;
      try {
        history = await resolveHistory(api, subs[0]);
      } catch (err) {
        summary.errors++;
        for (const sub of subs) store.update(sub.token, { lastCheckedAt: new Date().toISOString(), lastError: err.message });
        log.warn(`[check] ${unitLabel(subs[0])}: ${err.message}`);
        continue;
      }
      const [latest, previous] = history;
      for (const sub of subs) {
        const patch = { lastCheckedAt: new Date().toISOString(), lastError: null };
        if (latest && latest.year > (sub.lastNotifiedYear || 0)) {
          const pct = changePct(latest, previous);
          const threshold = Number(sub.options?.minChangePct) || 0;
          if (pct === null || Math.abs(pct) >= threshold) {
            const results = await notifier.send(sub, priceMessage(sub, latest, previous, manageLink(sub)));
            patch.lastDelivery = results;
            summary.notified++;
          }
          patch.lastNotifiedYear = latest.year;
          patch.lastPriceWon = latest.priceWon;
        }
        store.update(sub.token, patch);
      }
    }
    return summary;
  }

  async function sendReminders(today = seoulToday()) {
    const monthDay = today.slice(5);
    const due = config.reminders.filter((r) => r.date === monthDay);
    let sent = 0;
    for (const reminder of due) {
      const id = `${today.slice(0, 4)}-${reminder.date}`;
      for (const sub of store.all()) {
        if (!sub.options?.scheduleReminders) continue;
        if ((sub.remindersSent || []).includes(id)) continue;
        await notifier.send(sub, {
          title: `[공시가격 일정] ${reminder.title}`,
          text: `${unitLabel(sub)}\n\n${reminder.text}\n\n부동산공시가격알리미: https://www.realtyprice.kr`,
          link: manageLink(sub),
        });
        store.update(sub.token, { remindersSent: [...(sub.remindersSent || []), id].slice(-10) });
        sent++;
      }
    }
    return sent;
  }

  async function runOnce() {
    const reminders = await sendReminders();
    const prices = await checkPrices();
    store.setMeta("lastRunAt", new Date().toISOString());
    log.info(`[check] 세대 ${prices.units}곳 확인, 알림 ${prices.notified}건, 오류 ${prices.errors}건, 일정 알림 ${reminders}건`);
    return { ...prices, reminders };
  }

  let timer = null;
  let running = false;
  function start() {
    const tick = async () => {
      if (running) return;
      running = true;
      try {
        await runOnce();
      } catch (err) {
        log.error("[check] 실패:", err);
      } finally {
        running = false;
      }
    };
    setTimeout(tick, 5000);
    timer = setInterval(tick, config.checkIntervalHours * 3600 * 1000);
  }

  function stop() {
    clearInterval(timer);
  }

  return { runOnce, checkPrices, sendReminders, start, stop, resolveHistory: (sub) => resolveHistory(api, sub) };
}

module.exports = { createChecker, priceMessage, won, unitLabel, seoulToday };
