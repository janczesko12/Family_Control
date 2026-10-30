# Family Control TV

System do kontroli czasu telewizora TCL z aplikacji rodzica. Repozytorium zawiera aplikację TV (Kotlin/Android TV), aplikację rodzica (Flutter), Firebase Cloud Functions i reguły Firestore.

## Moduły

- tv/ — ekran TV, QR do parowania, PIN offline 6744, licznik sesji oparty o serwerowy czas zakończenia i opcjonalny Lock Task Mode.
- mobile/ — aplikacja rodzica: logowanie, parowanie QR, blokowanie, odblokowywanie, dodawanie czasu i ustawianie limitu.
- backend/functions/ — tworzenie rodziny, parowanie z ograniczeniem prób, odłączanie TV, audyt i powiadomienia.
- firebase/ — reguły i indeksy Firestore.
- docs/ — konfiguracja Firebase, budowanie, testowanie i ograniczenia TCL.

## Wymagania

Flutter SDK, Android SDK, JDK 17, Node.js 20 LTS, Firebase CLI i FlutterFire CLI.

## Szybki start

Pełna instrukcja: docs/firebase-setup.md.

1. W Firebase włącz Email/Password oraz Anonymous Authentication.
2. Utwórz Firestore.
3. Dodaj aplikacje Android o pakietach pl.familycontrol.tv i com.familycontrol.app.
4. Umieść google-services.json dla TV w tv/app/.
5. W mobile uruchom flutterfire configure --project=familycontrol-f4a9f --platforms=android,ios.
6. Z katalogu głównego wdróż reguły, indeksy i funkcje:
   firebase deploy --project familycontrol-f4a9f --only firestore:rules,firestore:indexes,functions
7. Zbuduj obie aplikacje z katalogu głównego:
~~~powershell
cd tv
.\gradlew.bat assembleDebug
cd ..
cd mobile
flutter pub get
flutter build apk --debug
cd ..
~~~

Cloud Functions wymagają planu Blaze. Ustaw alert budżetowy w Google Cloud/Firebase.

## Ważne ograniczenie blokady

Bez Device Owner/Lock Task aplikacja może blokować swój własny ekran, ale nie może zagwarantować przejęcia HOME ani zablokowania ustawień i innych aplikacji. Obsługa Lock Task jest warunkowa i zależy od firmware konkretnego TCL. Nie używamy rootowania ani exploitów.

## Prywatna konfiguracja

Nie commituj google-services.json, mobile/lib/firebase_options.dart, kluczy service account, plików .env ani własnego keystore. APK publikuj w GitHub Releases, nie w repozytorium źródłowym.
