# Verify: Accounts and OTP · spec 0006 · updated 2026-09-29

_Steps derived from spec 0006 acceptance criteria and security review. `/check verify` runs these; `/test` locks the durable ones._

## UI / manual

- [x] Navigate to `/register` → see register form with email, display name, username inputs → AC-15
- [x] Fill register form and submit → OTP challenge code displays in server dev console and step transitions to 6 digit code entry → AC-1, AC-15
- [x] Enter code from console and submit → redirected to home, navbar displays greeting with voter display name and visible Log out button → AC-2, AC-15, AC-16
- [x] Click Log out button in navbar → voter session ends, cookie clears, navbar shows Sign in link → AC-10, AC-16
- [x] Navigate to `/login` → see passwordless email input with link to admin login toggle → AC-15
- [x] Enter registered email on `/login` and submit → receive new OTP code in server console → AC-1, AC-15
- [x] Submit invalid OTP code on `/login` → receive error message with remaining attempts count → AC-5, AC-15
- [x] Submit invalid OTP code 5 times → challenge locks, subsequent attempts display locked error → AC-5
- [x] Submit valid OTP code on `/login` → redirected to home with logged in state restored → AC-2, AC-15, AC-16
- [x] Open a session join link while logged in → display name is prefilled from user profile → AC-12, AC-17
- [x] Open a session join link in an incognito window without logging in → prompt displays suggesting sign in for a better experience → AC-17
- [x] Cast a vote as a signed in voter → vote registers under user id composite key without duplicate errors → AC-13

## Commands

- [x] `cd voting-server && npm test` → all 560 backend tests pass including accounts and OTP suite covering AC-1 through AC-14 plus security hardening → AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-7, AC-8, AC-9, AC-10, AC-11, AC-12, AC-13, AC-14
- [x] `cd voting-client && npm test` → all 337 client tests pass including voter auth slice spec → AC-8, AC-16
- [x] `cd voting-client && npm run lint` → client linter passes cleanly with zero errors → AC-15, AC-16, AC-17
- [x] `cd voting-client && npm run build` → client build succeeds cleanly without bundle errors → AC-15, AC-16, AC-17
- [x] Socket `join_session` ignores client supplied `userId` and assigns anonymous token unless authenticated via cookie → AC-12
- [x] Socket `VOTE` rejects forged `user:` voterToken with `FORBIDDEN_VOTER_TOKEN` when socket is unauthenticated or authenticated as another user → AC-12, AC-13
- [x] `POST /api/auth/otp/request` returns 502 `EMAIL_DELIVERY_FAILED` and deletes the challenge without burning cooldown when transport delivery fails → AC-5, AC-6
- [x] Cooldown check runs before username uniqueness check: resend with taken username returns 429 `COOLDOWN_ACTIVE`; failed username check on initial submit never burns cooldown → AC-4, AC-14
- [x] `validateVoterJwtSecret` fails fast in production when `VOTER_JWT_SECRET` is unset, and logs one time security warning in development → AC-7
- [x] OTP routes return generic 500 JSON upon database failure without process crash → AC-5, AC-6
- [x] Fallback generated usernames retry upon duplicate key collision, ensuring unique username assignment → AC-1
- [x] Username lookup escapes special regular expression characters, preventing injection seams in challenge creation and profile updates → AC-9, AC-14
- [x] Cooldown countdown ticks in client UI, disabling submit buttons and displaying remaining seconds until expiry → AC-4, AC-15
- [x] REST join and socket join handlers return `displayNameSource` as `anonymous`, `profile`, or `custom`, and client reconciles its input → AC-12, AC-17

## Acceptance-criteria coverage

- AC-1 (OTP generation and delivery): covered by UI register step, UI login step, and backend test suite
- AC-2 (OTP verification and cookie issuance): covered by UI verify step and backend test suite
- AC-3 (Single use codes): covered by backend test suite
- AC-4 (Resend cooldown of 60 seconds): covered by backend test suite
- AC-5 (Five attempt lockout): covered by UI invalid OTP step and backend test suite
- AC-6 (Generic response hiding email existence and delivery failure handling): covered by backend test suite
- AC-7 (Cookie attributes httpOnly and SameSite Lax with 7 day TTL): covered by backend test suite
- AC-8 (GET /api/auth/voter/me returns user profile): covered by UI login step and backend test suite
- AC-9 (POST /api/auth/profile updates profile): covered by backend test suite
- AC-10 (POST /api/auth/logout clears cookie): covered by UI logout step and backend test suite
- AC-11 (CORS credentials true for client origin): covered by backend test suite
- AC-12 (Session join integration for signed in voter and socket identity hardening): covered by UI join prefill step and backend test suite
- AC-13 (Authoritative vote deduplication under user id and vote token forgery rejection): covered by UI vote step and backend test suite
- AC-14 (Database TTL index on expired challenges): covered by backend test suite
- AC-15 (Passwordless register and login client pages): covered by UI register and login steps
- AC-16 (Navbar displays signed in voter name and logout button): covered by UI navbar step and client test suite
- AC-17 (Session join prompt for anonymous voters): covered by UI join prompt step
