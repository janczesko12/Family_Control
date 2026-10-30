# Plan testów akceptacyjnych

- ręczna blokada z telefonu: `pending -> acknowledged`, ekran TV zablokowany;
- ręczne odblokowanie z telefonu bez PIN-u TV;
- PIN `6744` offline i po restarcie aplikacji;
- niepoprawny PIN, pięć prób i blokada czasowa;
- automatyczne wyczerpanie limitu oraz zapis historii;
- restart TV w trakcie sesji;
- brak Internetu, lokalne odliczanie wcześniej zatwierdzonego czasu i synchronizacja po powrocie;
- dwa telefony wysyłające komendy jednocześnie;
- powtórne dostarczenie tego samego `commandId`;
- zmiana limitu i korekta sesji;
- wygasły kod parowania i ponowne parowanie;
- próba klienta TV zwiększenia czasu bez polecenia rodzica — powinna zostać odrzucona przez reguły;
- sprawdzenie `Device Owner` / Lock Task na konkretnym modelu TCL;
- próba HOME na urządzeniu bez Device Owner — komunikat ograniczenia musi pozostać prawdziwy.

