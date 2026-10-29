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
- **Blessings**: signs up on the *"I want to bless others"* page, which also asks **how much they make per year**. Blessings members can see any and all bills posted by Billable members. Their income is stored privately and is only ever returned to the member themselves.

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

Without Docker: create a MySQL 8 database, apply `database/schema.sql`, copy `backend/.env.example` to your environment, then `cd backend && npm install && npm start`.

### iPhone app

```sh
brew install xcodegen
cd ios && xcodegen generate && open GetBlessed.xcodeproj
```

Debug builds talk to `http://localhost:3000` (fine for the Simulator). For a real iPhone or production, change `API_BASE_URL` in `ios/project.yml`.

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
| `GET /api/bills/feed?status=&cursor=` | Blessings | Every Billable member's bills, newest first |
| `GET /api/bills/:id` | owner, Blessings | Bill with all items |
| `GET /api/bills/:id/image` | owner, Blessings | The bill photo |

Lists return `{bills, nextCursor}`; pass `nextCursor` back as `cursor` for the next page.

## Built for a very large member base

- InnoDB, `BIGINT UNSIGNED` keys, `utf8mb4`, and `DECIMAL` for money.
- Every list query is served by an index and uses keyset (cursor) pagination, so page 10,000 costs the same as page 1.
- Public IDs are random ULIDs, so internal row IDs and member counts aren't exposed.
- Blessings-only data (income) lives in its own table to keep the `users` rows narrow.
- The API is stateless (JWT), so you can run as many copies as you need behind a load balancer. Point reads at MySQL replicas as traffic grows.
- Photos go through a small storage interface (`backend/src/storage.js`). It writes to local disk today. Swap in S3 or similar before running more than one API server.
