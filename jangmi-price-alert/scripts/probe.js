// 임시 진단: realtyprice.kr 단지 검색 파라미터 조합 시험
const BASE = "https://www.realtyprice.kr/notice";
const base = { search_gbn: "1", search_detail_gbn: "3", notice_date: "", notice_date_nm: "", sido: "", sido_nm: "", sigungu: "", sigungu_nm: "", road_reg: "", road_initial: "", road_initial_nm: "", road_code: "", road_code_nm: "", dongri: "", dongri_nm: "", reg: "", eub: "", search_name: "장미", search_bun: "" };
const variants = {
  "장미1차": { search_name: "장미1차" },
  "장미1": { search_name: "장미1" },
  "장미아파트": { search_name: "장미아파트" },
  "reg=11710": { reg: "11710" },
  "reg=11710,eub=10200": { reg: "11710", eub: "10200" },
  "sido=11,sigungu=11710": { sido: "11", sigungu: "11710" },
  "sido=11,sigungu=710": { sido: "11", sigungu: "710" },
  "sido=11000,sigungu=11710": { sido: "11000", sigungu: "11710" },
  "pageIndex=5": { pageIndex: "5" },
  "page=5": { page: "5" },
  "currentPage=5": { currentPage: "5" },
};
(async () => {
  for (const [label, v] of Object.entries(variants)) {
    try {
      const res = await fetch(`${BASE}/m/town/getApt.do`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", "X-Requested-With": "XMLHttpRequest", Referer: `${BASE}/m/town/search.do`, "User-Agent": "Mozilla/5.0" }, body: new URLSearchParams({ ...base, ...v }).toString() });
      const data = await res.json();
      const m = data.model || data.modelMap || {};
      const list = m.list || [];
      const songpa = list.filter((r) => String(r.FULL_BJD_NAME || "").includes("송파"));
      console.log(`== ${label}: HTTP ${res.status} keys=${Object.keys(m).join(",")} total=${m.totalCnt ?? "-"} n=${list.length} first=${list[0]?.MOD_APT_NAME}/${list[0]?.FULL_BJD_NAME} RN=${list[0]?.RN}..${list.at(-1)?.RN}`);
      for (const r of songpa) console.log(`   송파: ${r.MOD_APT_NAME} | ${r.FULL_BJD_NAME} | ${r.FULL_ROAD_NAME} | APT_CODE=${r.APT_CODE} NOTICE=${r.NOTICE_DATE}`);
    } catch (e) { console.log(`== ${label}: ERROR ${e.message}`); }
  }
})();
