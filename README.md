# Family Control TV

System do kontroli czasu telewizora TCL z aplikacji rodzica. Aplikacja rodzica i TV korzystają z Firebase Authentication oraz Firestore. Backend aplikacyjny działa jako Cloudflare Worker.

## Moduły

- `tv/` — aplikacja Android TV, ekran blokady, PIN offline 6744 i licznik sesji.
- `mobile/` — aplikacja rodzica Flutter: logowanie, parowanie QR, blokowanie, odblokowywanie i limity czasu.
- `backend/worker/` — backend HTTP na Cloudflare Workers; zastępuje Firebase Cloud Functions.
- `backend/functions/` — historyczna kopia poprzednich funkcji; nie jest już wdrażana.
- `firebase/` — reguły i indeksy Firestore.
- `docs/` — instrukcje konfiguracji, budowania i ograniczenia TCL.

## Wymagania

Flutter SDK, Android SDK, JDK 17, Node.js 22, npm, Firebase CLI i Wrangler.

## Szybki start

Pełna instrukcja: [docs/firebase-setup.md](docs/firebase-setup.md).

1. W Firebase włącz Email/Password oraz Anonymous Authentication.
2. Utwórz Firestore i dodaj aplikacje Android: `pl.familycontrol.tv` oraz `com.familycontrol.app`.
3. Pobierz lokalne pliki `google-services.json` do odpowiednich katalogów i skonfiguruj FlutterFire.
4. Z katalogu głównego wdroż reguły oraz indeksy:
   ```powershell
   firebase deploy --project familycontrol-f4a9f --only firestore:rules,firestore:indexes
   ```
5. Skonfiguruj dedykowane konto usługi Google i wdroż Worker z `backend/worker/`.
6. Dodaj JSON konta usługi do Cloudflare jako sekret `FIREBASE_SERVICE_ACCOUNT_JSON`.
7. Zbuduj obie aplikacje, podając adres Worker przez `FAMILY_CONTROL_API_URL`.

Cloud Functions nie są wymagane. Firebase pozostaje bazą danych i dostawcą logowania; Worker obsługuje operacje serwerowe.

## Ważne ograniczenie blokady

Bez Device Owner/Lock Task aplikacja może blokować swój własny ekran, ale nie może zagwarantować przejęcia HOME ani zablokowania ustawień i innych aplikacji. Obsługa Lock Task jest warunkowa i zależy od firmware konkretnego TCL. Nie używamy rootowania ani exploitów.

## Prywatna konfiguracja

Nie commituj plików `google-services.json`, `mobile/lib/firebase_options.dart`, kluczy kont usług, plików `.dev.vars`, `.env` ani własnego keystore. APK publikuj w GitHub Releases, nie w repozytorium źródłowym.
