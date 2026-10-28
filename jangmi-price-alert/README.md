# 잠실 장미아파트 공시가격 알림

서울 송파구 신천동 **장미1·2·3차** 아파트의 공동주택 공시가격을 조회하고, 매년 새 공시가격이 발표되면 자동으로 알림을 보내는 웹사이트입니다.

## 기능

- **세대별 공시가격 조회**: 단지 → 동 → 호를 고르면 연도별 공시가격, 전년 대비 변동률, 그래프를 보여줍니다.
- **자동 알림 설정**
  - 알림 방법: 이메일(SMTP), 휴대폰 푸시([ntfy](https://ntfy.sh) 앱, 가입 불필요), 텔레그램 봇, 웹훅(디스코드·슬랙 등)
  - 새 공시가격이 발표되면 알림 (전년 대비 변동률이 N% 이상일 때만 받도록 설정 가능)
  - 공시 일정 미리 알림: 3월 중순 공시가격(안) 열람, 4월 말 결정·공시 (날짜는 `REMINDERS`로 변경)
- **알림 관리**: 등록하면 관리 링크가 발급되어 알림 방법·조건 변경, 테스트 발송, 해지를 할 수 있습니다(회원가입 없음).
- 서버가 `CHECK_INTERVAL_HOURS`(기본 6시간)마다 공시가격을 확인합니다. 같은 세대 구독자가 여럿이어도 한 번만 조회합니다.

데이터는 [부동산공시가격알리미](https://www.realtyprice.kr)의 공동주택 공시가격 열람 화면이 쓰는 엔드포인트(`/notice/m/town/getApt.do`, `detail.do`, `getHo.do`, `getPriceYear.do`)에서 가져옵니다. 공식 OpenAPI가 아니어서 사이트 구조가 바뀌면 `src/realtyprice.js`를 고쳐야 할 수 있습니다.

## 실행

Node.js 18.17 이상이 필요합니다.

```bash
cd jangmi-price-alert
npm install
cp .env.example .env     # 필요한 항목 채우기
npm start                # http://localhost:3000
```

실제 사이트에 접속하지 않고 화면만 보려면 `npm run dev`로 실행하세요(가짜 데이터 사용). 테스트는 `npm test`로 돌립니다.

Docker로 실행할 수도 있습니다.

```bash
docker build -t jangmi-price-alert .
docker run -d -p 3000:3000 --env-file .env -v $(pwd)/data:/app/data jangmi-price-alert
```

## 설정 (.env)

| 항목 | 설명 |
|---|---|
| `PUBLIC_URL` | 외부 접속 주소. 알림 속 관리 링크에 쓰입니다. |
| `CHECK_INTERVAL_HOURS` | 공시가격 확인 주기(시간), 기본 6 |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | 이메일 발송. 비우면 이메일 선택지가 꺼집니다. 예: 네이버 `smtp.naver.com:465`, Gmail `smtp.gmail.com:465`(앱 비밀번호) |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_NAME` | [@BotFather](https://t.me/BotFather)로 만든 봇. 비우면 텔레그램 선택지가 꺼집니다. |
| `NTFY_SERVER` | ntfy 서버, 기본 `https://ntfy.sh` |
| `ADMIN_TOKEN` | `POST /api/admin/check`(Authorization: Bearer 토큰)로 즉시 확인할 때 사용 |
| `REMINDERS` | 일정 알림. `MM-DD\|제목\|본문;MM-DD\|제목\|본문` |
| `DEFAULT_SEARCH`, `DEFAULT_REGION` | 기본 검색어(`장미`)와 지역 필터(`송파구`) |

구독 정보는 `data/store.json`에 저장됩니다.

## 배포 참고

- 서버가 계속 켜져 있어야 주기 확인이 동작합니다(VPS, 집 PC, Render·Fly.io 같은 상시 실행 서비스).
- realtyprice.kr은 해외 IP 접속이 막히거나 느릴 수 있어 **국내 서버**(예: 국내 클라우드, 집 PC)에서 운영하는 것을 권합니다.
- 공시가격은 세금 산정 기준인 정부 공시가격이며 시세·실거래가가 아닙니다. 이 사이트는 정부 기관과 무관합니다.

## 구조

```
src/server.js       HTTP 서버와 API
src/realtyprice.js  공시가격 사이트 조회
src/checker.js      주기 확인, 새 공시 감지, 일정 알림
src/notifier.js     이메일·텔레그램·ntfy·웹훅 발송
src/store.js        구독 저장(JSON 파일)
src/mock.js         개발용 가짜 데이터
public/             웹 화면
```

realtyprice.kr 요청 형식은 MIT 라이선스 [k-skill/housing-official-price](https://github.com/NomaDamas/k-skill)를 참고했습니다.
