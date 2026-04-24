# Civil DPR Admin Panel (Vanilla JS + Firebase)

Production-ready admin panel for construction management with role-based access, real-time updates, and scalable Firebase-backed modules.

## Included Pages

- `index.html` - Login
- `dashboard.html` - KPIs, charts, activity feed
- `attendance.html` - Attendance table, filters, pagination, CSV export
- `dpr.html` - Daily project reports
- `images.html` - Storage images with metadata + modal preview
- `users.html` - Super admin user management

## Tech Stack

- Semantic HTML
- Modern responsive CSS (dark SaaS UI)
- Vanilla JavaScript (ES modules)
- Firebase Auth + Firestore + Storage
- Chart.js

## 1) Firebase Setup

1. Create or select the same Firebase project used by your mobile app.
2. Enable Email/Password authentication in Firebase Auth.
3. Create Firestore in production mode.
4. Create Storage bucket.
5. In `js/firebase-config.js`, paste your web config values.
6. Add user profile docs in `users/{uid}` for admin users:

```json
{
  "name": "Admin Name",
  "email": "admin@company.com",
  "role": "super_admin",
  "sites": ["site-a", "site-b"]
}
```

## 2) Recommended Firestore Collections

- `users`
- `sites`
- `projects`
- `attendance`
- `dpr`
- `materialLogs`
- `imageMeta`

### Suggested Field Shapes

`attendance/{id}`

```json
{
  "workerName": "Ramesh Kumar",
  "role": "worker",
  "siteId": "site-a",
  "siteName": "Plant 1",
  "status": "present",
  "dateKey": "2026-04-24",
  "checkIn": "<timestamp>",
  "checkOut": "<timestamp>"
}
```

`dpr/{id}`

```json
{
  "siteId": "site-a",
  "siteName": "Plant 1",
  "dateKey": "2026-04-24",
  "workDescription": "Concrete pouring",
  "quantity": 38,
  "remarks": "On schedule",
  "createdAt": "<timestamp>"
}
```

`imageMeta/{id}`

```json
{
  "siteId": "site-a",
  "siteName": "Plant 1",
  "storagePath": "siteImages/site-a/2026/04/image1.jpg",
  "downloadURL": "",
  "uploader": "Engineer A",
  "uploadedAt": "<timestamp>"
}
```

## 3) Security Rules

Deploy included rule files:

- `firestore.rules`
- `storage.rules`

Example deploy commands:

```bash
firebase login
firebase use <project-id>
firebase deploy --only firestore:rules
firebase deploy --only storage
```

## 4) Composite Indexes (if prompted)

The app uses optimized filtered queries and may prompt Firestore index links in console for combinations like:

- `attendance`: `siteId + dateKey + checkIn(desc)`
- `attendance`: `siteId + role + checkIn(desc)`
- `dpr`: `siteId + createdAt(desc)`
- `imageMeta`: `siteId + uploadedAt(desc)`
- `materialLogs`: `siteId + dateKey`

Create indexes from the Firebase console links shown in browser devtools.

## 5) Run Locally

Because pages use ES modules, run a static server (not file://):

```bash
# Node option
npx serve .

# Python option
python -m http.server 5500
```

Then open:

- `http://localhost:5500/index.html`

## 6) Deploy to Netlify / Vercel

### Netlify

1. Push this folder to GitHub.
2. In Netlify, create new site from repo.
3. Build command: none
4. Publish directory: `.`
5. Add `_redirects` (optional for root route):

```
/  /index.html  200
```

### Vercel

1. Import the repo in Vercel.
2. Framework preset: `Other`.
3. Build command: none.
4. Output directory: `.`.

## Important Production Note

Creating Firebase Auth users directly from browser client is not secure and is not supported with Admin SDK privileges. The `users.html` page manages Firestore user profiles. For secure full user provisioning, add a Cloud Function callable endpoint that creates/deletes Auth users and then writes matching Firestore user docs.
