# Konfiguracja Firebase

1. Utwórz projekt Firebase i skonfiguruj region Functions zgodny z wymaganiami rodziny.
2. Włącz Authentication: Email/Password dla rodziców oraz Anonymous dla TV.
3. Utwórz Firestore w trybie produkcyjnym.
4. Zainstaluj Firebase CLI i wykonaj `firebase login`, a potem `firebase use <project-id>`.
5. Włącz App Check dla aplikacji mobilnej i TV przed produkcją.
6. W `mobile/` uruchom `flutterfire configure` i wygeneruj `lib/firebase_options.dart`.
7. Pobierz `google-services.json` dla aplikacji Android TV i umieść go w `tv/app/`.
8. Wdróż reguły: `firebase deploy --only firestore:rules,firestore:indexes`.
9. Wdróż funkcje: `cd backend/functions && npm ci && npm run build && firebase deploy --only functions`.

## Brak sekretów w repozytorium

Nie commituj `google-services.json` zawierającego konfigurację produkcyjną, plików `firebase-adminsdk-*.json`, haseł ani tokenów CI. Firebase client config nie jest sekretem, ale ogranicz go regułami, App Check i właściwymi identyfikatorami pakietów.

## Rodzina i rodzic

Po rejestracji funkcja `ensureFamily` tworzy dokument `users/{uid}` oraz rodzinę, jeśli użytkownik nie ma jeszcze `familyId`. Kolejny rodzic powinien być zapraszany osobnym, jednorazowym procesem — nie przez ręczne dopisywanie `parentIds` z klienta.

