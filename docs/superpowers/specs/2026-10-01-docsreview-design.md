# DocsReview: projekt (spec)

Data: 2026-10-01
Status: do akceptacji

## 1. Cel

DocsReview to lokalne narzędzie do review plików Markdown pisanych dla agentów AI lub przez agentów (skille, dokumentacja, ADR, specyfikacje). Recenzent ogląda surowy markdown obok wersji wyrenderowanej, dodaje komentarze do linii i kopiuje wygenerowany output, który wkleja agentowi do poprawy. Po poprawkach wraca, widzi co się zmieniło, i zamyka komentarze.

**Użytkownik:** jedna osoba pracująca lokalnie. Narzędzie ma dać się łatwo udostępnić innym jako paczka npm, ale nie ma kont ani współdzielenia komentarzy.

**Kryterium sukcesu:** jedna komenda w katalogu projektu otwiera przeglądarkę; recenzent przegląda pliki `.md`, komentuje w obu panelach, kopiuje output w formacie `### {ścieżka}:{linia} > {treść}`, a po poprawkach agenta widzi zmienione linie przy swoich komentarzach i je rozwiązuje.

## 2. Decyzje

| Temat | Decyzja |
|---|---|
| Architektura | Lokalny serwer Node + frontend Vue 3 w przeglądarce, jedna paczka npm |
| Uruchamianie | `npx docsreview [katalog]`, domyślnie bieżący katalog |
| Cykl życia komentarzy | Rundy: komentarze są trwałe i mają status otwarty / rozwiązany |
| Widok zmian | Znaczniki zmienionych linii w panelach RAW i RENDER, bez osobnego trybu diff |
| Miejsce zapisu stanu | `~/.docsreview/`, osobno dla każdego recenzowanego katalogu |
| Okno outputu | Osobny widok „Review” (zakładka w nagłówku) |
| Recenzowane pliki | Tylko do odczytu; narzędzie nigdy ich nie modyfikuje |
| Język interfejsu | Polski; teksty w jednym module, bez biblioteki i18n |

## 3. Architektura

### 3.1 Uruchamianie

```
npx docsreview [katalog] [--port <n>] [--no-open]
```

- Bez argumentu katalogiem roboczym jest bieżący katalog.
- Serwer nasłuchuje wyłącznie na `127.0.0.1`. Domyślny port to 4477; jeśli jest zajęty, serwer bierze kolejny wolny.
- Po starcie serwer wypisuje pełny adres (z tokenem) i otwiera go w domyślnej przeglądarce, chyba że podano `--no-open`.
- Jeśli katalog nie istnieje lub nie da się go odczytać, proces kończy się komunikatem błędu i kodem 1.
- Wymagany Node 20 lub nowszy.

### 3.2 Części systemu

Jedna paczka npm w TypeScripcie:

```
src/
  core/        logika bez dostępu do dysku i sieci
    types.ts
    anchors.ts     mapowanie linii między migawką a obecną treścią
    output.ts      generowanie outputu komentarzy
  server/
    cli.ts         parsowanie argumentów, start, otwarcie przeglądarki
    app.ts         trasy HTTP (hono) i SSE
    security.ts    token i kontrola nagłówka Host, walidacja ścieżek
    scanner.ts     wyszukiwanie plików .md
    watcher.ts     obserwowanie zmian (chokidar)
    store.ts       odczyt i atomowy zapis state.json, recent.json
    snapshots.ts   zapis, odczyt i sprzątanie migawek
  web/
    main.ts, App.vue
    api.ts         klient REST i SSE
    strings.ts     teksty interfejsu
    lib/
      render.ts        markdown-it z atrybutami linii źródłowych
      frontmatter.ts   wykrywanie i podział frontmattera
      scrollSync.ts    synchronizacja przewijania paneli
    components/
      FileTree.vue, RawPane.vue, RenderPane.vue,
      CommentThread.vue, CommentForm.vue,
      ReviewView.vue, DirPicker.vue
tests/
```

- **Serwer** jest źródłem prawdy: skanuje katalog, czyta pliki, obserwuje zmiany, zapisuje stan i wylicza aktualne pozycje komentarzy.
- **Frontend** jest budowany przez Vite do statycznych plików dołączonych do paczki i serwowanych przez ten sam serwer. Stan aplikacji trzymają composables Vue; bez Pinia i bez vue-router. Wybrana zakładka i plik są zapisane w hashu adresu URL, żeby przetrwały odświeżenie.
- **`core`** nie importuje niczego z `server` ani `web` i jest testowany samymi danymi.

### 3.3 Biblioteki

| Biblioteka | Zastosowanie |
|---|---|
| `hono`, `@hono/node-server` | serwer HTTP |
| `chokidar` | obserwowanie plików |
| `open` | otwarcie przeglądarki |
| `diff` | porównanie linii (`diffArrays`) |
| `vue`, `vite` | frontend |
| `markdown-it` | renderowanie z mapą linii źródłowych |
| `vitest`, `@playwright/test` | testy |

### 3.4 Wykrywanie plików

- Skan rekurencyjny wybranego katalogu, tylko pliki z rozszerzeniem `.md` (bez rozróżniania wielkości liter).
- Pomijane katalogi: `.git`, `node_modules`. Pozostałe ukryte katalogi (`.claude`, `.cursor` i podobne) są skanowane.
- Dowiązania symboliczne nie są śledzone.
- Ścieżki w API i w stanie są względne do wybranego katalogu, z separatorem `/`.

### 3.5 Bezpieczeństwo

- Przy starcie serwer generuje losowy token. Adres otwierany w przeglądarce zawiera `?token=…`.
- Każde żądanie `/api/*` wymaga nagłówka `Authorization: Bearer <token>`. Wyjątkiem jest strumień SSE, który przyjmuje token w parametrze zapytania, bo `EventSource` nie ustawia nagłówków. Brak lub błędny token daje 401.
- Serwer odrzuca (403) żądania, których nagłówek `Host` jest inny niż `127.0.0.1:<port>` lub `localhost:<port>`.
- Pliki statyczne frontendu są serwowane bez tokenu.
- Treść można odczytać tylko dla plików `.md`, których rzeczywista ścieżka (po `realpath`) leży wewnątrz wybranego katalogu. Inne żądania dają 403.
- Przeglądarka katalogów zwraca wyłącznie nazwy podkatalogów, nigdy treść plików.
- markdown-it działa z `html: false`: znaczniki HTML i XML z recenzowanych plików są pokazywane jako tekst, nie wykonywane.

## 4. API

Wszystkie odpowiedzi są w JSON. Numery linii są liczone od 1.

| Metoda i ścieżka | Działanie |
|---|---|
| `GET /api/session` | Zwraca `{ root, recent }`: aktualny katalog i ostatnio używane |
| `POST /api/root` `{ path }` | Zmienia katalog roboczy; restartuje skaner i obserwatora. 400, jeśli katalog nie istnieje lub jest nieczytelny (poprzedni katalog zostaje) |
| `GET /api/dirs?path=` | Zwraca podkatalogi podanej ścieżki oraz ścieżkę rodzica; bez `path` startuje od katalogu domowego |
| `GET /api/files` | Zwraca listę plików `.md`; dla każdego `{ path, openComments, changed }` |
| `GET /api/file?path=` | Zwraca widok pliku (niżej) |
| `POST /api/comments` `{ file, line, text, contentHash }` | Dodaje komentarz. 409, jeśli `contentHash` nie zgadza się z obecną treścią pliku |
| `PATCH /api/comments/:id` `{ text?, status? }` | Edytuje treść lub zmienia status |
| `DELETE /api/comments/:id` | Usuwa komentarz |
| `DELETE /api/comments?status=resolved` | Usuwa wszystkie rozwiązane komentarze |
| `GET /api/review` | Zwraca wszystkie komentarze z aktualnymi pozycjami oraz gotowy tekst outputu |
| `GET /api/events?token=` | SSE; zdarzenie `files-changed` z listą ścieżek |

**Widok pliku (`GET /api/file`):**

```json
{
  "path": "docs/adr/0001-storage.md",
  "content": "…",
  "contentHash": "<sha256>",
  "tooLarge": false,
  "changedLines": [13],
  "comments": [
    {
      "id": "…", "text": "podaj komendę npx", "status": "open",
      "createdAt": "…", "resolvedAt": null,
      "currentLine": 13, "lineChanged": true,
      "originalLineText": "Uruchom `npm start`"
    }
  ]
}
```

Dla plików powyżej 1 MB `tooLarge` ma wartość `true`, a frontend pokazuje tylko panel RAW z informacją, dlaczego nie ma renderowania.

**Obserwowanie zmian:** obserwator zbiera zdarzenia dodania, zmiany i usunięcia plików `.md`, grupuje je w oknie 100 ms i wysyła jedno zdarzenie `files-changed`. Frontend pobiera wtedy ponownie listę plików, a jeśli zmiana dotyczy otwartego pliku lub widoku „Review”, także ich dane.

## 5. Interfejs

Nagłówek zawiera: nazwę narzędzia, zakładki **Pliki** i **Review (N)** (N to liczba otwartych komentarzy w całym katalogu), ścieżkę aktualnego katalogu i przycisk „Zmień katalog”.

### 5.1 Zmiana katalogu

„Zmień katalog” otwiera okno z listą ostatnio używanych katalogów oraz przeglądarką katalogów obsługiwaną przez serwer (wejście do podkatalogu, wyjście wyżej, „Wybierz ten katalog”). Po wyborze narzędzie ładuje stan review tego katalogu.

### 5.2 Widok „Pliki”

Trzy kolumny: lista plików, panel RAW, panel RENDER.

**Lista plików**
- Drzewo katalogów zawierające tylko pliki `.md`.
- Przy pliku: licznik otwartych komentarzy oraz znacznik zmiany, jeśli plik ma otwarte komentarze i jego treść różni się od punktu odniesienia (punkt 6.4).
- Gdy katalog nie zawiera plików `.md`, zamiast kolumn widać pusty stan z przyciskiem „Zmień katalog”.

**Panel RAW**
- Każda linia pliku to wiersz z numerem.
- Po najechaniu na linię pojawia się „+”. Kliknięcie otwiera pod linią pole tekstowe. `Cmd/Ctrl+Enter` zapisuje, `Esc` anuluje. Pusty komentarz nie jest zapisywany.
- Linie z `changedLines` mają podświetlenie i pasek na marginesie.

**Panel RENDER**
- Markdown wyrenderowany przez markdown-it. Każdy blok ma atrybuty `data-line-start` i `data-line-end` z zakresu linii źródłowych.
- Bloki, do których można dodać komentarz: nagłówek, akapit, element listy, wiersz tabeli, blok kodu, cytat, blok HTML pokazany jako tekst, linia pozioma. Przy zagnieżdżeniu „+” dotyczy najbardziej wewnętrznego bloku.
- Komentarz dodany w RENDER przypina się do pierwszej linii źródłowej bloku.
- Blok jest oznaczony jako zmieniony, jeśli jego zakres zawiera którąkolwiek linię z `changedLines`.
- **Frontmatter:** jeśli plik zaczyna się od bloku `---` … `---`, RENDER pokazuje go jako tabelę klucz–wartość. Wiersz tabeli odpowiada linii zaczynającej klucz najwyższego poziomu; linie kontynuacji należą do poprzedniego klucza. Podział jest liniowy, bez parsera YAML. Jeśli blok nie ma zamykającego `---`, plik jest renderowany w całości jako zwykły markdown.

**Komentarze w panelach**
- Ten sam komentarz jest widoczny pod swoją linią w RAW i pod blokiem, którego zakres zawiera tę linię, w RENDER.
- Komentarz pokazuje status, treść i akcje: „Edytuj”, „Usuń”, „Rozwiąż” (dla otwartych) lub „Otwórz ponownie” (dla rozwiązanych).
- Komentarz z `lineChanged: true` ma dodatkowo oznaczenie „linia zmieniona” i wiersz „było: {oryginalna treść linii}”.
- Rozwiązane komentarze są domyślnie ukryte; przełącznik „Pokaż rozwiązane” nad panelami je odsłania.

**Przewijanie**
- Panele są zsynchronizowane według linii źródłowych: pierwsza widoczna linia w przewijanym panelu wyznacza pozycję drugiego. Synchronizacja ignoruje zdarzenia przewijania, które sama wywołała.

### 5.3 Widok „Review”

Dwie kolumny.

**Lewa: lista komentarzy**
- Wszystkie komentarze z katalogu, pogrupowane według plików, z filtrem: otwarte (domyślnie) / rozwiązane / wszystkie.
- Wiersz pokazuje `{ścieżka}:{aktualna linia}`, treść, status i oznaczenia „linia zmieniona” lub „plik nie istnieje”.
- Kliknięcie wiersza przełącza na widok „Pliki”, otwiera plik i przewija do linii. Dla komentarza do nieistniejącego pliku kliknięcie nic nie robi.
- Akcje przy wierszu: „Rozwiąż” / „Otwórz ponownie”, „Usuń”. Nad listą: „Usuń rozwiązane”.

**Prawa: output**
- Pole tylko do odczytu z wygenerowanym tekstem oraz przycisk „Kopiuj”, który kopiuje całość do schowka i potwierdza to krótkim komunikatem.
- Gdy nie ma otwartych komentarzy, pole pokazuje informację „Brak otwartych komentarzy”, a „Kopiuj” jest nieaktywny.

### 5.4 Format outputu

- Do outputu trafiają tylko otwarte komentarze do istniejących plików.
- Kolejność: ścieżka pliku (porównanie znak po znaku), potem aktualny numer linii, potem data utworzenia.
- Każdy komentarz ma postać:

  ```
  ### {ścieżka}:{linia} > {treść}
  ```

- Ścieżka jest względna do wybranego katalogu. Numer linii to aktualna pozycja komentarza (punkt 6.3).
- Treść jest wstawiana bez nawiasów kwadratowych. Jeśli ma wiele linii, pierwsza trafia po `> `, a kolejne są dopisane pod spodem bez zmian.
- Komentarze są oddzielone jedną pustą linią. Output nie ma pustej linii na końcu.

Przykład:

```
### .claude/skills/deploy/SKILL.md:13 > podaj komendę npx

### docs/adr/0001-storage.md:8 > uzasadnij wybór
```

## 6. Model danych i rundy

### 6.1 Pliki stanu

```
~/.docsreview/
  recent.json                         ostatnio używane katalogi (maks. 10)
  reviews/
    <nazwa-katalogu>-<hash>/          hash = pierwsze 12 znaków sha256 ścieżki bezwzględnej
      state.json
      snapshots/
        <sha256 treści>.md
```

- Zapis `state.json` i `recent.json` jest atomowy: zapis do pliku tymczasowego i zmiana nazwy.
- Migawki są deduplikowane po hashu treści. Po każdym usunięciu komentarza serwer kasuje migawki, do których nie odwołuje się żaden komentarz.

### 6.2 `state.json`

```json
{
  "version": 1,
  "root": "/Users/x/Projects/my-agent",
  "comments": [
    {
      "id": "<uuid>",
      "file": "docs/adr/0001-storage.md",
      "text": "uzasadnij wybór",
      "status": "open",
      "createdAt": "2026-10-01T12:00:00.000Z",
      "resolvedAt": null,
      "anchor": {
        "snapshot": "<sha256 treści pliku w chwili dodania>",
        "line": 8,
        "lineText": "Wybieramy SQLite."
      }
    }
  ]
}
```

- `status` to `open` albo `resolved`.
- Kotwica (`anchor`) nie zmienia się nigdy po utworzeniu komentarza: ani przy edycji treści, ani przy zmianie statusu.

### 6.3 Aktualna pozycja komentarza

Moduł `core/anchors.ts` dostaje linie migawki, linie obecnej treści i numer linii w migawce, a zwraca `{ currentLine, lineChanged }`. Pliki są dzielone na linie po `\n`; końcowe `\r` jest usuwane, a końcowy znak nowej linii nie tworzy dodatkowej pustej linii.

Porównanie robi `diffArrays` na tablicach linii. Reguły:

1. **Linia leży we fragmencie niezmienionym:** `currentLine` to jej nowa pozycja, `lineChanged = false`.
2. **Linia leży we fragmencie usuniętym, po którym bezpośrednio następuje fragment dodany (zamiana):** `currentLine` to linia fragmentu dodanego o tym samym przesunięciu co linia w usuniętym, ograniczona do ostatniej linii fragmentu dodanego. `lineChanged = true`.
3. **Linia leży we fragmencie usuniętym bez następującego dodania:** `currentLine` to linia, która teraz następuje po miejscu usunięcia; jeśli usunięto koniec pliku, to ostatnia linia pliku. `lineChanged = true`.
4. **Plik jest pusty:** `currentLine = 1`, `lineChanged = true`.

Jeśli migawka i obecna treść mają ten sam hash, serwer pomija porównanie.

### 6.4 Zmienione linie pliku

- Punktem odniesienia pliku jest migawka najstarszego otwartego komentarza w tym pliku.
- `changedLines` to numery obecnych linii leżących we fragmentach dodanych względem punktu odniesienia.
- Czyste usunięcia nie mają własnego znacznika w panelach; widać je przez „linia zmieniona” i „było: …” przy komentarzu.
- Jeśli plik nie ma otwartych komentarzy, `changedLines` jest puste.

### 6.5 Przebieg rundy

Nie ma jawnego obiektu „runda”. Cykl wynika z migawek:

1. Recenzent dodaje komentarze. Serwer zapisuje migawkę treści pliku przy każdym komentarzu.
2. Recenzent kopiuje output z widoku „Review” i wkleja go agentowi.
3. Agent zmienia pliki. Obserwator wysyła `files-changed`, frontend odświeża dane.
4. Komentarze przesuwają się na aktualne pozycje. Te, których linia się zmieniła, mają oznaczenie „linia zmieniona” i „było: …”; zmienione linie są podświetlone w obu panelach.
5. Recenzent rozwiązuje komentarze, które uznaje za załatwione. Pozostałe trafiają do kolejnego outputu z aktualnymi numerami linii.
6. Nowe komentarze dodane w tej fazie dostają migawkę bieżącej treści.

### 6.6 Przypadki brzegowe

- **Plik usunięty lub przeniesiony:** komentarze zostają w stanie. W widoku „Review” mają oznaczenie „plik nie istnieje”, nie trafiają do outputu i nie liczą się do licznika w zakładce. Można je rozwiązać lub usunąć. Jeśli plik wróci pod tą samą ścieżką, komentarze znów są aktywne.
- **Plik zmienił się między wyświetleniem a zapisem komentarza:** serwer odpowiada 409. Frontend odświeża widok pliku, zostawia otwarte pole z wpisanym tekstem i pokazuje komunikat, że plik się zmienił i trzeba potwierdzić linię.
- **Brakująca migawka** (ręcznie usunięta z dysku): komentarz zostaje na numerze linii z kotwicy, ograniczonym do długości pliku, z `lineChanged = true`.

## 7. Obsługa błędów

| Sytuacja | Zachowanie |
|---|---|
| Katalog startowy nie istnieje lub brak uprawnień | Komunikat w terminalu, kod wyjścia 1 |
| Zmiana katalogu w UI na nieistniejący lub nieczytelny | Komunikat w oknie wyboru; poprzedni katalog zostaje |
| Brak plików `.md` | Pusty stan z przyciskiem „Zmień katalog” |
| `state.json` nie jest poprawnym JSON-em lub ma nieznaną wersję | Serwer zmienia jego nazwę na `state.json.broken-<data>`, startuje z pustym stanem i zwraca ostrzeżenie pokazywane w UI |
| Zerwane połączenie z serwerem | Baner „Brak połączenia”, automatyczne ponawianie SSE; dodawanie i edycja komentarzy są zablokowane do powrotu połączenia |
| Plik większy niż 1 MB | Tylko panel RAW, z informacją o braku renderowania |
| Zajęty port | Kolejny wolny port |
| Błąd zapisu stanu (np. brak miejsca) | Odpowiedź 500; frontend pokazuje komunikat i nie zmienia widoku komentarza |

## 8. Testy

**Jednostkowe (Vitest)**
- `core/anchors.ts`: linia bez zmian, linia przesunięta w dół i w górę, linia zmieniona, linia usunięta w środku i na końcu pliku, zamiana wielu linii na mniej linii, pusty plik, identyczna treść, końce linii `\r\n`.
- `core/output.ts`: sortowanie, komentarz wieloliniowy, pominięcie rozwiązanych i komentarzy do nieistniejących plików, brak komentarzy.
- `web/lib/render.ts`: zakresy linii dla nagłówka, akapitu, listy zagnieżdżonej, tabeli, bloku kodu i cytatu; znaczniki HTML pokazane jako tekst.
- `web/lib/frontmatter.ts`: poprawny frontmatter, wartości wieloliniowe, brak zamykającego `---`, plik bez frontmattera.
- `server/scanner.ts`: pomijanie `.git` i `node_modules`, uwzględnianie `.claude`, nieśledzenie dowiązań.

**Integracyjne serwera (Vitest, katalog tymczasowy, `~/.docsreview` przekierowane do katalogu tymczasowego)**
- Dodanie komentarza, zmiana pliku na dysku, sprawdzenie `currentLine`, `lineChanged` i `changedLines`.
- 409 przy niezgodnym `contentHash`.
- 401 bez tokenu, 403 przy obcym nagłówku `Host`, 403 przy ścieżce poza katalogiem i przy pliku innym niż `.md`.
- Uszkodzony `state.json` jest odkładany, a serwer startuje z pustym stanem.
- Sprzątanie nieużywanych migawek po usunięciu komentarza.

**End-to-end (Playwright)**
- Jeden scenariusz pełnej rundy: komentarz w RAW, komentarz w RENDER, sprawdzenie outputu w widoku „Review”, zmiana pliku na dysku, sprawdzenie oznaczenia „linia zmieniona”, „Rozwiąż”, sprawdzenie że komentarz zniknął z outputu.

## 9. Poza zakresem MVP

- Edycja plików `.md` w narzędziu.
- Komentarze do zakresu linii, wątki i odpowiedzi.
- Osobny tryb diff i historia rund.
- Formaty inne niż `.md`.
- Publikacja w npm. Struktura paczki (`bin`, zbudowany frontend w paczce) jest na nią gotowa; na start narzędzie uruchamia się lokalnie przez `npm link` lub `npx <ścieżka>`.
- Bezpośrednia integracja z agentem (czytanie stanu przez agenta zamiast wklejania outputu).
- Podświetlanie składni w panelu RAW.
- Tłumaczenia interfejsu.
