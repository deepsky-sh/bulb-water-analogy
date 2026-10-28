// 장미1·2·3차 단지 찾기와 동·호 이름 비교.
// 공시가격 사이트에서 "장미" 검색은 전국 결과가 앞에 나와 송파구 단지가 잘리므로 차수별로 따로 찾는다.
// 사이트 표기: 장미아파트(장미1), 장미아파트(장미2), 장미3차맨션(장미3) / 동은 "22" 또는 "1동", 호는 "101".

const QUERIES = ["장미1", "장미2", "장미3"];
const REGION = "송파구";

function label(name) {
  const m = String(name).match(/\(\s*장미\s*(\d)\s*\)/) || String(name).match(/^장미(\d)차/);
  return m ? `장미${m[1]}차` : name;
}

async function findComplexes(api) {
  const found = new Map();
  for (const q of QUERIES) {
    for (const c of await api.searchComplexes(q)) {
      if (!`${c.roadAddress} ${c.landAddress}`.includes(REGION)) continue;
      const name = label(c.name);
      if (!/^장미\d차$/.test(name) || found.has(c.aptCode)) continue;
      found.set(c.aptCode, { ...c, officialName: c.name, name });
    }
  }
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// "22", "22동", " 22 동" → "22"
function bare(name) {
  return String(name || "").replace(/\s+/g, "").replace(/[동호]$/, "");
}

function sameName(a, b) {
  return bare(a) === bare(b);
}

function display(name, suffix) {
  const v = String(name || "").replace(/\s+/g, "");
  return /^\d+$/.test(v) ? `${v}${suffix}` : v;
}

module.exports = { findComplexes, sameName, display, label };
