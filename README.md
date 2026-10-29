# GetBlessed
An iPhone application that can help complete strangers get blessed and help pay off there bills and debt the help of our many whales in the world.

## What's in this repo

| Path | What it is |
| --- | --- |
| `ios/` | The SwiftUI iPhone app (iOS 17+) |
| `ios/BillParser/` | Swift package that turns the text on a bill into named, priced items and the complete total |
| `backend/` | Node.js REST API (Express 5) the app talks to |
| `database/schema.sql` | MySQL 8 schema for members, bills and bill items |
| `docker-compose.yml` | Runs MySQL + the API locally |

## How it works

**Two kinds of members, two sign-up pages.** The role is assigned automatically by the server based on which sign-up page was used; the app can't choose it.

- **Billable** (the default member): signs up on the *"I need a blessing"* page and can upload bills.
- **Blessings**: signs up on the *"I want to bless others"* page, which also asks **how much they make per year** and which **membership plan** they want. With an active plan, Blessings members can see any and all bills posted by Billable members and bless them. Their income is stored privately and is only ever returned to the member themselves.

## Pricing

**Blessings membership** (sold through the App Store with StoreKit 2; the server verifies every purchase with Apple):

| Plan | Price | Renews |
| --- | --- | --- |
| Monthly | $9.99 | every month |
| 1-Year | $69.99 | every year |
| 2-Year | $104.99 | no: one payment for 2 years. The App Store's longest auto-renewing period is 1 year, so this is a non-renewing subscription whose end date the server tracks. |

Apple keeps a commission on these sales (15% or 30%, depending on your App Store Small Business Program status and how long a subscriber has been subscribed).

**Tip Service Fee on every blessing:** $1.99 for every started $800 blessed, added on top of the blessing.

| Blessing | Tip Service Fee | Blesser pays |
| --- | --- | --- |
| $50.00 | $1.99 | $51.99 |
| $800.00 | $1.99 | $801.99 |
| $800.01 | $3.98 | $803.99 |
| $1,600.01 | $5.97 | $1,605.98 |

Blessings are paid by card through Stripe (paying a real-world bill isn't something the App Store's in-app purchase covers). Prices live in `backend/src/pricing.js`; subscription prices must also be set to match in App Store Connect.

**Posting a bill.** A Billable member takes a picture or chooses one from Photos. The app reads the bill on the phone with Apple's Vision text recognition, then `BillParser`:

1. puts each item name back together with its price (OCR returns them as separate pieces of text),
2. names and prices every item, including quantities like `2 x Burger`, `Fries 2 @ 3.25` or a name on one line with `2 @ 3.49  6.98` on the next,
3. reads the tax and the **complete total** (`Total`, `Amount Due`, `Balance Due`, …), skipping payment and change lines,
4. works out the total from items + tax if none is printed.

The member checks the items, fixes anything that was misread, and posts. The photo, every item and the totals are saved.

## Running it

### API + database

```sh
JWT_SECRET=$(openssl rand -hex 32) docker compose up --build
```

This starts MySQL with `database/schema.sql` applied and the API on `http://localhost:3000`.

To take payments, also set (see `backend/.env.example`):

- **App Store:** create the three products in App Store Connect with the IDs in `backend/src/pricing.js` (Monthly and 1-Year as auto-renewable subscriptions in one group, 2-Year as a non-renewing subscription). Download Apple's root certificates into a folder and set `APPLE_ROOT_CERTS_DIR`, `APPLE_APP_ID` and `APPLE_ENVIRONMENT`. Set the App Store Server Notifications V2 URL to `https://<your-api>/api/apple/notifications`.
- **Stripe:** set `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY` and `STRIPE_WEBHOOK_SECRET`, and add a webhook to `https://<your-api>/api/stripe/webhook` for `payment_intent.succeeded`, `payment_intent.payment_failed` and `payment_intent.canceled`.

Without these, the app still runs; subscribing and blessing return "not configured".

Without Docker: create a MySQL 8 database, apply `database/schema.sql`, copy `backend/.env.example` to your environment, then `cd backend && npm install && npm start`.

### iPhone app

```sh
brew install xcodegen
cd ios && xcodegen generate && open GetBlessed.xcodeproj
```

Debug builds talk to `http://localhost:3000` (fine for the Simulator). For a real iPhone or production, change `API_BASE_URL` in `ios/project.yml`.

Running from Xcode uses `ios/GetBlessed.storekit`, a local copy of the three plans, so purchases can be tried in the Simulator without App Store Connect. These purchases aren't signed by Apple, so run the API with `APPLE_ENVIRONMENT=XCODE` while testing. The server refuses that setting when `NODE_ENV=production`.

### Tests

```sh
cd backend && npm test               # integration tests need a MySQL/MariaDB server: TEST_DB_HOST/USER/PASSWORD
cd ios/BillParser && swift test      # receipt parser tests
```

CI (`.github/workflows/ci.yml`) runs the API tests against MySQL 8 and builds the app and parser tests on macOS.

## API

All amounts are decimal strings (`"12.34"`). Authenticated requests send `Authorization: Bearer <token>`.

| Method & path | Who | Purpose |
| --- | --- | --- |
| `POST /api/auth/signup/billable` | anyone | `{displayName, email, password}` → Billable account + token |
| `POST /api/auth/signup/blessings` | anyone | `{displayName, email, password, annualIncome}` → Blessings account + token |
| `POST /api/auth/login` | anyone | `{email, password}` → token |
| `GET /api/auth/me` | members | Current member |
| `POST /api/bills` | Billable | multipart: `image` (JPEG/PNG/HEIC) + `bill` JSON `{title, merchant?, description?, items:[{name, quantity, lineTotal, unitPrice?}], tax?, total?, ocrRawText?}` |
| `GET /api/bills/mine?cursor=` | Billable | Your bills, newest first |
| `GET /api/bills/feed?status=&cursor=` | Blessings with a plan | Every Billable member's bills, newest first |
| `GET /api/bills/:id` | owner, Blessings with a plan | Bill with all items and how much has been blessed |
| `GET /api/bills/:id/image` | owner, Blessings with a plan | The bill photo |
| `GET /api/pricing` | anyone | Plans and the Tip Service Fee |
| `POST /api/subscriptions/apple` | Blessings | `{signedTransaction}` from StoreKit 2 → activates the plan |
| `POST /api/apple/notifications` | Apple | App Store Server Notifications V2 (renewals, expiry, refunds) |
| `POST /api/bills/:id/blessings` | Blessings with a plan | `{amount}` → blessing with Tip Service Fee + Stripe `clientSecret` |
| `GET /api/blessings/mine` | Blessings | Blessing history |
| `POST /api/stripe/webhook` | Stripe | Marks blessings paid and bills blessed |

Blessings members without an active plan get `402 subscription_required`.

Lists return `{bills, nextCursor}`; pass `nextCursor` back as `cursor` for the next page.

## Built for a very large member base

- InnoDB, `BIGINT UNSIGNED` keys, `utf8mb4`, and `DECIMAL` for money.
- Every list query is served by an index and uses keyset (cursor) pagination, so page 10,000 costs the same as page 1.
- Public IDs are random ULIDs, so internal row IDs and member counts aren't exposed.
- Blessings-only data (income) lives in its own table to keep the `users` rows narrow.
- The API is stateless (JWT), so you can run as many copies as you need behind a load balancer. Point reads at MySQL replicas as traffic grows.
- Photos go through a small storage interface (`backend/src/storage.js`). It writes to local disk today. Swap in S3 or similar before running more than one API server.
