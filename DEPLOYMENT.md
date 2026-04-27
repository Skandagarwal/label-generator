# Public Deployment

Use one public Node service for both the website and API.

## Required Environment Variables

Set these on the hosting platform:

```bash
MONGO_URI=mongodb+srv://...
PUBLIC_API_ORIGIN=https://your-public-app-url.com
CLIENT_ORIGIN=https://your-public-app-url.com
NODE_ENV=production
```

`PUBLIC_API_ORIGIN` is the important one for QR codes. Every QR points to:

```text
PUBLIC_API_ORIGIN/api/labels/:id/pdf
```

## Build Command

```bash
npm run install:all && npm run build
```

## Start Command

```bash
npm run start:prod
```

## Local LAN Testing

```bash
npm run start:lan
```

That is only for testing on the same Wi-Fi. For buyers outside the Wi-Fi, use the public deployment URL.
