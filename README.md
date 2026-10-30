# Family Control TV

System do kontroli czasu telewizora TCL z aplikacji rodzica. Repozytorium zawiera aplikację TV (Kotlin/Android TV), aplikację rodzica (Flutter), backend Cloudflare Workers i reguły Firestore.

## Moduły

- \`tv/\` — ekran TV, QR do parowania, PIN offline 6744, licznik sesji oparty o czas serwera i opcjonalny Lock Task Mode.
- \`mobile/\` — aplikacja rodzica: logowanie, parowanie, blokowanie, odblokowywanie, dodawanie czasu i ustawianie limitu.
- \`workers/\` — backend HTTP Cloudflare Workers: profile rodzinne, parowanie, polecenia, kontrola dostępu i powiadomienia.
- \`firebase/\` — reguły i indeksy Firestore.
- \`docs/\` — konfiguracja Firebase, wdrożenie Workera, budowanie, testowanie i ograniczenia TCL.

## Wymagania

Flutter SDK, Android SDK, JDK 17, Node.js 22+, npm, Firebase CLI i Wrangler.

## Szybki start

1. W Firebase włącz Email/Password oraz Anonymous Authentication.
2. Utwórz bazę Firestore.
3. Dodaj aplikacje Android o pakietach \`pl.familycontrol.tv\` i \`com.familycontrol.app\`.
4. Skonfiguruj FlutterFire: \`cd mobile; flutterfire configure --project=familycontrol-f4a9f --platforms=android,ios\`.
5. Wdróż reguły: \`firebase deploy --project familycontrol-f4a9f --only firestore:rules,firestore:indexes\`.
6. Skonfiguruj i wdroż Worker według [docs/cloudflare-worker-setup.md](docs/cloudflare-worker-setup.md).
7. Zbuduj aplikacje, przekazując adres Workera. Pełne polecenia są w instrukcji wdrożenia.

## Ograniczenie blokady

Bez Device Owner/Lock Task aplikacja może blokować swój ekran, ale nie może zagwarantować przejęcia HOME, ustawień systemowych ani innych aplikacji. Obsługa Lock Task zależy od firmware konkretnego TCL.

## Prywatna konfiguracja

Nie commituj \`google-services.json\`, \`GoogleService-Info.plist\`, \`mobile/lib/firebase_options.dart\`, kluczy service account, plików \`.env\` / \`.dev.vars\` ani własnego keystore. Nie umieszczaj klucza service account w aplikacji TV lub mobile. APK publikuj w GitHub Releases, nie w repozytorium źródłowym.
