# Family Control TV

Kompletny szkielet systemu kontroli rodzicielskiej dla telewizorów TCL z Android TV / Google TV oraz aplikacji rodzica Flutter. Projekt obejmuje synchronizację czasu, idempotentne polecenia, PIN offline, historię i reguły Firestore.

## Ważne ograniczenie platformy

TCL sprzedaje urządzenia z różnymi systemami: Android TV / Google TV, Roku TV oraz rozwiązaniami zależnymi od rynku i modelu. Ten projekt **nie zakłada**, że każdy TCL obsługuje Android TV. Przed instalacją odczytaj w telewizorze `Ustawienia → System → Informacje` i sprawdź model, region oraz dostęp do Google Play.

Pełne przejęcie przycisku HOME i blokada innych aplikacji jest możliwa tylko wtedy, gdy urządzenie da się przygotować jako dedykowane urządzenie Android z `Device Owner` i `Lock Task Mode`. Zwykła aplikacja TV potrafi zablokować własny ekran, ale nie może legalnie ukrywać HOME ani omijać zabezpieczeń systemu. Instrukcja i komunikat ograniczenia są w `docs/tcl-platform-limitations.md`.

## Zawartość

- `mobile/` — aplikacja Flutter rodzica: dashboard, limity, komendy, historia i status połączenia.
- `tv/` — aplikacja Kotlin/Compose na Android TV: parowanie, ekran blokady, PIN 6744, lokalny stan i odbiór komend.
- `backend/functions/` — Firebase Cloud Functions do tworzenia rodziny, sesji parowania i audytu.
- `firebase/` — reguły Firestore i indeksy.
- `docs/` — konfiguracja, bezpieczeństwo, budowanie i testy.

## Szybki start

1. Utwórz projekt Firebase, włącz Authentication (Email/Password i Anonymous), Firestore oraz Cloud Functions.
2. Skopiuj konfigurację Firebase do aplikacji Flutter przez `flutterfire configure`; dla TV dodaj `google-services.json` do `tv/app/`.
3. Wdróż reguły i funkcje zgodnie z `docs/firebase-setup.md`.
4. Zbuduj aplikację TV i zainstaluj ją na testowym Android TV. Przy pierwszym uruchomieniu TV pokaże jednorazową sesję parowania.
5. Zaloguj się w aplikacji rodzica i zeskanuj kod QR / wpisz kod sesji.

## Stan builda

Projekt jest skonfigurowany dla Firebase `familycontrol-f4a9f`. Reguły Firestore i indeksy są wdrożone. Gotowe APK znajdują się w `artifacts/`; szczegóły, sumy SHA-256 i ograniczenie wdrożenia Cloud Functions opisano w `docs/build-status.md`.

## Bezpieczeństwo

- PIN nie jest zapisywany w bazie jako zwykły tekst; TV przechowuje salt + PBKDF2 verifier.
- Telefon tworzy wyłącznie polecenia; TV nie może przyznać sobie czasu.
- Każde polecenie ma `commandId` i jest stosowane idempotentnie.
- Zmiany limitu i czasu powinny przechodzić przez autoryzowanego rodzica i reguły Firestore.
- Firebase App Check, rotacja tokenów i kopia zapasowa konfiguracji są wymagane przed produkcją.

