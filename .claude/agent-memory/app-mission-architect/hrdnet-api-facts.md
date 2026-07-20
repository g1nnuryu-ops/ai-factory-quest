---
name: hrdnet-api-facts
description: HRD-Net API는 훈련생 개인정보(이름·생년월일·출결·수료상태)를 실제로 반환함 — "PII 없음"이라는 기존 메모는 틀렸음(라이브 검증)
metadata:
  type: reference
---

`RAPA/.env` 의 HRD-Net authKey 는 **RAPA 기관 키**라서 기관전용 엔드포인트가 열린다. 2026-07-13 라이브 호출로 직접 검증했다.

| 엔드포인트 | 용도 | 반환 |
|---|---|---|
| `HRDPOA60_1.jsp` | 훈련과정 목록(공개검색) | JSON(이중 래핑) |
| `HRDPOA60_2.jsp` | 과정 상세 | 일수/시간/사업명/담당자 |
| `HRDPOA60_4.jsp` | **훈련생 명단(기관전용)** | **XML** |

base: `https://hrd.work24.go.kr/jsp/HRDP/HRDPO00/HRDPOA60/`
`_4` 파라미터: `authKey`, `returnType=XML`, `outType=2`, `srchTrprId`, `srchTrprDegr`, `srchTorgId=default`

**`_4` 응답 필드** (`<trneList><trne_list>` 반복):
`trneeCstmrNm`(이름) · `lifyeaMd`(생년월일) · `trneeSttusNm`(**상태: 훈련중 / 80%이상수료 / 수료후취업 / 중도탈락**) · `atendCnt`(출석) · `absentCnt`(결석) · `vcatnCnt` · `oflhdCnt` · `traingDeCnt` · `trneeCstmrId` · `tracseId` · `tracseTme`

실측: 카카오테크 부트캠프 3기 40명, WINS Cloud Security 1기 20명, DI&DIT 2기 18명 정상 조회.

**`_2` 응답 필드** (`inst_base_info` / `inst_detail_info`) — 증서 양식 채우기에 쓸 만한 것:
`ncsNm`(**훈련직종** — LIG→`임베디드SW엔지니어링`, 카카오테크→`SW아키텍처`, WINS→`정보보호관리·운영`) · `trprDegr`(**기수**) · `trtm`(**훈련시간**, 1000) · `trDcnt`(훈련일수) · `trprChap`/`trprChapTel`/`trprChapEmail`(담당자) · `trprTargetNm`(K-디지털트레이닝) · `inoNm`(한국전파진흥협회) · `govBusiNm`(사업명)

**중요:** `ncsNm` 은 실제 수료증 양식의 "훈련직종" 값과 **정확히 일치**한다(LIG 3기로 대조 확인). 훈련직종은 수동 입력이 아니라 **자동 채움 가능**하다. 반면 **선도기업 정식 법인명은 API에 없다** — 과정명에는 `LIG D&A` 같은 약칭만 있고 `주식회사 LIG디펜스&에어로스페이스`는 없다.

**주의 — 기존에 틀린 메모가 돌아다님:** 메인 세션 auto-memory 의 `rapa-hrdnet-cert-app.md` 에 "훈련생 PII 없음"이라고 적혀 있으나 **사실과 다르다.** 공개 catalog API(`_1`)에만 없을 뿐, 기관전용 `_4` 에는 있다.

**How to apply:** 증서 발급 앱을 스코핑할 때 "명단은 엑셀 업로드해야 한다"고 단정하지 말 것. 명단 자동조회가 되고, 특히 `trneeSttusNm` 덕분에 **수료자/중도탈락자 자동 판별 → 증서 종류 자동 결정**까지 설계 가능하다. 반면 **이메일·연락처는 안 나온다** → 자동 메일 발송은 별도 데이터 소스 필요.

관련: [[rapa-cert-app-already-exists]]
