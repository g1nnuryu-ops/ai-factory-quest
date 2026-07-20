/* ------------------------------------------------------------------
 * RAPA 증명서 발급 시스템 — 로컬 설정 예시
 * ------------------------------------------------------------------
 * 사용법
 *   1) 이 파일을 같은 폴더에 config.js 로 복사한다
 *   2) WEBAPP_URL 에 Apps Script 웹앱 URL(.../exec)을 넣는다
 *   3) SEAL_SRC 에 협회 직인 이미지를 data URL 로 넣는다 (아래 참고)
 *
 * config.js 는 .gitignore 에 있으므로 커밋되지 않는다.
 * config.js 가 없으면 index.html 은 MOCK(데모) 모드로 동작한다.
 *
 * ⚠️ 이 웹앱 URL은 '액세스: 모든 사용자'로 배포되어 있다.
 *    URL을 아는 사람은 인증 없이 훈련생 명단(이름·생년월일)을 조회하고
 *    발급대장에 행을 쓸 수 있다. 비밀번호와 동일하게 취급할 것.
 *
 * ⚠️ 협회 직인은 공개 저장소에 올리지 않는다. 공식 문서를 위조할 수 있는
 *    기관 자산이라, 이미지와 원본 파일 모두 로컬에만 둔다.
 *    SEAL_SRC 가 비면 index.html 은 CSS placeholder 직인으로 폴백한다.
 *
 *    직인 data URL 만들기 (PowerShell):
 *      $b = [Convert]::ToBase64String([IO.File]::ReadAllBytes("협회 직인.jpg"))
 *      "data:image/jpeg;base64,$b" | Set-Clipboard
 * ------------------------------------------------------------------ */
window.RAPA_CONFIG = {
  WEBAPP_URL: "", // 형식: https://script.google.com/macros/s/<배포ID>/exec

  SEAL_SRC: ""    // 형식: data:image/jpeg;base64,<...>
};
