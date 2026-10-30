# TCL: zgodność i ograniczenia

## Co trzeba sprawdzić przed instalacją

1. Model i region telewizora.
2. System w `Ustawienia → System → Informacje`.
3. Czy istnieje Google Play i czy można włączyć debugowanie ADB.
4. Czy firmware pozwala na provisioning dedykowanego urządzenia / Device Owner.

## Obsługiwane założenie

Moduł `tv/` jest kierowany do Android TV / Google TV z możliwością instalacji APK. Google TV jest interfejsem na Android TV; nadal trzeba zweryfikować konkretny firmware TCL.

## Roku TV i inne systemy

Na TCL Roku TV aplikacja Kotlin APK nie jest instalowalna. Ten moduł nie próbuje sterować Roku przez prywatne API ani przez exploity. Dla Roku trzeba przygotować osobny, oficjalnie wspierany kanał integracji albo zastosować kontrolę na poziomie routera / konta, jeśli jest dostępna w danym regionie.

## Rzeczywista blokada

Bez Device Owner aplikacja może:

- wyświetlić ekran blokady w pełnym oknie,
- przechwycić BACK w obrębie własnej aktywności,
- wznowić się przy ponownym uruchomieniu aplikacji,
- blokować pilotowe przyciski nawigacyjne tylko we własnym UI.

Bez Device Owner nie może zagwarantować, że użytkownik nie naciśnie HOME, przełączy wejścia lub uruchomi inną aplikację. To jest ograniczenie Androida, nie błąd tego projektu.

Tryb kiosk jest aktywowany tylko, gdy system potwierdzi `isLockTaskPermitted`. Provisioning Device Owner jest operacją administracyjną i może wyczyścić urządzenie; wykonuj ją wyłącznie na dedykowanym, testowym telewizorze zgodnie z polityką producenta.

Po instalacji na wyzerowanym urządzeniu testowym można sprawdzić provisioning ADB poleceniem (wymaga Android SDK/ADB i braku istniejącego administratora):

```text
adb shell dpm set-device-owner pl.familycontrol.tv/.FamilyDeviceAdminReceiver
```

Jeśli firmware TCL odrzuci polecenie, pełny kiosk nie jest dostępny na tym modelu. Nie obchodź tego roota ani exploitami.

