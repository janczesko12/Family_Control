# Status repozytorium

## Konfiguracja

- Firebase project ID zapisany w .firebaserc: familycontrol-f4a9f.
- Aplikacja TV: pl.familycontrol.tv.
- Aplikacja rodzica Android: com.familycontrol.app.
- Aplikacja rodzica i TV wymagają osobnych rejestracji w Firebase.
- Cloud Functions muszą być wdrożone po aktywacji planu Blaze.
- Aplikacja Flutter korzysta z mobile/lib/firebase_options.dart, generowanego lokalnie przez FlutterFire CLI.

## Ważne

Kod został poprawiony w repozytorium, ale kompilacja, testy integracyjne Firebase i test na fizycznym telewizorze nie są tutaj potwierdzone. Nie traktuj APK debug jako wydania produkcyjnego.

Weryfikację wykonaj zgodnie z docs/firebase-setup.md i docs/testing.md. APK publikuj w GitHub Releases. Nie commituj lokalnych konfiguracji ani artefaktów builda.
