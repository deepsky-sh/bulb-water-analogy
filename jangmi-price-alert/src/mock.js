// 개발·테스트용 가짜 데이터. REALTYPRICE_MOCK=1 이면 realtyprice.js 대신 쓰인다.
// 가격은 실제 공시가격이 아니다.

const state = { latestYear: 2026 };

const complexes = [
  { aptCode: "M0001", name: "장미1차", roadAddress: "서울특별시 송파구 올림픽로35길 104", landAddress: "서울특별시 송파구 신천동 7", base: 1_050_000_000 },
  { aptCode: "M0002", name: "장미2차", roadAddress: "서울특별시 송파구 올림픽로35길 124", landAddress: "서울특별시 송파구 신천동 7", base: 1_120_000_000 },
  { aptCode: "M0003", name: "장미3차", roadAddress: "서울특별시 송파구 올림픽로35길 137", landAddress: "서울특별시 송파구 신천동 11", base: 1_210_000_000 },
];

const growth = { 2021: 1.0, 2022: 1.17, 2023: 0.86, 2024: 0.88, 2025: 0.95, 2026: 1.08, 2027: 1.15, 2028: 1.2 };

function setLatestYear(year) {
  state.latestYear = year;
}

async function searchComplexes(name) {
  return complexes
    .filter((c) => c.name.includes(name) || name.includes("장미"))
    .map(({ base, ...c }) => ({ ...c, noticeDate: `${state.latestYear}0429`, pnu: "" }));
}

async function listDongs(aptCode) {
  if (!complexes.some((c) => c.aptCode === aptCode)) return [];
  return [1, 2, 3].map((i) => ({ code: `${aptCode}-D${i}`, name: `${aptCode.at(-1)}${i}동` }));
}

async function listHos(aptCode, noticeDate, dongCode) {
  if (!dongCode) return [];
  const hos = [];
  for (let floor = 1; floor <= 3; floor++) {
    for (let line = 1; line <= 2; line++) hos.push({ code: `${dongCode}-${floor}0${line}`, name: `${floor}0${line}호` });
  }
  return hos;
}

async function priceHistory(aptCode, noticeDate, dongCode, hoCode) {
  const complex = complexes.find((c) => c.aptCode === aptCode);
  if (!complex || !hoCode) return [];
  const floor = Number(hoCode.slice(-3, -2)) || 1;
  const rows = [];
  for (let year = state.latestYear; year >= 2021; year--) {
    rows.push({
      year,
      baseDate: `${year}-01-01`,
      noticeDate: `${year}-04-29`,
      priceWon: Math.round((complex.base * (growth[year] || 1.2) * (1 + floor * 0.01)) / 100000) * 100000,
      areaSqm: 82.45,
    });
  }
  return rows;
}

module.exports = { searchComplexes, listDongs, listHos, priceHistory, clearCache() {}, setLatestYear, state };
