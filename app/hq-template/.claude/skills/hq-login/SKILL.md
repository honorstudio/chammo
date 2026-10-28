---
name: hq-login
description: 세션이 "Login expired"·"Not logged in"·"Please run /login"·"Consumer Terms"(약관 동의) 로 멈췄거나 Claude 계정 로그인을 물을 때 연다. A session stopped on "Login expired" / "Not logged in" / "Consumer Terms", Claude sign-in questions.
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
- 앱은 지금 로그인을 만료 1시간 전부터 미리 갱신한다. 그래도 못 받으면 세션이 멈추기 전에 "Claude 로그인이 곧 끝나요" 카드가 먼저 뜬다 — 같은 카드, 같은 한 줄로 안내한다.

## 약관 동의가 필요할 때

"API Error: 400 We've updated our Consumer Terms … accept them in claude.ai …" 는 로그인이 아니라 그 계정이 claude.ai 새 약관에 아직 동의를 안 한 것이다.
앱이 계정마다 카드를 하나 띄운다(결정 대기함·참모 채팅 끝·폰): "<이메일> 계정이 Claude 새 약관 동의가 필요해요" + [claude.ai 열기]·[다시 시도].
- 사용자에게 한 번, 한 줄로: "카드에서 claude.ai 를 열어 <이메일>로 약관 동의하고 [다시 시도] 눌러 줘". 다른 계정으로 로그인돼 있으면 그 계정으로 바꿔 동의해야 한다.
- 동의는 사람이 직접 누른다 — 네가 브라우저로 대신 동의하지 않는다. `/login` 으로는 안 풀린다.
- 계정이 여럿이면 앱이 그 계정을 동의할 때까지 건너뛰고 다른 계정으로 돌린다(멈춘 세션은 앱이 이어서). [다시 시도] 를 누르면 그 계정을 다시 쓴다 — 아직 동의 전이면 카드가 다시 뜬다.

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
- The app renews the current sign-in from an hour before it expires. If that keeps failing, a "Claude sign-in ends soon" card
  shows before any session stops — same card, same one-line note.

## When the terms need accepting

"API Error: 400 We've updated our Consumer Terms … accept them in claude.ai …" is not a sign-in problem: that account hasn't accepted
claude.ai's new terms yet. The app shows one card per account (Decisions, the end of the assistant chat, the phone):
"<email> needs to accept Claude's new terms" with Open claude.ai and Retry.
- Tell the user once, in one line: "Open claude.ai from the card, accept the terms as <email>, then press Retry". If the browser is signed in
  to another account, they have to switch to that one to accept.
- A person accepts the terms themselves — never accept them on their behalf in a browser. `/login` doesn't fix it.
- With several accounts the app skips that account until it's accepted and moves to another (the app tells stopped sessions to continue).
  Retry puts the account back in use — if it still isn't accepted, the card comes back.
