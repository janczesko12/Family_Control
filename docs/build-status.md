# Status wdrożenia — 30.10.2026

## Firebase

- Projekt: `familycontrol-f4a9f` (`FamilyControl`).
- Aplikacja telefonu: `com.familycontrol.app`.
- Aplikacja TV: `pl.familycontrol.tv`.
- Reguły Firestore i indeksy zostały wdrożone poprawnie.
- Cloud Functions nie zostały wdrożone, ponieważ projekt wymaga planu Blaze do aktywacji Cloud Build i Artifact Registry. Kod Functions jest gotowy w `backend/functions/`.

## APK

- `artifacts/FamilyControl-TV-debug.apk` — instalowalny APK dla TCL Android TV 11, package `pl.familycontrol.tv`.
- `artifacts/FamilyControl-Android-release.apk` — APK telefonu, package `com.familycontrol.app`.

Oba APK mają poprawny podpis instalacyjny. APK telefonu jest podpisany kluczem debugowym użytym przez domyślną konfigurację Fluttera; przed publikacją należy skonfigurować własny keystore release.

SHA-256:

```text
FamilyControl-TV-debug.apk     65297D927F3990B1EDFDBF7754BAA101881FF686DE44D258A6B8D07D283BFF3A
FamilyControl-Android-release.apk AA5B3657C32106F70EE8E1E49364ACCD9AEFB0382A57261D49028F217DB56C64
```

## Instalacja

```powershell
adb install -r .\artifacts\FamilyControl-TV-debug.apk
adb install -r .\artifacts\FamilyControl-Android-release.apk
```

Przed pierwszym użyciem włącz w Firebase Authentication Email/Password i Anonymous. Cloud Functions trzeba wdrożyć po przełączeniu projektu na Blaze:

```powershell
firebase deploy --project familycontrol-f4a9f --only functions
```

