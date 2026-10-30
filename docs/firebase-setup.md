# Konfiguracja Firebase — Family Control TV

Family Control używa Firebase Authentication i Firestore. Backend HTTP działa na Cloudflare Workers, więc nie trzeba wdrażać Firebase Cloud Functions ani aktywować planu Blaze tylko z tego powodu.

## 1. Włącz logowanie

W Firebase Console → Authentication → Sign-in method włącz:
- Email/Password — dla aplikacji rodzica,
- Anonymous — dla aplikacji na telewizorze.

Nie wyłączaj Anonymous Authentication — TV używa anonimowego konta do identyfikacji.

## 2. Utwórz Firestore

W Firebase Console → Build → Firestore Database utwórz bazę w trybie produkcyjnym. Wybierz docelową lokalizację ostrożnie, ponieważ lokalizacji bazy nie można łatwo zmienić.

## 3. Dodaj aplikację Android TV

W Firebase Console → Project settings → Your apps dodaj aplikację Android o pakiecie:

\`pl.familycontrol.tv\`

Pobierz \`google-services.json\` i umieść go w:

\`tv/app/google-services.json\`

## 4. Dodaj aplikację rodzica

Dodaj osobną aplikację Android o pakiecie:

\`com.familycontrol.app\`

Umieść jej własny \`google-services.json\` w:

\`mobile/android/app/google-services.json\`

Nie kopiuj konfiguracji TV do aplikacji rodzica.

## 5. Skonfiguruj FlutterFire

W PowerShell:

~~~powershell
cd mobile
flutter pub get
flutterfire configure --project=familycontrol-f4a9f --platforms=android,ios
~~~

Plik \`mobile/lib/firebase_options.dart\` jest lokalną konfiguracją generowaną dla projektu. Nie commituj go.

Dla iOS wymagane jest środowisko macOS/Xcode. Włącz Push Notifications w Xcode i skonfiguruj APNs Authentication Key w Firebase Console → Project settings → Cloud Messaging, jeżeli chcesz otrzymywać powiadomienia push na iPhonie.

## 6. Wdróż reguły i indeksy Firestore

Wróć do katalogu głównego:

~~~powershell
cd ..
firebase use familycontrol-f4a9f
firebase deploy --project familycontrol-f4a9f --only firestore:rules,firestore:indexes
~~~

Reguły blokują nadawanie roli rodzica przez klienta oraz bezpośrednie tworzenie poleceń. Tworzenie rodziny, parowanie, komendy i powiadomienia realizuje Cloudflare Worker.

## 7. Wdróż backend na Cloudflare

Instrukcja utworzenia konta serwisowego, dodania sekretu i wdrożenia API:

[docs/cloudflare-worker-setup.md](cloudflare-worker-setup.md)

Po wdrożeniu Workera zbuduj aplikacje, przekazując mu adres \`workers.dev\`:
- Flutter: \`--dart-define=FAMILY_CONTROL_API_URL=https://...workers.dev\`
- TV: \`-PworkerApiUrl=https://...workers.dev\`

Nie uruchamiaj \`firebase deploy --only functions\` — Cloud Functions zostały zastąpione przez Cloudflare Worker.
