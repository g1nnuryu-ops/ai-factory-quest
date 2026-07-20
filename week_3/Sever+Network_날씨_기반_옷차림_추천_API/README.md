# 👕 날씨 기반 옷차림 추천 API

현재 위치의 날씨를 OpenWeatherMap에서 받아와, 한국 기온별 기준에 따라 오늘의 옷차림을 추천하는 웹앱입니다.
Express 백엔드 + 바닐라 JS 프론트(빌드 단계 없음)로 구성되어 있습니다.

## 주요 기능
- **위치 자동 감지**
  - 1순위: 브라우저 `navigator.geolocation`으로 위/경도를 얻어 `GET /recommend?lat=&lon=` 호출
  - 2순위(폴백): 좌표가 없거나 위치 권한이 거부되면, 서버가 요청 IP로 위치를 추정(키 불필요, `ip-api.com`)
  - 최후 폴백: 로컬호스트/사설 IP라 추정이 불가하면 서울 좌표로 대체(대략적 위치임을 표시)
- **현재 기온·날씨 조회**: OpenWeatherMap에서 섭씨 기온/체감온도/한국어 날씨 설명/아이콘을 받아옵니다.
- **한국 기온별 옷차림 추천**: 아래 표 기준으로 추천 의상을 보여주고, 비/눈/강풍 등에 따른 짧은 팁을 덧붙입니다.

## 실행 방법
> Node.js 18 이상이 필요합니다(서버가 내장 전역 `fetch`를 사용).

```bash
npm install   # express 설치
npm start     # = node server.js
```

브라우저에서 **http://localhost:3000** 을 엽니다.

## 환경 변수(.env)
이 폴더의 `.env`에 OpenWeatherMap API 키가 들어 있어야 합니다. 키 이름은 다음과 같습니다.

```
OpenWeatherMap_api_key=발급받은_키
```

> 서버는 `OpenWeatherMap_api_key`를 우선 읽고, `OPENWEATHERMAP_API_KEY` / `OPENWEATHER_API_KEY` 같은 흔한 변형도 함께 인식합니다.
> API 키는 **서버에서만** 사용되며 브라우저로 노출되지 않습니다. `.env`는 정적으로 서빙되지 않고 `.gitignore`에 포함되어 있습니다.

## API: `GET /recommend`
- 쿼리(선택): `lat`, `lon` — 있으면 해당 좌표로 조회(GPS), 없으면 서버가 IP로 위치를 추정합니다.
- 성공 응답 예시:

```json
{
  "success": true,
  "location": { "city": "서울특별시", "lat": 37.57, "lon": 126.98, "source": "gps" },
  "weather": { "temp": 14.2, "feelsLike": 13.0, "description": "구름 조금", "icon": "02d" },
  "recommendation": { "range": "12~16°C", "items": ["자켓", "가디건", "야상", "스타킹", "청바지", "면바지"], "tip": "" },
  "updatedAt": "2026-06-12T07:00:00.000Z"
}
```

- `location.source` 값: `"gps"`(브라우저 좌표) / `"ip"`(IP 추정) / `"default"`(기본 서울).
- 실패 시 적절한 HTTP 상태 코드와 함께 한국어 `message`를 반환합니다.

## 한국 기온별 옷차림 기준
| 기온 | 추천 옷차림 |
| --- | --- |
| 28°C 이상 | 민소매, 반팔, 반바지, 원피스 |
| 23~27°C | 반팔, 얇은 셔츠, 반바지, 면바지 |
| 20~22°C | 얇은 가디건, 긴팔, 면바지, 청바지 |
| 17~19°C | 얇은 니트, 가디건, 맨투맨, 청바지 |
| 12~16°C | 자켓, 가디건, 야상, 스타킹, 청바지, 면바지 |
| 9~11°C | 트렌치코트, 야상, 점퍼, 스타킹, 청바지 |
| 5~8°C | 코트, 가죽자켓, 히트텍, 니트, 레깅스 |
| 4°C 이하 | 패딩, 두꺼운 코트, 목도리, 기모제품 |

## 파일 구성
- `server.js` — Express 서버. 정적 서빙 + `/recommend` API(위치 확정 → OpenWeatherMap 호출 → 추천).
- `index.html` — 프론트엔드(바닐라 JS 인라인). 위치 감지, 날씨/추천 표시, 새로고침 버튼.
- `package.json` — `npm start` 스크립트와 `express` 의존성.
- `.env` — OpenWeatherMap API 키(커밋 금지).
- `.gitignore` — `.env`, `node_modules/` 제외.

## 참고
- 발급한 지 얼마 안 된 OpenWeatherMap 키는 **활성화에 최대 수 시간**이 걸릴 수 있습니다. `/recommend`에서 인증 실패(401 계열) 메시지가 나오면 코드 문제가 아니라 키 활성화 대기일 가능성이 높습니다.
