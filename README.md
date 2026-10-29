# GetBlessed
An Android application that helps strangers get their bills and debt paid off with the help of generous members.

## Components
- `android/` – Kotlin / Jetpack Compose app. Users pick a bill picture; on-device ML Kit OCR reads it and `BillParser` extracts each item, its price and the complete total.
- `backend/` – Node.js (Express) API backed by MySQL, plus the web admin panel served at `/admin`.

## Roles
| Role | Created by | Abilities |
|------|-----------|-----------|
| **Billable** (default member) | "Billable" sign up page | Upload bills (picture + detected items/total), view own bills |
| **Blessings** | Separate sign up page, which also asks for **yearly income** | See every posted bill and bless it with an amount |
| **Admin** | `npm run migrate` seed / admin panel | Full admin panel |

## Backend setup
```bash
cd backend
cp .env.example .env        # edit values (JWT_SECRET, DB_*, ADMIN_*)
npm install
export $(grep -v '^#' .env | xargs)
npm run migrate             # creates MySQL tables (indexed for large user bases) and the admin account
npm start                   # API on :3000, admin panel at http://localhost:3000/admin/
npm test
```
The admin panel provides a dashboard, user search/role/suspend/password/delete management, bill review (approve/reject/delete with image and items), a blessings ledger and settings (sign ups, uploads, approval requirement, limits, site name).

## Android setup
Open `android/` in Android Studio and run. `API_URL` in `android/app/build.gradle.kts` defaults to `http://10.0.2.2:3000` (emulator → host); change it for a real server and use HTTPS.
