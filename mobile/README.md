# Family Control — aplikacja rodzica

Aplikacja Flutter do logowania rodzica, parowania telewizora przez QR i wysyłania poleceń blokady/czasu.

## Konfiguracja

W katalogu mobile:
~~~powershell
flutter pub get
dart pub global activate flutterfire_cli
flutterfire configure --project=familycontrol-f4a9f --platforms=android,ios
~~~

FlutterFire generuje lib/firebase_options.dart. Plik jest lokalną konfiguracją dla Firebase i nie jest dodawany do repozytorium.

Uruchom:
~~~powershell
flutter run
~~~

iOS wymaga macOS/Xcode. Jeżeli katalog ios/ nie istnieje, wygeneruj platformę poleceniem flutter create --platforms=ios ., a następnie dodaj opis użycia kamery w ios/Runner/Info.plist.
