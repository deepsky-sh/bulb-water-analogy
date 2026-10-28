// 부동산공시가격알리미(realtyprice.kr) 공동주택 공시가격 조회 클라이언트.
// 공식 OpenAPI가 아니라 브라우저가 쓰는 공개 화면용 엔드포인트를 그대로 호출한다.
// 요청 형식은 MIT 라이선스 k-skill/housing-official-price 패키지를 참고했다.

const BASE = "https://www.realtyprice.kr/notice";
const SEARCH_REFERER = `${BASE}/m/town/search.do`;
const DETAIL_REFERER = `${BASE}/m/town/detail.do`;
const TIMEOUT_MS = 30000;
const CACHE_TTL_MS = 10 * 60 * 1000;

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (jangmi-price-alert)",
  "X-Requested-With": "XMLHttpRequest",
  "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
};

const cache = new Map();

class UpstreamError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}

async function post(path, params, referer, as = "json") {
  const body = new URLSearchParams(params).toString();
  const key = `${path}?${body}`;
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;

  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: { ...HEADERS, Referer: referer },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw new UpstreamError(`공시가격 사이트에 연결하지 못했습니다: ${err.message}`);
  }
  if (!res.ok) throw new UpstreamError(`공시가격 사이트가 HTTP ${res.status}로 응답했습니다.`);

  const text = await res.text();
  let value = text;
  if (as === "json") {
    try {
      value = JSON.parse(text);
    } catch {
      throw new UpstreamError("공시가격 사이트 응답을 해석하지 못했습니다(JSON 아님).");
    }
  }
  cache.set(key, { value, expires: Date.now() + CACHE_TTL_MS });
  return value;
}

function listOf(data) {
  const model = data?.model || data?.modelMap || {};
  return Array.isArray(model.list) ? model.list : [];
}

function num(value) {
  if (value === null || value === undefined) return null;
  const n = Number(String(value).replace(/,/g, "").trim());
  return Number.isFinite(n) && String(value).trim() !== "" ? n : null;
}

function ymd(value) {
  const digits = String(value || "").replace(/[^0-9]/g, "");
  return digits.length >= 8 ? `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}` : null;
}

function decode(s) {
  return String(s || "")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();
}

async function searchComplexes(name) {
  const data = await post(
    "/m/town/getApt.do",
    {
      search_gbn: "1",
      search_detail_gbn: "3",
      notice_date: "",
      notice_date_nm: "",
      sido: "",
      sido_nm: "",
      sigungu: "",
      sigungu_nm: "",
      road_reg: "",
      road_initial: "",
      road_initial_nm: "",
      road_code: "",
      road_code_nm: "",
      dongri: "",
      dongri_nm: "",
      reg: "",
      eub: "",
      search_name: name,
      search_bun: "",
    },
    SEARCH_REFERER
  );
  return listOf(data).map((r) => ({
    aptCode: String(r.APT_CODE ?? ""),
    noticeDate: String(r.NOTICE_DATE ?? ""),
    name: r.MOD_APT_NAME || r.APT_NAME || "",
    roadAddress: r.FULL_ROAD_NAME || "",
    landAddress: r.FULL_BJD_NAME || r.FULL_ADDR_NAME || "",
    pnu: r.SPNU ? String(r.SPNU) : "",
  }));
}

async function listDongs(aptCode, noticeDate) {
  const html = await post(
    "/m/town/detail.do",
    { notice_date: noticeDate, apt_code: aptCode, tiles: "false" },
    SEARCH_REFERER,
    "text"
  );
  const select = String(html).match(/<select\b[^>]*id=["']sel_dong["'][^>]*>([\s\S]*?)<\/select>/i);
  if (!select) throw new UpstreamError("동 목록을 찾지 못했습니다(사이트 구조 변경 가능성).");
  const dongs = [];
  for (const m of select[1].matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/gi)) {
    const code = (m[1].match(/value\s*=\s*["']([^"']*)["']/i) || [])[1] || "";
    const name = decode(m[2]);
    if (code && name && !name.includes("선택")) dongs.push({ code, name });
  }
  return dongs;
}

async function listHos(aptCode, noticeDate, dongCode) {
  const data = await post(
    "/m/town/getHo.do",
    { notice_date: noticeDate, apt_code: aptCode, dong_code: dongCode },
    DETAIL_REFERER
  );
  return listOf(data)
    .map((r) => ({ code: String(r.CODE ?? ""), name: String(r.NAME ?? "") }))
    .filter((h) => h.code && h.name);
}

async function priceHistory(aptCode, noticeDate, dongCode, hoCode) {
  const data = await post(
    "/m/town/getPriceYear.do",
    { notice_date: noticeDate, apt_code: aptCode, dong_code: dongCode, ho_code: hoCode },
    DETAIL_REFERER
  );
  return listOf(data)
    .map((r) => {
      const label = r.NOTICE_DATE_NAME || r.NOTICE_DATE || r.NOTICE_DATE_ORG || "";
      const year = Number((String(label).match(/\d{4}/) || [])[0]) || null;
      return {
        year,
        baseDate: ymd(r.NOTICE_DATE_NAME || r.NOTICE_DATE),
        noticeDate: ymd(r.NOTICE_DATE_ORG),
        priceWon: num(r.NOTICE_AMT),
        areaSqm: num(r.PRIV_AREA),
      };
    })
    .filter((h) => h.year && h.priceWon !== null)
    .sort((a, b) => b.year - a.year);
}

function clearCache() {
  cache.clear();
}

module.exports = { searchComplexes, listDongs, listHos, priceHistory, clearCache, UpstreamError };
