# TCL — zgodność i ograniczenia

## Sprawdź model przed instalacją

W telewizorze otwórz Ustawienia → System → Informacje i zanotuj pełny model, wersję Android TV / Google TV, wersję firmware i region.

TCL sprzedaje telewizory z różnymi systemami. APK Kotlin działa tylko na urządzeniach zgodnych z Android TV/Google TV. Nie jest aplikacją dla Roku TV.

## Blokada aplikacji a blokada systemu

Bez Device Owner aplikacja może:
- pokazać pełnoekranowy ekran blokady,
- przechwycić BACK we własnej aktywności,
- wrócić do własnego ekranu po ponownym uruchomieniu aplikacji.

Bez Device Owner nie może zagwarantować blokady HOME, ustawień, zmiany wejścia ani uruchamiania innych aplikacji.

KioskController sprawdza, czy aplikacja jest Device Owner, konfiguruje setLockTaskPackages() i dopiero wtedy uruchamia Lock Task. Przy odblokowaniu wywołuje stopLockTask().

## Provisioning Device Owner

To operacja administracyjna na dedykowanym urządzeniu. Może wymagać factory resetu i wykonania konfiguracji przed dodaniem kont użytkowników. Na testowym urządzeniu po instalacji APK i włączeniu ADB spróbuj:

~~~powershell
adb shell dpm set-device-owner pl.familycontrol.tv/.FamilyDeviceAdminReceiver
~~~

Nie wszystkie modele i wersje firmware TCL pozwalają na takie provisioning. Jeżeli polecenie zostanie odrzucone, pełny kiosk nie jest dostępny tą metodą na danym telewizorze. Nie używaj roota ani exploitów.

## Ważne

Nie deklaruj pełnej blokady telewizora na podstawie samego ekranu Compose. Weryfikuj HOME, BACK, ustawienia i przełączanie wejść fizycznym pilotem na konkretnym modelu.
