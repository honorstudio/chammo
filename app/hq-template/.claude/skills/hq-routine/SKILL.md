---
name: hq-routine
description: 매일·매주·N시간마다 하는 일이나 정한 날짜·시각에 한 번 하는 일을 예약할 때(scripts/routine), 예약을 멈추기·지우기·결과 볼 때 연다. Scheduling recurring or one-off jobs with scripts/routine, pausing, deleting, checking runs.
---

<!-- Chammo 가 HQ 를 켤 때마다 새로 쓴다 — 고치지 않는다. / Rewritten by Chammo on every start — do not edit. -->

# 한국어

## 예약 — 반복하는 일, 정한 때 한 번 하는 일

사용자가 **주기적으로**("매일 아침 블로그 글 올려줘", "2시간마다 주문 확인해줘") 또는 **정한 때 한 번**("다음 주 화요일 9시에 광고 다시 켜 줘")
하길 원하면 프로젝트 세션 대신 예약을 만든다(명령·파일 이름은 옛 이름 routine 그대로):
`scripts/routine new <이름> "<일정>" "<매번 할 일>" [--in <프로젝트 폴더>]`.
반복: `매일 09:00` · `평일 09:00` · `매주 월 09:00` · `30분마다` · `2시간마다` (영어도: `daily 09:00`, `every 2h`).
한 번: `10/06 09:00` 또는 `2026-10-06 09:00`, 여러 번은 쉼표로 `10/06 09:00, 10/13 09:00`. 연도를 빼면 다가오는 날짜,
이미 지난 날짜는 빠지고 다 지났으면 거절된다. 마지막 날짜가 돌고 보고하면 스스로 꺼지고 '끝남'으로 남는다 — 직접 지우지 않는다(기록이 남게).
한 번짜리를 '매주'로 걸고 지우는 꼼수는 쓰지 않는다.
지침서가 `<데이터>/routines/<이름>/ROUTINE.md` 에 생긴다 — **열어서 구체적으로 채운다**(단계·어디 로그인하는지·무엇이 되면
끝인지·무엇을 보고할지). 앱이 꺼져 있어도 macOS 가 정해진 때 깨우고, 매번 `routine-<이름>` 세션이 지침서대로 한 번 일한 뒤
결과를 남긴다. 만들면 바로 `scripts/routine run <이름>` 으로 시험하고 `scripts/routine list` 로 결과를 본다 — 단 운영에 손대는 예약(광고·결제·실사용자 발송)은
시험 실행하지 않고 `scripts/routine list` 로 걸린 것만 본다. 일시정지·재개·삭제도 같은 스크립트.
앱 사이드바 "예약" 칸에 보인다 — 첫째 줄 이름·상태(도는 중 N분·끝 hh:mm·실패…), 둘째 줄 언제(다음 실행, 한 번짜리는 날짜·남은 횟수),
끝난 한 번짜리는 접힌다. 누르면 지침서·지금 도는 화면·실행 기록.

# English

## Scheduled jobs — recurring or one-off

When the user wants something done **on a schedule** ("post to the blog every morning", "check the shop orders every
2 hours") or **at a set time** ("turn the ads back on next Tuesday 9am"), make a scheduled job instead of a project session
(the command and files keep the old name, routine):
`scripts/routine new <name> "<schedule>" "<what to do each run>" [--in <project folder>]`.
Recurring: `daily 09:00`, `weekdays 09:00`, `weekly mon 09:00`, `every 30m`, `every 2h` (Korean works too: `매일 09:00`).
One-off: `10/06 09:00` or `2026-10-06 09:00`; several with commas: `10/06 09:00, 10/13 09:00`. A date without a year is
the next one; dates already past are dropped (all past = refused). After the last date runs and reports, the job turns
itself off and shows as "Finished" — don't remove it yourself, the history stays. Don't fake one-offs with a weekly schedule.
It writes the instructions to `<data>/routines/<name>/ROUTINE.md` — **open it and make it concrete** (steps, where
to log in, what "done" means, what to report). macOS wakes it on schedule even when the app is closed; each run
starts a session `routine-<name>` that follows ROUTINE.md once and reports back. Try it right away with
`scripts/routine run <name>` and check the result with `scripts/routine list` — except jobs that touch production
(ads, payments, sends to real users): don't test-run those, check `scripts/routine list` instead. Pause/resume/remove the same way.
They show up in the app sidebar under "Scheduled": name and state on the first line (running N min, done hh:mm, failed…),
when on the second (next run, or the date and how many are left); finished one-offs fold away.
