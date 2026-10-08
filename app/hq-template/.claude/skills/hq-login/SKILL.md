---
name: hq-login
description: 세션이 "Login expired"·"Not logged in"·"Please run /login" 으로 멈췄거나 Claude 계정 로그인을 물을 때 연다. A session stopped on "Login expired" / "Not logged in", Claude sign-in questions.
---

<!-- Chammo 가 HQ 를 켤 때마다 새로 쓴다 — 고치지 않는다. / Rewritten by Chammo on every start — do not edit. -->

# 한국어

## Claude 로그인이 풀렸을 때

세션이 "Login expired · Please run /login" 이나 "Not logged in" 으로 멈췄으면 Claude 로그인이 풀린 것이다. 앱이 이미 맡는다:
그 세션은 '로그인 필요'로 보이고, 데스크톱 결정 대기함 맨 위와 폰 홈 맨 위에 [로그인] 카드가 하나 뜬다(폰은 맥 앞에 없어도 된다 —
로그인 페이지를 열고 보여 주는 코드를 붙여 넣는다).
- 사용자에게 한 번, 한 줄로: "Claude 로그인이 풀렸어 — 결정 대기함(또는 폰) 카드에서 로그인해 줘". 같은 말을 되풀이하지 않고,
  멈춘 세션에 네가 "이어서"를 보내지 않는다 — 로그인이 고쳐지기 전엔 똑같이 막힌다.
- `/login`·`claude auth login` 을 네가 돌리지 않는다(사람이 브라우저에서 로그인해야 한다). SSH 로 잰 `claude auth status` 로
  판단하지 않는다 — SSH 에선 키체인을 못 읽어 늘 false 다.
- 로그인하면 앱이 새 로그인을 보고 멈춘 세션마다 한 번 이어서를 보낸다. 그 뒤에도 멈춰 있는 세션만 들여다본다.
- 계정이 여럿이면 앱이 다음 계정으로 알아서 넘긴다. 설정 → 계정에서 '로그인 필요'로 보이는 계정은 거기서 다시 로그인해야 한다.

# English

## When Claude sign-in expires

A session that stops on "Login expired · Please run /login" or "Not logged in" has lost its Claude sign-in. The app
already handles it: the session shows "Sign-in needed", and one card sits at the top of Decisions on the desktop and on the
phone home with a Sign in button (the phone works away from the Mac: open the sign-in page, paste the code it shows).
- Tell the user once, in one line: "Claude sign-in expired — sign in from the card in Decisions (or on your phone)".
  Don't repeat it, and don't send "continue" to stopped sessions yourself — until the sign-in is fixed they fail the same way.
- Don't run `/login` or `claude auth login` yourself (a person has to sign in in a browser). Don't judge by
  `claude auth status` over SSH — there it can't read the keychain and always says false.
- After the sign-in the app sees the new login and tells each stopped session to continue, once. Check a session only if it
  is still stopped after that.
- With several accounts the app moves to the next account by itself. An account marked "Sign-in needed" in Settings →
  Accounts has to be signed in again there.
