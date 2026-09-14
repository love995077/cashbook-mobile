# Cashbook — mobile app

Expo (SDK 57) + Expo Router client for the Cashbook API.

**Phase 9: connected to the FastAPI backend, with voice entry, PDF statements,
offline support, and EAS build configuration.** All data comes from the API; the
JWT is stored with expo-secure-store (localStorage on web).

## Run

Start the backend so it accepts connections from your phone — the default
`127.0.0.1` bind is only reachable from this machine:

```bash
# from the repo root
.venv/Scripts/python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Then the app:

```bash
cd mobile
npm install
npx expo start          # then press i / a, or scan the QR code
npx expo start --web    # browser
```

### Where the app looks for the API

`src/api/client.ts` resolves the base URL in this order:

1. `EXPO_PUBLIC_API_URL` — set it in `mobile/.env` to override everything.
2. The host serving the Metro bundle. On a physical device that is already this
   machine's LAN IP, so the app follows you between networks without an edit.
3. `http://192.168.29.10:8000` — this machine's LAN IP at the time of writing.
   It is DHCP-assigned, so it will eventually go stale; the login screen prints
   the address in use to make that obvious.

The web build uses `http://localhost:8000` instead, since the browser runs on
the same machine.

## Layout

```
mobile/
  app/                            Expo Router — every file here is a route
    _layout.tsx                   Providers + root Stack; holds the splash
    index.tsx                     Entry: redirects by session and role
    (auth)/
      _layout.tsx                 Bounces signed-in users to their dashboard
      login.tsx
      register.tsx
    (worker)/
      _layout.tsx                 Worker-only guard
      dashboard.tsx               Balance card + mixed history
    (contractor)/
      _layout.tsx                 Contractor-only guard; hosts the modals
      dashboard/
        _layout.tsx               Bottom tabs (Home/Workers/Analytics/Settings)
        index.tsx                 Home — cash in, paid out, balance, recent, FAB
        workers.tsx               Workers tab — crew, balances, add a worker
        analytics.tsx             Analytics tab — bar chart, day/week/month
        settings.tsx              Settings tab — profile, biometrics, sign out
        attendance.tsx            Hidden from the bar; reached from Home
      worker/[id].tsx             One worker: balance, history, statement
      reports.tsx                 Generate and share PDF / CSV reports
      new-entry.tsx               Modal: give advance / mark attendance
      new-expense.tsx             Modal: log an expense or a site advance
      categories.tsx              Modal: add, rename, retire categories
  src/                            Everything that is not a route (@/* alias)
    api/client.ts                 Base URL, fetch wrapper, ApiError
    api/endpoints.ts              One function per route + wire->domain mapping
    api/upload.ts                 Builds multipart file parts (RN streams a uri, web needs a Blob)
    auth/auth-context.tsx         Session; login/register/restore
    auth/app-lock.tsx             Face ID / fingerprint gate over the app
    auth/token-storage.ts         expo-secure-store, localStorage on web
    data/types.ts                 Mirrors app/schemas/
    data/store.tsx                Loads screen data; owns loading/error state
    data/use-analytics.ts         The chart series for one period, cached
    lib/dialog.ts                 confirm()/notify() — Alert is a no-op on web
    lib/ledger.ts                 buildLedgerEntries
    lib/reports.ts                Authenticated download + share sheet
    lib/statement.ts              One worker's PDF, on top of lib/reports
    offline/cache.ts              Last-known dashboard, in AsyncStorage
    offline/queue.ts              Durable queue of writes made offline
    offline/flush.ts              Drain rules — read before changing
    offline/use-network-status.ts NetInfo wrapper
    lib/money.ts                  Currency, date and label formatting
    components/                   BalanceCard, LedgerRow, WorkerRow, ui-kit,
                                  BarChart, StatCard, CashEntryRow, Fab,
                                  AddWorkerModal, LockScreen,
                                  VoiceEntryButton, StatementButton
    constants/theme.ts            Colors (light/dark), spacing, radii
```

## Routing

Guards are declarative and live next to the routes they protect, rather than in
one effect at the root:

- `app/index.tsx` — signed out goes to `/(auth)/login`; signed in goes to the
  dashboard for their role.
- `(auth)/_layout.tsx` — redirects anyone who already has a session.
- `(worker)/_layout.tsx` and `(contractor)/_layout.tsx` — redirect the wrong
  role, and anyone signed out, back where they belong.

`app/_layout.tsx` renders nothing while the session is being restored, so the
login screen never flashes in front of a signed-in user.

## Adding a worker

The Workers tab opens `AddWorkerModal` from two places: the header action, and
the empty state, so a new account is not left looking at "No workers yet" with
nothing to press.

It is a React Native `Modal` rather than an expo-router modal route, unlike the
other forms here. Adding a worker is a detour from the list you are already
reading, and this keeps that list underneath instead of replacing it — and it
renders as a real overlay on the web build, where a router modal is just
another full page.

The form validates name, phone and PIN against the same rules as
`app/schemas/user.py`, so an obvious mistake never costs a round trip. Daily
wage is optional: the API takes a null `daily_wage` for a worker whose rate
changes job to job.

The write goes through `addWorker` in the store, which POSTs to
`/contractor/workers` with the session token — the server binds the worker to
the calling contractor, the client never sends a `contractor_id` — and then
refreshes the crew, so the new row appears without a reload. Errors keep the
modal open with the details intact; a phone number that already has an account
comes back as the API's own 409 message.

**Not queueable.** Unlike attendance and expenses, this one needs a connection:
a worker must have a server-assigned id before any entry can reference them, so
the modal says so and disables the button when offline.

## Biometric lock

Optional, off by default, toggled in Settings. `src/auth/app-lock.tsx` prompts
on launch and whenever the app returns to the foreground after more than 30
seconds away - a prompt on every task-switch would be unusable, since checking
a photo of an invoice and coming back should not cost a scan.

It is a **local gate**, not encryption. The session token is what authenticates
against the API and lives in SecureStore either way, so the lock stops someone
picking up an unlocked phone and reading the ledger, and nothing more. Tying
the token to a biometric was rejected deliberately: it would lock a contractor
out of their own books the day a fingerprint sensor stops reading a wet thumb.

Turning it **on** requires passing a scan first, so nobody discovers on the next
launch that their sensor does not work. Turning it **off** does not - the app is
already unlocked, which is the same proof. The lock screen offers sign-out as
the way past a sensor that will not cooperate at all, and the lock never covers
the login screen.

If enrolment is removed after the preference was set, the preference reads as
off rather than locking the contractor out of a device that can no longer
satisfy the prompt.

## Demo accounts

Seeded in the database during Phase 5 testing (password `password123`):

| Role | Phone |
| --- | --- |
| Contractor | 9990001111 |
| Worker | 8880002222 |

## Network behaviour

- **Loading** — a first load shows a full-screen spinner; pull-to-refresh shows
  the platform refresh control over the data already on screen.
- **Errors** — a failed first load shows the message with a Try again button. A
  failed refresh keeps the stale data and shows the error inline, so a dropped
  connection never blanks a screen the user was reading.
- **Network failures** name the host that was tried, since a stale LAN IP is the
  usual cause.
- **401** clears the stored token, which drops the session and lets the route
  guards return the user to login.
- **Form errors** stay on the form with the entry intact — a duplicate
  attendance date comes back 409, and FastAPI's 422 field errors are flattened
  to `field: message`.

## Building for devices

```bash
eas init                                    # once, links this app to your Expo account
eas build -p android --profile preview      # installable APK
eas build -p android --profile production   # Play Store .aab
```

`eas.json` sets `EXPO_PUBLIC_API_URL` per profile and **the placeholders must
be replaced** — a release build has no Metro host to infer the API address
from, so an unset value ships an app pointing at a private LAN IP. Preview and
production must use `https`: Android blocks cleartext HTTP in release builds.

Full command reference in [../DEPLOYMENT.md](../DEPLOYMENT.md).

## Offline behaviour

- **Open** — the dashboard paints from AsyncStorage first, then a network
  refresh replaces it. A cold start with no connection still shows the ledger
  as it was, with a banner saying how old it is.
- **Write while offline** — attendance marks, advances and general expenses go
  to a durable queue and resolve as if saved. The `SyncBanner` reports what is
  waiting. Categories are the exception: an expense has to reference a
  server-assigned category id, so creating one needs a connection.
- **Analytics offline** — `useAnalytics` keeps its own AsyncStorage cache per
  user and per period, so switching the day/week/month filter with no signal
  still shows the last chart you saw for that filter.
- **Reconnect** — NetInfo triggers a drain, then a refresh.
- **The balance is never faked.** Queued entries do not adjust the number on
  screen; it stays the one the server last confirmed, and the banner explains
  what has not reached it. Queued *attendance* does show on the attendance tab,
  because a row still reading "not marked" invites a duplicate.
- **Sign-out clears both** the cache and the queue, so one user's ledger is
  never visible to the next.

`useNetworkStatus` prefers `isInternetReachable` over `isConnected`: a captive
portal at a site office looks like a working connection to the latter.

### Replay safety — the one thing to know

Retrying a write that already succeeded is the hazard in any offline queue, and
the two kinds here are not equally exposed:

- **Attendance is safe.** The server's unique index on `(worker_id, date)`
  turns a replay into a 409, which the flusher treats as "already recorded".
  The database is the dedupe.
- **Cash entries are safe, and are the model for the fix.**
  `POST /contractor/cash-entries` stores the queue's `clientRef` in a nullable
  `UNIQUE` column and returns the existing row when it repeats, so a replay is
  a no-op however the first attempt ended.
- **Transactions are not.** There is no natural key — two identical advances on
  one day are legitimate — so a replay would charge the worker twice.

The flusher only retries when the request demonstrably failed before reaching
the server. That covers airplane mode, but *not* the ambiguous case: a request
that arrived, committed, and whose response was lost to a timeout looks
identical to one that never landed. A money entry that fails that way twice is
therefore surfaced to the contractor rather than retried.

**The remaining fix is on the server**: do for `transactions` what
`cash_entries.client_ref` already does — accept the `clientRef` every queue item
carries as an idempotency key, store it in a nullable `UNIQUE` column, and
return the existing row instead of inserting when it repeats. Then flip
`TRANSACTION_RETRY_IS_SAFE` in `src/offline/queue.ts`.

## Known cost: the contractor list is N+1

`GET /contractor/workers` returns `UserRead` with no balance, so the Workers tab
fetches the list and then one ledger per worker (in parallel). That is fine for
a crew of a dozen and wasteful beyond it. The fix belongs on the backend —
include each worker's `BalanceSummary` in the list response — after which
`loadContractor` in `src/data/store.tsx` collapses to a single request.
