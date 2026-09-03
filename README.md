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
      _layout.tsx                 Contractor-only guard; hosts the modal
      dashboard/
        _layout.tsx               Bottom tabs
        index.tsx                 Workers tab — crew + outstanding balances
        attendance.tsx            Attendance tab — mark the crew for today
        settings.tsx              Settings tab — profile, sign out
      worker/[id].tsx             One worker: balance, history, statement
      new-entry.tsx               Modal: give advance / mark attendance
  src/                            Everything that is not a route (@/* alias)
    api/client.ts                 Base URL, fetch wrapper, ApiError
    api/endpoints.ts              One function per route + wire->domain mapping
    auth/auth-context.tsx         Session; login/register/restore
    auth/token-storage.ts         expo-secure-store, localStorage on web
    data/types.ts                 Mirrors app/schemas/
    data/store.tsx                Loads screen data; owns loading/error state
    lib/ledger.ts                 buildLedgerEntries
    lib/statement.ts              Download the PDF, open the share sheet
    offline/cache.ts              Last-known dashboard, in AsyncStorage
    offline/queue.ts              Durable queue of writes made offline
    offline/flush.ts              Drain rules — read before changing
    offline/use-network-status.ts NetInfo wrapper
    lib/money.ts                  Currency, date and label formatting
    components/                   BalanceCard, LedgerRow, WorkerRow, ui-kit,
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
- **Write while offline** — attendance marks and advances go to a durable
  queue and resolve as if saved. The `SyncBanner` reports what is waiting.
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
- **Transactions are not.** There is no natural key — two identical advances on
  one day are legitimate — so a replay would charge the worker twice.

The flusher only retries when the request demonstrably failed before reaching
the server. That covers airplane mode, but *not* the ambiguous case: a request
that arrived, committed, and whose response was lost to a timeout looks
identical to one that never landed. A money entry that fails that way twice is
therefore surfaced to the contractor rather than retried.

**The real fix is on the server**: accept the `clientRef` already carried on
every queue item as an idempotency key, store it in a nullable `UNIQUE` column
on `transactions`, and return the existing row instead of inserting when it
repeats. Then flip `TRANSACTION_RETRY_IS_SAFE` in `src/offline/queue.ts`.

## Known cost: the contractor list is N+1

`GET /contractor/workers` returns `UserRead` with no balance, so the Workers tab
fetches the list and then one ledger per worker (in parallel). That is fine for
a crew of a dozen and wasteful beyond it. The fix belongs on the backend —
include each worker's `BalanceSummary` in the list response — after which
`loadContractor` in `src/data/store.tsx` collapses to a single request.
