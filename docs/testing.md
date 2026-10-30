# Plan testów Family Control

## Firebase i konto rodzica

- Rejestracja Email/Password.
- Logowanie istniejącego rodzica.
- ensureFamily tworzy rodzinę tylko raz.
- Zalogowany użytkownik nie może sam utworzyć/zmienić role ani familyId.
- Drugi użytkownik nie odczytuje dokumentów innej rodziny.

## Parowanie

- TV loguje się anonimowo i generuje kod.
- Rodzic skanuje QR.
- Prawidłowy kod tworzy pojedynczy dokument urządzenia i oznacza sesję jako claimed.
- Błędny kod zwiększa licznik prób.
- Po pięciu błędnych próbach sesja jest odrzucana.
- Wygasła lub ponownie użyta sesja nie może być przejęta.
- TV otrzymuje familyId i deviceId po zatwierdzeniu.

## Sterowanie i limity

- Rodzic zleca lock/unlock.
- Rodzic ustawia limit 1 minuty i obserwuje odliczanie.
- Rodzic dodaje czas w trakcie sesji.
- Polecenie ma commandId i jest rozliczone najwyżej raz.
- Zmiana remainingSeconds na większą wartość bez zatwierdzonego polecenia zostaje odrzucona.
- TV pobiera czas z getServerTime, a licznik używa zegara monotonicznego podczas działania procesu.
- Timer odtwarza stan na podstawie sessionEndServerMillis po ponownym uruchomieniu aplikacji.
- Wyłączenie internetu w trakcie sesji nie resetuje zapisanej daty końca; po powrocie sieci TV synchronizuje status.

## PIN

- PIN domyślny 6744 odblokowuje lokalny ekran TV.
- Nieprawidłowy PIN jest odrzucany.
- Pięć błędów powoduje blokadę prób na 60 sekund.
- PIN działa lokalnie bez telefonu i sieci.

## TCL / kiosk

- Zainstaluj APK na dokładnym modelu TCL i sprawdź zachowanie pilota.
- Sprawdź przycisk BACK.
- Sprawdź HOME przed i po konfiguracji Device Owner.
- Potwierdź, że dpm set-device-owner jest wspierane przez firmware.
- Bez Device Owner testuj tylko ekran blokady aplikacji, nie deklaruj blokady całego systemu.

## Weryfikacja techniczna przed użyciem

~~~powershell
cd backend/functions
npm ci
npm run build

cd ..\..
firebase deploy --project familycontrol-f4a9f --only firestore:rules,firestore:indexes,functions

cd mobile
flutter pub get
flutter analyze
flutter test

cd ..\tv
.\gradlew.bat assembleDebug
~~~

Wykonaj również testy Firestore Rules w Emulator Suite. Nie publikuj do produkcji, dopóki testy nie przejdą.
