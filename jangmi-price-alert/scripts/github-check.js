#!/usr/bin/env node
// GitHub Actions에서 도는 서버 없는 버전.
// jangmi/watch.json의 세대를 확인해 jangmi/data/prices.json을 갱신하고, 새 공시가 있으면 알림을 보낸다.
//
//   node scripts/github-check.js check            # 정기 확인
//   node scripts/github-check.js request          # 이슈(ISSUE_TITLE/ISSUE_BODY/ISSUE_AUTHOR)로 세대 추가·삭제 후 확인
//
// 환경 변수: REALTYPRICE_MOCK=1, JANGMI_DIR(기본 ../jangmi), NOTIFY_EMAIL, TELEGRAM_CHAT_ID,
//            그 밖에 SMTP_*, TELEGRAM_BOT_TOKEN, NTFY_SERVER는 서버 버전과 같다.

const fs = require("node:fs");
const path = require("node:path");
const { loadConfig } = require("../src/config");
const { createNotifier } = require("../src/notifier");
const { won, seoulToday } = require("../src/checker");

const DIR = path.resolve(process.env.JANGMI_DIR || path.join(__dirname, "..", "..", "jangmi"));
const WATCH_FILE = path.join(DIR, "watch.json");
const DATA_FILE = path.join(DIR, "data", "prices.json");
const SEARCH = "장미";
const REGION = "송파구";
const MAX_UNITS = 30;

const config = loadConfig();
const api = process.env.REALTYPRICE_MOCK === "1" ? require("../src/mock") : require("../src/realtyprice");
const notifier = createNotifier(config);

function readJson(file, fallback) {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : fallback;
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

const unitId = (u) => `${u.complex}|${u.dong}|${u.ho}`;
const unitName = (u) => `${u.complex} ${u.dong} ${u.ho}`;

async function notify(watch, title, text) {
  const channels = {
    ntfyTopic: watch.ntfyTopic,
    email: process.env.NOTIFY_EMAIL || "",
    telegramChatId: process.env.TELEGRAM_CHAT_ID || "",
  };
  const results = await notifier.send({ channels }, { title, text, link: watch.siteUrl });
  for (const r of results) console.log(`  알림 ${r.channel}: ${r.ok ? "성공" : `실패 (${r.error})`}`);
}

function priceLines(u, history) {
  const [latest, prev] = history;
  const lines = [`${unitName(u)}`, `${latest.year}년 공시가격: ${won(latest.priceWon)} (${latest.priceWon.toLocaleString("ko-KR")}원)`];
  if (prev) {
    const diff = latest.priceWon - prev.priceWon;
    lines.push(`전년(${prev.year}) 대비: ${diff >= 0 ? "+" : "-"}${won(Math.abs(diff))} (${diff >= 0 ? "+" : ""}${((diff / prev.priceWon) * 100).toFixed(2)}%)`);
  }
  if (latest.noticeDate) lines.push(`공시일: ${latest.noticeDate}`);
  return lines;
}

async function fetchUnit(complexes, u) {
  const complex = complexes.find((c) => c.name === u.complex);
  if (!complex) throw new Error(`단지 "${u.complex}"를 찾지 못했습니다. (${complexes.map((c) => c.name).join(", ")})`);
  const dongs = await api.listDongs(complex.aptCode, complex.noticeDate);
  const dong = dongs.find((d) => d.name === u.dong);
  if (!dong) throw new Error(`"${u.dong}"이 없습니다. 가능한 동: ${dongs.map((d) => d.name).join(", ")}`);
  const hos = await api.listHos(complex.aptCode, complex.noticeDate, dong.code);
  const ho = hos.find((h) => h.name === u.ho);
  if (!ho) throw new Error(`${u.dong}에 "${u.ho}"가 없습니다. 예: ${hos.slice(0, 8).map((h) => h.name).join(", ")} …`);
  return api.priceHistory(complex.aptCode, complex.noticeDate, dong.code, ho.code);
}

async function check() {
  const watch = readJson(WATCH_FILE, { units: [] });
  const prev = readJson(DATA_FILE, { complexes: [], units: [], remindersSent: [] });
  const next = { ...prev, status: "ok", error: null };
  const report = [];

  // 일정 알림
  const today = seoulToday();
  for (const r of config.reminders.filter((r) => r.date === today.slice(5))) {
    const id = `${today.slice(0, 4)}-${r.date}`;
    if ((prev.remindersSent || []).includes(id)) continue;
    console.log(`일정 알림: ${r.title}`);
    await notify(watch, `[공시가격 일정] ${r.title}`, `${r.text}\n\n부동산공시가격알리미: https://www.realtyprice.kr`);
    next.remindersSent = [...(prev.remindersSent || []), id].slice(-10);
  }

  let complexes;
  try {
    complexes = (await api.searchComplexes(SEARCH)).filter((c) => `${c.roadAddress} ${c.landAddress}`.includes(REGION));
    if (!complexes.length) throw new Error(`${REGION} "${SEARCH}" 단지 검색 결과가 비어 있습니다.`);
  } catch (err) {
    console.error(`::error::공시가격 사이트 조회 실패: ${err.message}`);
    next.status = "error";
    next.error = err.message;
    save(prev, next);
    return { ok: false, report: [`공시가격 사이트 조회에 실패했습니다: ${err.message}`] };
  }

  // 단지 단위: 새 연도 공시 감지
  const newNotices = [];
  for (const c of complexes) {
    const before = prev.complexes.find((p) => p.name === c.name);
    if (before && c.noticeDate.slice(0, 4) > before.noticeDate.slice(0, 4)) newNotices.push(`${c.name} ${c.noticeDate.slice(0, 4)}년`);
  }
  next.complexes = complexes.map(({ name, aptCode, noticeDate, roadAddress, landAddress }) => ({ name, aptCode, noticeDate, roadAddress, landAddress }));

  // 세대 단위
  next.units = [];
  const unitMessages = [];
  for (const u of watch.units || []) {
    const before = prev.units.find((p) => unitId(p) === unitId(u));
    let history;
    try {
      history = await fetchUnit(complexes, u);
      if (!history.length) throw new Error("공시된 가격이 없습니다.");
    } catch (err) {
      console.warn(`${unitName(u)}: ${err.message}`);
      next.units.push({ ...u, history: before?.history || [], error: err.message });
      report.push(`- ${unitName(u)}: ⚠️ ${err.message}`);
      continue;
    }
    next.units.push({ ...u, history, error: null });
    const latest = history[0];
    const beforeYear = before?.history?.[0]?.year;
    if (!beforeYear) {
      unitMessages.push({ complex: u.complex, title: `[알림 등록] ${unitName(u)} ${latest.year}년 ${won(latest.priceWon)}`, lines: ["공시가격 알림이 등록되었습니다. 새 공시가격이 발표되면 알려드립니다.", "", ...priceLines(u, history)] });
    } else if (latest.year > beforeYear) {
      unitMessages.push({ complex: u.complex, newYear: true, title: `[공시가격] ${unitName(u)} ${latest.year}년 ${won(latest.priceWon)}`, lines: priceLines(u, history) });
    }
    report.push(`- ${unitName(u)}: ${latest.year}년 ${won(latest.priceWon)}`);
  }

  for (const m of unitMessages) {
    console.log(m.title);
    await notify(watch, m.title, `${m.lines.join("\n")}\n\n출처: 부동산공시가격알리미 https://www.realtyprice.kr`);
  }
  // 세대별 알림이 이미 간 단지는 단지 알림을 따로 보내지 않는다.
  const covered = new Set(unitMessages.filter((m) => m.newYear).map((m) => m.complex));
  const remaining = newNotices.filter((n) => !covered.has(n.split(" ")[0]));
  if (remaining.length) {
    console.log(`새 공시: ${remaining.join(", ")}`);
    await notify(watch, `[공시가격] 장미아파트 새 공시가격 발표`, `${remaining.join(", ")} 공동주택 공시가격이 공시되었습니다.\n\n${watch.siteUrl || ""}`);
  }

  save(prev, next);
  return { ok: true, report };
}

// 내용이 바뀐 경우에만 updatedAt을 갱신해 쓸데없는 커밋을 막는다.
function save(prev, next) {
  const strip = ({ updatedAt, ...rest }) => JSON.stringify(rest);
  next.updatedAt = strip(prev) === strip(next) ? prev.updatedAt || new Date().toISOString() : new Date().toISOString();
  writeJson(DATA_FILE, next);
}

function normalize(value, suffix) {
  const v = String(value || "").replace(/\s+/g, "");
  return /^\d+$/.test(v) ? `${v}${suffix}` : v;
}

function parseRequest(body) {
  const field = (name) => (String(body).match(new RegExp(`^\\s*${name}\\s*[:：]\\s*(.+)$`, "m")) || [])[1]?.trim() || "";
  return {
    action: field("요청").includes("삭제") || field("요청").includes("해지") ? "remove" : "add",
    unit: { complex: field("단지").replace(/\s+/g, ""), dong: normalize(field("동"), "동"), ho: normalize(field("호"), "호") },
  };
}

async function request() {
  const { action, unit } = parseRequest(process.env.ISSUE_BODY || "");
  const out = [];
  const watch = readJson(WATCH_FILE, { units: [] });
  watch.units ||= [];
  if (!/^장미\d차$/.test(unit.complex) || !unit.dong || !unit.ho) {
    out.push(`요청을 해석하지 못했습니다. 본문에 \`단지: 장미1차\`, \`동: 11동\`, \`호: 101호\` 형식으로 적어 주세요.`);
  } else if (action === "remove") {
    const before = watch.units.length;
    watch.units = watch.units.filter((u) => unitId(u) !== unitId(unit));
    out.push(before === watch.units.length ? `${unitName(unit)}은(는) 알림 목록에 없습니다.` : `${unitName(unit)} 알림을 해지했습니다.`);
  } else if (watch.units.some((u) => unitId(u) === unitId(unit))) {
    out.push(`${unitName(unit)}은(는) 이미 등록되어 있습니다.`);
  } else if (watch.units.length >= MAX_UNITS) {
    out.push(`최대 ${MAX_UNITS}세대까지 등록할 수 있습니다.`);
  } else {
    watch.units.push(unit);
    out.push(`${unitName(unit)} 알림을 등록했습니다.`);
  }
  writeJson(WATCH_FILE, watch);

  const result = await check();
  // 존재하지 않는 세대는 목록에서 빼고 이유를 알려준다.
  const data = readJson(DATA_FILE, { units: [] });
  const bad = data.units.find((u) => unitId(u) === unitId(unit) && u.error && !u.history.length);
  if (action === "add" && bad && result.ok) {
    watch.units = watch.units.filter((u) => unitId(u) !== unitId(unit));
    data.units = data.units.filter((u) => unitId(u) !== unitId(unit));
    writeJson(WATCH_FILE, watch);
    writeJson(DATA_FILE, data);
    out.splice(0, out.length, `${unitName(unit)}을(를) 찾지 못해 등록하지 않았습니다.\n\n${bad.error}`);
  } else {
    out.push("", "현재 알림 목록:", ...(result.report.length ? result.report : ["(없음)"]));
  }
  out.push("", `알림은 ntfy 토픽 \`${watch.ntfyTopic}\`으로 발송됩니다. 사이트: ${watch.siteUrl || ""}`);
  const message = out.join("\n");
  console.log(message);
  if (process.env.RESULT_FILE) fs.writeFileSync(process.env.RESULT_FILE, message);
  return result;
}

if (require.main === module) {
  const mode = process.argv[2] || "check";
  (mode === "request" ? request() : check())
    .then((r) => process.exit(r.ok ? 0 : 2))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = { check, request, parseRequest };
