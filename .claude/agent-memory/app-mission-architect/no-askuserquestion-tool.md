---
name: no-askuserquestion-tool
description: AskUserQuestion 도구가 이 환경에 없음 — 서브에이전트로 실행될 때 질문은 최종 메시지로 반환하고 부모의 SendMessage로 답을 받아야 함
metadata:
  type: project
---

이 프로젝트의 Claude Code 환경에는 **AskUserQuestion 도구가 존재하지 않는다.** (`ToolSearch "select:AskUserQuestion"` → No matching deferred tools found, 키워드 검색도 무매치. 2026-07-13 확인)

**Why:** app-mission-architect 의 에이전트 정의는 "AskUserQuestion 으로 직접 물어보라"고 지시하지만, 이 하네스에는 해당 도구가 배포되어 있지 않다. 도구를 찾느라 시간을 쓰거나, 도구가 없다는 이유로 혼자 추측해서 MISSION.md 를 써버리는 두 가지 실패가 모두 가능하다.

**How to apply:**
- 서브에이전트로 실행 중이라면 발견 질문(discovery question)을 **최종 메시지 본문**에 담아 반환한다. 부모 에이전트가 사용자에게 그대로 전달하고, `SendMessage` 로 답변을 다시 넣어주면 컨텍스트를 유지한 채 대화를 이어갈 수 있다.
- 최종 메시지에 "이 질문을 사용자에게 그대로 전달하고, 답변을 SendMessage 로 회신해달라"고 부모에게 명시적으로 요청할 것.
- 질문은 **번호+선택지(A/B/C)** 형태로 만들어 사용자가 "1-A, 2-B" 처럼 짧게 답할 수 있게 한다. 라운드트립 1회가 비싸므로 라운드당 핵심 질문 2개로 압축한다.
- 도구가 없다고 해서 임의로 스코프를 정하지 말 것. 모호한 요청("나만의 음악을 만들고 싶어")에서 추측한 MISSION 은 이 에이전트의 존재 이유를 무너뜨린다.

관련: [[user-quest-learner]]
