# Konfiguracja Firebase i Cloudflare — Family Control TV

Projekt używa jednego Firebase dla Authentication i Firestore. Operacje serwerowe wykonuje Cloudflare Worker. Nie wdrażamy już Firebase Cloud Functions, więc nie trzeba przełączać projektu na Blaze tylko z ich powodu.

## 0. Wymagane narzędzia

Zainstaluj Flutter SDK, Android Studio / Android SDK, JDK 17, Node.js 22, npm, Firebase CLI, FlutterFire CLI i Wrangler.

Sprawdź w PowerShell:
```powershell
flutter --version
dart --version
java -version
node --version
npm --version
```

## 1. Projekt Firebase

Używany projekt: `familycontrol-f4a9f`.

Otwórz [Firebase Console](https://console.firebase.google.com/project/familycontrol-f4a9f/overview), a w katalogu głównym repozytorium wykonaj:
```powershell
firebase login
firebase use familycontrol-f4a9f
firebase projects:list
```

## 2. Authentication

W Firebase Console → Build → Authentication → Sign-in method włącz:
- Email/Password — dla rodzica.
- Anonymous — dla telewizora.

Nie wyłączaj Anonymous Authentication — TV używa anonimowego konta do identyfikacji urządzenia.

## 3. Firestore

W Firebase Console → Build → Firestore Database utwórz bazę w trybie produkcyjnym, jeżeli jeszcze jej nie ma. Wybierz region europejski. Lokalizacji bazy nie można później łatwo zmienić.

Nie twórz ręcznie kolekcji `users`, `families` ani `pairingSessions`. Worker utworzy wymagane dokumenty podczas pierwszego logowania i parowania.

## 4. Aplikacje Firebase

Dodaj dwie aplikacje Android w Firebase Console → Project settings → Your apps:

1. TV: pakiet `pl.familycontrol.tv`. Umieść pobrany plik w `tv/app/google-services.json`.
2. Aplikacja rodzica: pakiet `com.familycontrol.app`. Umieść jej osobny plik w `mobile/android/app/google-services.json`.

Nie kopiuj pliku aplikacji TV do aplikacji rodzica. Każda aplikacja ma własną konfigurację.

## 5. FlutterFire

W PowerShell:
```powershell
cd mobile
flutter pub get
flutterfire configure --project=familycontrol-f4a9f --platforms=android,ios
```

Wybierz projekt `familycontrol-f4a9f` i odpowiednie aplikacje. FlutterFire utworzy `mobile/lib/firebase_options.dart`.

Dla iOS konfigurację kończysz na Macu w Xcode: dodaj GoogleService-Info.plist do Runner, włącz Push Notifications i skonfiguruj APNs w Firebase Console → Project settings → Cloud Messaging.

## 6. Reguły i indeksy Firestore

Z katalogu głównego repozytorium:
```powershell
firebase deploy --project familycontrol-f4a9f --only firestore:rules,firestore:indexes
```

Aktualne reguły pozwalają rodzicowi tworzyć polecenia i aktualizować wyłącznie dozwolone pola. Profil rodzica, rodzina, sesje parowania i urządzenia są tworzone przez zaufany backend.

## 7. Konto usługi Google dla Workera

Worker musi mieć dostęp do Firestore i możliwość wysyłania powiadomień FCM.

1. W Google Cloud Console → APIs & Services → Library upewnij się, że włączone są Cloud Firestore API (`firestore.googleapis.com`) oraz Firebase Cloud Messaging API (`fcm.googleapis.com`).
2. Otwórz Google Cloud Console → IAM & Admin → Service Accounts.
3. Utwórz osobne konto usługi, np. `family-control-worker`.
4. Nadaj mu tylko te role:
   - Cloud Datastore User — `roles/datastore.user`.
   - Firebase Cloud Messaging Service Editor — `roles/cloudmessaging.editor`.
5. Utwórz klucz JSON tego konta i zapisz go lokalnie.

**Ten JSON jest sekretem serwera.** Nie wklejaj go do kodu, repozytorium Git ani czatu. Nie używaj w jego miejsce pliku `google-services.json` z aplikacji.

## 8. Wdrożenie Cloudflare Worker

Z katalogu głównego:
```powershell
cd backend/worker
npm install
npx wrangler login
npm run typecheck
npm run deploy
```

Wrangler pokaże adres, np. `https://family-control-api.twoj-login.workers.dev`. Skopiuj dokładny adres.

Dodaj klucz konta usługi do Cloudflare jako zaszyfrowany sekret:
```powershell
npx wrangler secret put FIREBASE_SERVICE_ACCOUNT_JSON
```

Gdy Wrangler poprosi o wartość, wklej całą zawartość lokalnego pliku JSON konta usługi. Nie wklejaj jej tutaj. Cloudflare zapisze ją jako Worker Secret.

Po dodaniu sekretu Wrangler opublikuje nową wersję Workera. W razie rotacji klucza powtórz polecenie z nowym JSON-em i usuń stary klucz w Google Cloud.

Na bezpłatnym planie Cloudflare Workers limit wynosi obecnie 100 000 żądań dziennie i 10 ms CPU na żądanie. Jeśli projekt przekroczy te limity, będzie trzeba zmienić plan Cloudflare. Nie zmienia to planu rozliczeniowego Firebase.

## 9. Budowanie aplikacji z adresem Workera

Zastąp poniższy adres dokładnym URL-em, który podał Wrangler. Użyj tego samego adresu w obu poleceniach.

Aplikacja rodzica:
```powershell
cd ..\..\mobile
flutter pub get
flutter build apk --debug --dart-define=FAMILY_CONTROL_API_URL=https://family-control-api.twoj-login.workers.dev
```

Aplikacja TV:
```powershell
cd ..\tv
.\gradlew.bat assembleDebug -PFAMILY_CONTROL_API_URL=https://family-control-api.twoj-login.workers.dev
```

Wyniki:
- TV: `tv/app/build/outputs/apk/debug/app-debug.apk`.
- Rodzic: `mobile/build/app/outputs/flutter-apk/app-debug.apk`.

## 10. Powiadomienia

Aplikacja rodzica zapisuje token FCM w `users/{uid}/notificationTokens/{token}`. Po faktycznej zmianie blokady TV wywołuje Worker, który weryfikuje powiązanie telewizora z rodziną i wysyła powiadomienie rodzicom.

Powiadomienia są dodatkowe — blokowanie i odblokowywanie telewizora nie zależą od powodzenia FCM. Dla iOS potrzebny jest APNs Authentication Key skonfigurowany w Firebase Console.

## 11. Parowanie i test

1. Zainstaluj nowy APK TV na TCL.
2. Otwórz TV i poczekaj na kod QR.
3. Zaloguj się lub utwórz konto rodzica.
4. Zeskanuj kod QR w aplikacji rodzica.
5. Sprawdź blokowanie, odblokowanie, dodawanie czasu, limit oraz PIN 6744.
6. Sprawdź, czy na telefon przychodzi powiadomienie po zmianie stanu TV.

## 12. Ograniczenie Device Owner / Lock Task

Bez Device Owner aplikacja może blokować swój własny ekran, ale nie może zagwarantować blokady HOME, ustawień systemowych ani innych aplikacji. Pełny Lock Task zależy od firmware TCL. Nie wykonuj factory reset ani polecenia `dpm set-device-owner` na telewizorze, którego konfiguracji nie możesz stracić.
