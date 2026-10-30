# Budowanie

## Mobile Flutter

```powershell
cd mobile
flutter pub get
flutterfire configure
flutter analyze
flutter test
flutter build apk --release
flutter build ios --release
```

Build iOS wymaga macOS/Xcode. `firebase_options.dart` jest generowany przez FlutterFire i nie powinien być zastępowany przykładowym plikiem bez konfiguracji.

## TV Kotlin

```powershell
cd tv
.\gradlew.bat assembleDebug
adb install app\build\outputs\apk\debug\app-debug.apk
```

Do pierwszego uruchomienia potrzebny jest JDK 17 oraz Android SDK z platformą Android 35. Konfigurację Firebase dostarcza `google-services.json`.

