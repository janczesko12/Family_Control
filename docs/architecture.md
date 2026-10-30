# Architektura

## Przepływ sterowania

```text
Rodzic -> Firebase Auth -> Mobile -> families/{familyId}/devices/{deviceId}/commands/{commandId}
                                                   |
                                                   v
                                           Firestore listener
                                                   |
                                                   v
                                  TV stosuje komendę dokładnie raz
                                  -> aktualizuje device + command ack
                                  -> zapisuje history event
```

## Źródło prawdy dla czasu

TV utrzymuje sesję w oparciu o `sessionStartServerMillis`, `sessionEndServerMillis` i `usedSecondsToday`. Interfejs odświeża licznik często, ale wynik nie zależy wyłącznie od obiektu `Timer`. Po restarcie TV odtwarza sesję z trwałego stanu i ostatniej synchronizacji.

Jeśli urządzenie jest offline, TV może kontynuować wcześniej zatwierdzoną sesję, ale nie może zwiększyć przyznanego czasu. Polecenia oczekujące są rozpoznawane po `commandId`; ponowne dostarczenie nie wykonuje operacji drugi raz.

## Zabezpieczenie zegara

Każda synchronizacja zapisuje czas serwera oraz lokalne `SystemClock.elapsedRealtime()`. Przy zmianie zegara ściennego TV używa ostatniego znanego offsetu serwera. Dłuższy brak kontaktu z serwerem jest oznaczany jako `clockUntrusted`; polityka produkcyjna powinna wtedy zablokować TV po wyczerpaniu lokalnie zatwierdzonego okna, a rodzic musi ponownie zsynchronizować urządzenie.

## Stany polecenia

`pending -> processing -> acknowledged` albo `pending -> failed`. TV zapisuje `lastAppliedCommandId`, a backend nie przyznaje czasu automatycznie. Konflikt dwóch telefonów rozstrzyga kolejność serwerowa `createdAt`; aplikacja pokazuje wynik dopiero po ack z TV.

## Model danych

```text
users/{uid}
  familyId, role: parent

families/{familyId}
  name, parentIds[], createdAt

families/{familyId}/devices/{deviceId}
  name, platform, tvUid, isLocked, remainingSeconds,
  dailyLimitSeconds, usedSecondsToday, lastSyncAt, lastSeenAt,
  lockReason, lastAppliedCommandId, clockTrusted

families/{familyId}/devices/{deviceId}/commands/{commandId}
  type, payload, createdBy, createdAt, status, appliedAt, error

families/{familyId}/devices/{deviceId}/history/{eventId}
  type, actor, reason, createdAt, usedSeconds

pairingSessions/{sessionId}
  codeHash, tvUid, expiresAt, claimedBy, deviceId, status
```

