# Podłączenie Firebase — Family Control TV

Ten projekt korzysta z jednego projektu Firebase dla aplikacji rodzica (Flutter), aplikacji TV (Android TV/Kotlin), Firestore i Cloud Functions.

## 0. Wymagane narzędzia

Zainstaluj Flutter SDK, Android Studio / Android SDK, JDK 17, Node.js 20 LTS, npm, Firebase CLI i FlutterFire CLI.

W PowerShell sprawdź:
~~~powershell
flutter --version
dart --version
java -version
node --version
npm --version
~~~

Zainstaluj Firebase CLI i FlutterFire CLI:
~~~powershell
npm install -g firebase-tools
dart pub global activate flutterfire_cli
firebase login
~~~

Jeśli flutterfire nie jest rozpoznawany, dodaj do PATH:
%LOCALAPPDATA%\Pub\Cache\bin
Następnie zamknij i otwórz PowerShell ponownie.

## 1. Wybierz projekt Firebase

Repozytorium wskazuje domyślnie projekt:
familycontrol-f4a9f

Otwórz https://console.firebase.google.com/

- Jeśli masz już projekt o identyfikatorze familycontrol-f4a9f, użyj go.
- Jeśli projekt nie istnieje lub nie masz do niego dostępu, utwórz nowy i zmień .firebaserc oraz polecenia poniżej na nowy identyfikator.
- Włącz rozliczenia Blaze przed wdrożeniem Cloud Functions. Ustaw alert budżetowy.

W katalogu głównym repozytorium:
~~~powershell
firebase use familycontrol-f4a9f
firebase projects:list
~~~

## 2. Włącz logowanie

W Firebase Console:
1. Otwórz Build → Authentication.
2. Wybierz Get started.
3. W zakładce Sign-in method włącz:
   - Email/Password — dla aplikacji rodzica,
   - Anonymous — dla aplikacji na telewizorze.
4. Zapisz zmiany.

Nie wyłączaj Anonymous Authentication — TV używa anonimowego konta do identyfikacji urządzenia.

## 3. Utwórz bazę Firestore

W Firebase Console:
1. Otwórz Build → Firestore Database.
2. Wybierz Create database.
3. Wybierz tryb produkcyjny.
4. Wybierz lokalizację europejską możliwie blisko użytkowników. Lokalizacji bazy nie można później łatwo zmienić; Cloud Functions najlepiej wdrażać w zgodnym regionie.
5. Utwórz bazę.

Nie twórz ręcznie kolekcji users, families ani pairingSessions. Funkcje tworzą je automatycznie.

## 4. Dodaj aplikację Android TV do Firebase

W Firebase Console:
1. Otwórz ustawienia projektu → Project settings.
2. W sekcji Your apps dodaj aplikację Android.
3. Jako nazwę pakietu wpisz dokładnie: pl.familycontrol.tv
4. Pobierz google-services.json.
5. Umieść plik w: tv/app/google-services.json

Nie zmieniaj nazwy pliku.

## 5. Dodaj osobną aplikację Android rodzica

To jest druga aplikacja Android w tym samym projekcie Firebase — ma inny identyfikator pakietu niż aplikacja TV.

W Firebase Console → Project settings → Your apps:
1. Dodaj kolejną aplikację Android.
2. Wpisz identyfikator pakietu: com.familycontrol.app
3. Pobierz jej własny plik google-services.json.
4. Umieść go tutaj: mobile/android/app/google-services.json

Nie kopiuj pliku TV do katalogu aplikacji rodzica. Każda rejestracja Android ma własny plik konfiguracyjny. Oba pliki są ignorowane przez Git.

## 6. Skonfiguruj aplikację rodzica Flutter

Identyfikator Android aplikacji rodzica to: com.familycontrol.app

W PowerShell:
~~~powershell
cd mobile
flutter pub get

# Jeśli projekt nie ma jeszcze katalogu ios:
flutter create --platforms=ios .

# Zarejestruj Android i iOS w tym samym projekcie Firebase:
flutterfire configure --project=familycontrol-f4a9f --platforms=android,ios
~~~

Wybierz projekt familycontrol-f4a9f i potwierdź odpowiednie aplikacje.
FlutterFire utworzy plik mobile/lib/firebase_options.dart.

Ten plik jest lokalną konfiguracją generowaną dla Twojego projektu i jest ignorowany przez Git. Nie musisz ręcznie przepisywać kluczy.

Powiadomienia:
- aplikacja poprosi o zgodę na powiadomienia i zapisze aktualny token FCM w users/{uid}/notificationTokens/{token}; token jest aktualizowany także po rotacji.
- dla Androida 13+ manifest zawiera POST_NOTIFICATIONS; zgodę użytkownik potwierdza w systemowym oknie.
- dla iOS otwórz mobile/ios/Runner.xcworkspace w Xcode na Macu, włącz Push Notifications w Signing & Capabilities i skonfiguruj APNs Authentication Key w Firebase Console → Project settings → Cloud Messaging.
- dla iOS upewnij się, że GoogleService-Info.plist jest dodany do targetu Runner.

Dla iOS:
- w ios/Runner/Info.plist dodaj opis użycia kamery dla skanera QR:
~~~xml
<key>NSCameraUsageDescription</key>
<string>Kamera służy do skanowania kodu parowania telewizora.</string>
~~~

Budowanie iOS wymaga macOS oraz Xcode.

## 7. Wdróż reguły i indeksy Firestore

Wróć do katalogu głównego repozytorium:
~~~powershell
cd ..
firebase deploy --project familycontrol-f4a9f --only firestore:rules,firestore:indexes
~~~

Reguły nie pozwalają użytkownikowi nadać sobie roli rodzica ani bezpośrednio zmienić limitu urządzenia. Rodzic zapisuje polecenie, a TV potwierdza wykonanie razem ze zmianą stanu.

## 8. Zbuduj i wdroż Cloud Functions

W katalogu głównym:
~~~powershell
cd backend/functions
npm ci
npm run build
cd ../..
firebase deploy --project familycontrol-f4a9f --only functions
~~~

Wdrożenie funkcji wymaga planu Blaze oraz aktywacji usług Google Cloud. Powinny pojawić się:
- ensureFamily,
- getServerTime,
- createTvPairingSession,
- claimPairingSession,
- revokeAnonymousTv,
- triggery audytu i powiadomień.

Po wdrożeniu sprawdź Firebase Console → Functions.

## 9. Zbuduj APK

Aplikacja TV:
~~~powershell
cd tv
.\gradlew.bat assembleDebug
~~~
Wynik: tv/app/build/outputs/apk/debug/app-debug.apk

Aplikacja rodzica Android:
~~~powershell
cd ..
cd mobile
flutter pub get
flutter build apk --debug
cd ..
~~~
Wynik: mobile/build/app/outputs/flutter-apk/app-debug.apk

## 10. Instalacja i parowanie

Włącz debugowanie ADB na telewizorze:
~~~powershell
adb connect ADRES_IP_TV:5555
adb install -r .\tv\app\build\outputs\apk\debug\app-debug.apk
~~~

Zainstaluj aplikację rodzica na telefonie. Następnie:
1. Otwórz Family Control TV na TCL.
2. TV zaloguje się anonimowo i pokaże kod QR.
3. Zarejestruj konto rodzica lub zaloguj się w aplikacji mobilnej.
4. Zeskanuj kod QR przyciskiem Dodaj telewizor.
5. Po zatwierdzeniu TV pojawi się na ekranie głównym telefonu.
6. Przetestuj blokadę, odblokowanie z telefonu, dodanie czasu oraz PIN 6744.

## 11. Tryb kiosk / Device Owner — ograniczenia TCL

Sama aplikacja może pokazać własny ekran blokady. Nie może zagwarantować blokady HOME, ustawień systemowych ani innych aplikacji.

Pełny Lock Task Mode wymaga, aby aplikacja była dopuszczona przez Device Owner. Na dedykowanym, testowym telewizorze po factory reset (przed dodaniem kont użytkowników) można spróbować:
~~~powershell
adb install -r .\tv\app\build\outputs\apk\debug\app-debug.apk
adb shell dpm set-device-owner pl.familycontrol.tv/.FamilyDeviceAdminReceiver
~~~

To polecenie może zostać odrzucone przez firmware TCL. Provisioning może wymagać resetu fabrycznego. Nie wykonuj go na telewizorze, którego konfiguracji nie możesz stracić. Nie używaj rootowania ani exploitów.

## 12. Najczęstsze problemy

firebase: command not found
Uruchom ponownie PowerShell po instalacji Firebase CLI.

flutterfire: command not found
Dodaj %LOCALAPPDATA%\Pub\Cache\bin do PATH.

No Firebase App [DEFAULT] has been created
Uruchom flutterfire configure w katalogu mobile i sprawdź, czy istnieje mobile/lib/firebase_options.dart.

TV nie tworzy kodu parowania
Sprawdź Anonymous Authentication, internet TV i wdrożenie Cloud Functions.

PERMISSION_DENIED podczas parowania lub komend
Wdróż aktualne reguły i funkcje. Sprawdź, czy konto rodzica ma users/{uid} z role=parent oraz familyId.

FAILED_PRECONDITION przy query commands
Wdróż firebase/firestore.indexes.json i poczekaj, aż indeks będzie gotowy.

TV można wyjść przyciskiem HOME
Firmware nie przyznał aplikacji Device Owner / Lock Task. Ekran aplikacji nie jest blokadą całego systemu.
