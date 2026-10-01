---
status: accepted
---

# Runda jest wyznaczana przekazaniem, a pamiętane jest tylko ostatnie

Recenzent ma widzieć, co agent zmienił w odpowiedzi na ostatni output, także w drugiej i kolejnych rundach. Dlatego kliknięcie „Kopiuj” jest przekazaniem: zapamiętuje treść wszystkich widocznych plików review jako punkt odniesienia i przepina kotwice otwartych komentarzy na aktualny stan plików. Podświetlenia, „linia zmieniona” i „było: …” opisują zawsze zmiany od ostatniego przekazania. Starsze punkty odniesienia nie są przechowywane.

## Rozważane opcje

- **Punkt odniesienia z najstarszego otwartego komentarza w pliku (bez pojęcia rundy).** Prostsze, ale w drugiej rundzie nie da się odróżnić nowych zmian agenta od tych obejrzanych wcześniej, a zmiany w plikach bez komentarzy są niewidoczne.
- **Osobny przycisk „Zakończ rundę”.** Kopiowanie zostaje bez efektu ubocznego, ale recenzent musi pamiętać o dodatkowym kroku, a punkt odniesienia może rozjechać się z tym, co agent faktycznie dostał.
- **Historia wszystkich rund.** Pełny ślad zmian, ale wymaga przechowywania kopii plików z każdej rundy i interfejsu do ich przeglądania; historię plików ma już git.

## Konsekwencje

- „Kopiuj” ma efekt uboczny. Ponowne kliknięcie przed obejrzeniem poprawek agenta zaczyna nową rundę i gubi podświetlenia nieobejrzanych zmian. Częściowo chroni przed tym pytanie o komentarze do sprawdzenia.
- Pierwotna treść linii sprzed więcej niż jednej rundy nie jest dostępna w narzędziu.
- Ręczne zaznaczenie i skopiowanie tekstu outputu nie jest przekazaniem.
