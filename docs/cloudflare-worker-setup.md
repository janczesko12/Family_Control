# Migracja backendu Family Control na Cloudflare Workers

Ten backend zastępuje Firebase Cloud Functions. Firebase Authentication i Firestore pozostają w projekcie \`familycontrol-f4a9f\`.

## Architektura

- Flutter i Android TV logują się przez Firebase Authentication.
- Aplikacje wysyłają Firebase ID token w nagłówku \`Authorization: Bearer ...\`.
- Cloudflare Worker weryfikuje podpis, projekt, ważność i dostawcę logowania tokenu.
- Worker odczytuje i zapisuje Firestore przez REST API przy użyciu krótkotrwałego tokenu OAuth konta serwisowego.
- Konto serwisowe jest zapisane wyłącznie jako zaszyfrowany sekret Cloudflare. Nie dodawaj pliku JSON do repozytorium, aplikacji ani zgłoszenia.
- Firestore Rules nadal ograniczają bezpośrednie operacje wykonywane przez aplikacje. Tworzenie poleceń odbywa się wyłącznie przez Worker.

## 1. Utwórz konto serwisowe Google

Otwórz [Google Cloud Console — Service Accounts](https://console.cloud.google.com/iam-admin/serviceaccounts?project=familycontrol-f4a9f) dla projektu \`familycontrol-f4a9f\`.

1. Utwórz konto \`family-control-worker\`.
2. Przyznaj mu role:
   - **Cloud Datastore User** (\`roles/datastore.user\`) — odczyt i zapis dokumentów Firestore.
   - **Firebase Cloud Messaging API Admin** (\`roles/firebasecloudmessaging.admin\`) — wysyłanie powiadomień FCM.
3. W sekcji Keys utwórz klucz JSON i zapisz go lokalnie, np. jako \`family-control-worker.json\`.

To konto ma uprzywilejowany dostęp do danych Firestore i omija Firestore Security Rules. Worker sprawdza uprawnienia rodziny przed każdą operacją. Nie nadawaj temu kontu roli Owner ani Editor.

Dokumentacja:
- [Firestore REST API — uwierzytelnianie kontem serwisowym](https://firebase.google.com/docs/firestore/use-rest-api)
- [Role Firestore/IAM](https://cloud.google.com/iam/docs/roles-permissions/firestore)
- [Role Firebase Cloud Messaging](https://cloud.google.com/iam/docs/roles-permissions/firebasecloudmessaging)

## 2. Wdróż Worker

W PowerShell, z katalogu głównego repozytorium:

~~~powershell
cd workers
npm install
npx wrangler login
npm run typecheck
~~~

Dodaj klucz JSON jako zaszyfrowany sekret Cloudflare. Polecenie odczyta plik lokalny i przekaże jego zawartość do Wrangler:

~~~powershell
Get-Content -Raw .\family-control-worker.json | npx wrangler secret put FIREBASE_SERVICE_ACCOUNT_JSON
~~~

Plik JSON zostaw poza repozytorium. Po dodaniu sekretu wdróż Worker:

~~~powershell
npm run deploy
~~~

Wrangler wyświetli adres w postaci:

~~~text
https://family-control-api.<twoj-subdomenowy-adres>.workers.dev
~~~

Zapisz ten adres. Adres API jest publiczny, a dostęp chroni Firebase ID token.

## 3. Zbuduj aplikację rodzica

Wróć do katalogu głównego repozytorium. W miejsce adresu wstaw adres Workera z poprzedniego kroku:

~~~powershell
cd mobile
flutter pub get
flutter build apk --debug --dart-define=FAMILY_CONTROL_API_URL=https://family-control-api.<twoj-subdomenowy-adres>.workers.dev
~~~

Do budowania iOS użyj tego samego parametru \`--dart-define\` przy komendzie Flutter dla iOS.

## 4. Zbuduj aplikację TV

~~~powershell
cd ..\tv
.\gradlew.bat assembleDebug -PworkerApiUrl=https://family-control-api.<twoj-subdomenowy-adres>.workers.dev
~~~

## 5. Wdróż reguły Firestore

W katalogu głównym repozytorium:

~~~powershell
cd ..
firebase deploy --project familycontrol-f4a9f --only firestore:rules,firestore:indexes
~~~

Reguły blokują bezpośrednie tworzenie komend przez klienta. Komendy tworzy Worker, a telewizor potwierdza ich wykonanie.

## 6. Endpointy

| Endpoint | Dostęp | Działanie |
|---|---|---|
| \`POST /api/ensure-family\` | rodzic | tworzy profil i rodzinę |
| \`POST /api/server-time\` | zalogowane konto | zwraca czas serwera |
| \`POST /api/tv/pairing-session\` | anonimowe konto TV | generuje 6-cyfrowy kod |
| \`POST /api/pairing/claim\` | rodzic | zatwierdza parowanie |
| \`POST /api/commands\` | rodzic | tworzy polecenie dla TV |
| \`POST /api/tv/device-state\` | przypisane konto TV | wyzwala powiadomienie po zmianie blokady |
| \`POST /api/tv/revoke\` | rodzic | odłącza telewizor |

## 7. Test po wdrożeniu

1. Otwórz aplikację TV i sprawdź, czy pokazuje kod QR.
2. Zaloguj się w aplikacji rodzica i zeskanuj kod.
3. Sprawdź, czy TV pojawia się na liście urządzeń.
4. Przetestuj blokadę, odblokowanie, dodanie czasu i PIN lokalny.
5. Sprawdź powiadomienie push po zmianie stanu TV.

Powiadomienia iOS wymagają dodatkowej konfiguracji APNs. Sterowanie TV powinno działać niezależnie od tej funkcji.

## Bezpieczeństwo i koszty

- Nie commituj \`family-control-worker.json\`, klucza prywatnego konta serwisowego ani pliku \`.dev.vars\`.
- Nie wysyłaj klucza na czacie ani do GitHub Issues.
- Cloudflare Workers Free ma aktualny limit 100 000 żądań dziennie i 10 ms CPU na pojedyncze wywołanie. Firestore ma osobne limity i zasady rozliczeń.
- Firebase Cloud Functions nie są już potrzebne. Nie wykonuj \`firebase deploy --only functions\`.
- Nie usuwaj projektu Firebase, Authentication ani Firestore.
