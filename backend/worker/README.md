# Cloudflare Worker backend

The Worker replaces Firebase Cloud Functions. Firebase Authentication, Firestore, data and Firestore rules remain in the existing Firebase project.

## Routes

All routes are HTTPS POST requests authenticated with a Firebase ID token (`Authorization: Bearer ...`).

- `/ensureFamily`
- `/getServerTime`
- `/createTvPairingSession`
- `/claimPairingSession`
- `/revokeAnonymousTv`
- `/notifyParents`

The mobile app creates commands and `lastCommandAt` in one Firestore batch. The TV calls `/notifyParents` after lock-state changes. This replaces the two former Firestore triggers.

## Google service account

Create a dedicated service account in Google Cloud IAM and grant these roles:

- Cloud Datastore User (`roles/datastore.user`) for Firestore REST access.
- Firebase Cloud Messaging Service Editor (`roles/cloudmessaging.editor`) for push messages.
- A custom IAM role with only `firebaseauth.users.update` for revoking TV refresh tokens.

Enable the Cloud Firestore API (`firestore.googleapis.com`), Firebase Cloud Messaging API (`fcm.googleapis.com`), and Identity Toolkit API (`identitytoolkit.googleapis.com`). Create a JSON key for the service account. This is a private credential. Do not commit it to Git or share it in chat. Do not use an app's `google-services.json` instead.

## Deploy

From this directory:

```powershell
npm install
npx wrangler login
npm run typecheck
npm run deploy
```

Wrangler prints the `workers.dev` URL. Then add the service-account JSON as an encrypted secret:

```powershell
npx wrangler secret put FIREBASE_SERVICE_ACCOUNT_JSON
```

Paste the complete JSON when Wrangler prompts for it. Cloudflare stores it as a Worker secret, not in this repository.

## Build apps

Use the exact URL shown by Wrangler:

```powershell
cd ..\..\mobile
flutter pub get
flutter build apk --debug --dart-define=FAMILY_CONTROL_API_URL=https://family-control-api.YOUR-SUBDOMAIN.workers.dev

cd ..\tv
.\gradlew.bat assembleDebug -PFAMILY_CONTROL_API_URL=https://family-control-api.YOUR-SUBDOMAIN.workers.dev
```

Replace the example host with the actual Worker URL in both commands.

## Local development

Copy `.dev.vars.example` to `.dev.vars`, fill it with a test service-account JSON, then run `npm run dev`. The real `.dev.vars` file is ignored by Git.

## Security

Firebase ID tokens are signature-verified and checked against this Firebase project. Firestore REST access uses the separate service account stored in Cloudflare. Pairing codes are hashed, expire after five minutes, and allow at most five failed attempts. Notification requests are accepted only from the linked, non-revoked TV. Push delivery is best-effort and does not control whether the TV locks.
