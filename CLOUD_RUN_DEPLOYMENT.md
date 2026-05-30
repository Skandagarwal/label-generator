# BatchMark Cloud Run Deployment

This setup runs BatchMark as one Cloud Run service:

- React frontend is built into `client/build`.
- Express serves both the website and `/api` routes.
- Firebase Auth and Firestore remain the database/auth layer.
- Puppeteer Chrome is installed inside the container for PDF generation.

## 1. Required Cloud Run Environment Variables

Set these on the Cloud Run service:

```text
NODE_ENV=production
CLIENT_ORIGIN=https://YOUR_CLOUD_RUN_URL_OR_CUSTOM_DOMAIN
PUBLIC_API_ORIGIN=https://YOUR_CLOUD_RUN_URL_OR_CUSTOM_DOMAIN
FIREBASE_SERVICE_ACCOUNT_BASE64=PASTE_BASE64_SERVICE_ACCOUNT_JSON
REACT_APP_FIREBASE_API_KEY=your_firebase_web_api_key
REACT_APP_FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
REACT_APP_FIREBASE_PROJECT_ID=your_project_id
REACT_APP_FIREBASE_APP_ID=your_firebase_web_app_id
```

Important:

- `PUBLIC_API_ORIGIN` controls QR/PDF links.
- `CLIENT_ORIGIN` controls browser CORS.
- `FIREBASE_SERVICE_ACCOUNT_BASE64` lets the server read/write Firestore.
- The `REACT_APP_*` values are served through `/runtime-config.js`, so they work
  as Cloud Run runtime variables.

## 2. Local Build Test

From the project root:

```bash
npm run build
```

## 3. Deploy With Google Cloud CLI

From the project root:

```bash
gcloud run deploy batchmark \
  --source . \
  --region asia-south2 \
  --allow-unauthenticated
```

Choose `asia-south2` for Mumbai. Use `asia-south1` if Mumbai is not available in your account.

## 4. After First Deploy

Cloud Run gives a public URL like:

```text
https://batchmark-xxxxx-uc.a.run.app
```

Update these environment variables to that URL:

```text
CLIENT_ORIGIN=https://batchmark-xxxxx-uc.a.run.app
PUBLIC_API_ORIGIN=https://batchmark-xxxxx-uc.a.run.app
```

Then redeploy.

You can set/update variables from the command line:

```bash
gcloud run services update batchmark \
  --region asia-south2 \
  --set-env-vars NODE_ENV=production,CLIENT_ORIGIN=https://YOUR_URL,PUBLIC_API_ORIGIN=https://YOUR_URL,REACT_APP_FIREBASE_API_KEY=YOUR_KEY,REACT_APP_FIREBASE_AUTH_DOMAIN=YOUR_AUTH_DOMAIN,REACT_APP_FIREBASE_PROJECT_ID=YOUR_PROJECT_ID,REACT_APP_FIREBASE_APP_ID=YOUR_APP_ID
```

Set `FIREBASE_SERVICE_ACCOUNT_BASE64` in the Cloud Run console because the value
is long and sensitive.

## 5. Firebase Auth Domain

In Firebase Console:

Authentication -> Settings -> Authorized domains

Add:

```text
batchmark-xxxxx-uc.a.run.app
```

Later, also add your custom domain.

## 6. Final Check

Open:

```text
https://YOUR_CLOUD_RUN_URL/api/status
```

Expected response:

```json
{"database":"firebase","firebaseConfigured":true}
```
