# DocsReview: projekt (spec)

Data: 2026-10-01
Status: do akceptacji

Słownik pojęć jest w [`CONTEXT.md`](../../../CONTEXT.md). Decyzja o rundach jest opisana w [ADR 0001](../../adr/0001-runda-wyznaczana-przekazaniem.md).

## 1. Cel

DocsReview to lokalne narzędzie do review plików Markdown pisanych dla agentów AI lub przez agentów (skille, dokumentacja, ADR, specyfikacje). Recenzent ogląda surowy markdown obok wersji wyrenderowanej, dodaje komentarze do linii i kopiuje wygenerowany output, który wkleja agentowi do poprawy. Po poprawkach wraca, widzi co agent zmienił, i zamyka komentarze.

**Użytkownik:** jedna osoba pracująca lokalnie. Narzędzie ma dać się łatwo udostępnić innym jako paczka npm, ale nie ma kont ani współdzielenia komentarzy.

**Kryterium sukcesu:** jedna komenda w katalogu projektu otwiera przeglądarkę; recenzent przegląda pliki `.md`, komentuje w obu panelach, kopiuje output w formacie `### {ścieżka}:{linia} > {treść}`, a po poprawkach agenta widzi zmiany z tej rundy we wszystkich plikach i rozwiązuje komentarze.

## 2. Decyzje

| Temat | Decyzja |
|---|---|
| Architektura | Lokalny serwer Node + frontend Vue 3 w przeglądarce, jedna paczka npm |
| Uruchamianie | `npx docsreview [katalog]`, domyślnie bieżący katalog |
| Review | Jedno review na katalog roboczy; ścieżki zawsze względne do niego |
| Runda | Jawna; wyznacza ją przekazanie, czyli kliknięcie „Kopiuj”. Pamiętane jest tylko ostatnie przekazanie |
| Zakres rundy | Wszystkie pliki review, także bez komentarzy |
| Statusy komentarza | Otwarty / rozwiązany; rozwiązuje wyłącznie recenzent |
| Widok zmian | Znaczniki zmienionych linii w panelach RAW i RENDER, bez osobnego trybu diff |
| Komentarze w RENDER | W prozie do całego bloku, w bloku kodu do pojedynczej linii |
| Zakres plików | Pliki `.md` nieignorowane przez gita; przełącznik „Pokaż ignorowane” |
| Miejsce zapisu stanu | `~/.docsreview/`, osobno dla każdego katalogu roboczego |
| Okno outputu | Osobny widok „Komentarze” (zakładka w nagłówku) |
| Recenzowane pliki | Tylko do odczytu; narzędzie nigdy ich nie modyfikuje |
| Język interfejsu | Polski; teksty w jednym module, bez biblioteki i18n |

Zasada użycia wynikająca z definicji review: DocsReview uruchamia się w tym samym katalogu, w którym pracuje agent, żeby ścieżki w outpucie były dla niego poprawne.

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
    output.ts      generowanie outputu
    handoff.ts     przekazanie: przepięcie komentarzy i nowy punkt odniesienia
  server/
    cli.ts         parsowanie argumentów, start, otwarcie przeglądarki
    app.ts         trasy HTTP (hono) i SSE
    security.ts    token i kontrola nagłówka Host, walidacja ścieżek
    scanner.ts     wyszukiwanie plików .md
    ignore.ts      reguły ignorowania z plików .gitignore
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
      CommentsView.vue, DirPicker.vue
tests/
```

- **Serwer** jest źródłem prawdy: skanuje katalog, czyta pliki, obserwuje zmiany, zapisuje stan i wylicza aktualne pozycje komentarzy.
- **Serwer nie trzyma stanu review w pamięci.** Każda operacja czyta `state.json` z dysku, a zmiany zapisuje atomowo. Dzięki temu dwie instancje uruchomione na tym samym katalogu roboczym nie nadpisują sobie komentarzy.
- **Frontend** jest budowany przez Vite do statycznych plików dołączonych do paczki i serwowanych przez ten sam serwer. Stan aplikacji trzymają composables Vue; bez Pinia i bez vue-router. Wybrana zakładka i plik są zapisane w hashu adresu URL, żeby przetrwały odświeżenie.
- **`core`** nie importuje niczego z `server` ani `web` i jest testowany samymi danymi.

### 3.3 Biblioteki

| Biblioteka | Zastosowanie |
|---|---|
| `hono`, `@hono/node-server` | serwer HTTP |
| `chokidar` | obserwowanie plików |
| `ignore` | dopasowanie ścieżek do wzorców `.gitignore` |
| `open` | otwarcie przeglądarki |
| `diff` | porównanie linii (`diffArrays`) |
| `vue`, `vite` | frontend |
| `markdown-it` | renderowanie z mapą linii źródłowych |
| `vitest`, `@playwright/test` | testy |

### 3.4 Zakres plików

- Do review należą pliki z rozszerzeniem `.md` (bez rozróżniania wielkości liter) leżące w katalogu roboczym, wyszukiwane rekurencyjnie.
- Katalogi `.git` i `node_modules` są pomijane zawsze.
- Dowiązania symboliczne nie są śledzone.
- Ścieżki w API i w stanie są względne do katalogu roboczego, z separatorem `/`.

**Pliki ignorowane**
- Plik jest ignorowany, jeśli pasuje do wzorców z plików `.gitignore` leżących w katalogu roboczym, w jego podkatalogach albo w katalogach nadrzędnych aż do korzenia repozytorium (katalogu zawierającego `.git`). Globalna konfiguracja gita i `.git/info/exclude` nie są brane pod uwagę. Git nie jest wywoływany.
- Jeśli katalog roboczy nie leży w repozytorium, liczą się tylko pliki `.gitignore` w nim i w jego podkatalogach.
- Review ma ustawienie `showIgnored` (domyślnie wyłączone), sterowane przełącznikiem „Pokaż ignorowane”.
- **Plik widoczny** to plik nieignorowany, plik ignorowany przy włączonym `showIgnored` albo dowolny plik, który ma co najmniej jeden komentarz. Tylko pliki widoczne są w drzewie plików.
- Przy wyłączonym `showIgnored` skaner nie wchodzi do ignorowanych katalogów; pliki z komentarzami dołącza na podstawie ścieżek zapisanych w stanie.

### 3.5 Bezpieczeństwo

- Przy starcie serwer generuje losowy token. Adres otwierany w przeglądarce zawiera `?token=…`.
- Każde żądanie `/api/*` wymaga nagłówka `Authorization: Bearer <token>`. Wyjątkiem jest strumień SSE, który przyjmuje token w parametrze zapytania, bo `EventSource` nie ustawia nagłówków. Brak lub błędny token daje 401.
- Serwer odrzuca (403) żądania, których nagłówek `Host` jest inny niż `127.0.0.1:<port>` lub `localhost:<port>`.
- Pliki statyczne frontendu są serwowane bez tokenu.
- Treść można odczytać tylko dla plików `.md`, których rzeczywista ścieżka (po `realpath`) leży wewnątrz katalogu roboczego. Inne żądania dają 403.
- Przeglądarka katalogów zwraca wyłącznie nazwy podkatalogów, nigdy treść plików.
- markdown-it działa z `html: false`: znaczniki HTML i XML z recenzowanych plików są pokazywane jako tekst, nie wykonywane.

## 4. API

Wszystkie odpowiedzi są w JSON. Numery linii są liczone od 1.

| Metoda i ścieżka | Działanie |
|---|---|
| `GET /api/session` | Zwraca `{ root, recent, showIgnored, lastHandoffAt }` |
| `POST /api/root` `{ path }` | Zmienia katalog roboczy; restartuje skaner i obserwatora. 400, jeśli katalog nie istnieje lub jest nieczytelny (poprzedni katalog zostaje) |
| `GET /api/dirs?path=` | Zwraca podkatalogi podanej ścieżki oraz ścieżkę rodzica; bez `path` startuje od katalogu domowego |
| `PATCH /api/review` `{ showIgnored }` | Zmienia ustawienie review |
| `GET /api/files` | Zwraca widoczne pliki; dla każdego `{ path, openComments, ignored, roundStatus }` |
| `GET /api/file?path=` | Zwraca widok pliku (niżej) |
| `POST /api/comments` `{ file, line, text, contentHash }` | Dodaje komentarz. 409, jeśli `contentHash` nie zgadza się z obecną treścią pliku |
| `PATCH /api/comments/:id` `{ text?, status?, checked? }` | Edytuje treść, zmienia status albo potwierdza komentarz jako nadal aktualny (`checked: true`) |
| `DELETE /api/comments/:id` | Usuwa komentarz |
| `DELETE /api/comments?status=resolved` | Usuwa wszystkie rozwiązane komentarze |
| `GET /api/comments` | Zwraca wszystkie komentarze review z aktualnymi pozycjami oraz gotowy tekst outputu |
| `POST /api/handoff` | Wykonuje przekazanie (punkt 6.5). 409, jeśli nie ma otwartych komentarzy do istniejących plików |
| `GET /api/events?token=` | SSE; zdarzenia `files-changed` (lista ścieżek) i `review-changed` |

`roundStatus` ma wartość `unchanged`, `changed` albo `new` (punkt 6.4).

**Widok pliku (`GET /api/file`):**

```json
{
  "path": "docs/adr/0001-storage.md",
  "content": "…",
  "contentHash": "<sha256>",
  "tooLarge": false,
  "roundStatus": "changed",
  "changedLines": [13],
  "comments": [
    {
      "id": "…", "text": "podaj komendę npx", "status": "open",
      "createdAt": "…", "resolvedAt": null,
      "currentLine": 13, "lineChanged": true,
      "previousLineText": "Uruchom `npm start`",
      "handedOff": true, "needsCheck": true
    }
  ]
}
```

`GET /api/comments` zwraca komentarze w tym samym kształcie, uzupełnione o `file` i `fileMissing`.

Dla plików powyżej 1 MB `tooLarge` ma wartość `true`, a frontend pokazuje tylko panel RAW z informacją, dlaczego nie ma renderowania.

**Zdarzenia**
- Obserwator zbiera zdarzenia dodania, zmiany i usunięcia plików `.md` oraz zmiany plików `.gitignore`, grupuje je w oknie 100 ms i wysyła jedno zdarzenie `files-changed`.
- Serwer obserwuje też `state.json` bieżącego review i wysyła `review-changed` po każdej jego zmianie, także dokonanej przez inną instancję.
- Po każdym z tych zdarzeń frontend pobiera ponownie listę plików, a jeśli zmiana dotyczy otwartego pliku lub widoku „Komentarze”, także ich dane.

## 5. Interfejs

Nagłówek zawiera: nazwę narzędzia, zakładki **Pliki** i **Komentarze (N)**, ścieżkę katalogu roboczego i przycisk „Zmień katalog”. N to liczba otwartych komentarzy do istniejących plików w całym review.

### 5.1 Zmiana katalogu

„Zmień katalog” otwiera okno z listą ostatnio używanych katalogów oraz przeglądarką katalogów obsługiwaną przez serwer (wejście do podkatalogu, wyjście wyżej, „Wybierz ten katalog”). Po wyborze narzędzie ładuje review tego katalogu.

### 5.2 Widok „Pliki”

Trzy kolumny: drzewo plików, panel RAW, panel RENDER.

**Drzewo plików**
- Zawiera tylko pliki widoczne (punkt 3.4), w układzie katalogów.
- Nad drzewem jest przełącznik „Pokaż ignorowane”.
- Pliki ignorowane są wyszarzone. Katalogi ignorowane są domyślnie zwinięte. Zwinięcie katalogów jest pamiętane w `localStorage` przeglądarki.
- Przy pliku: licznik otwartych komentarzy oraz oznaczenie „zmieniony” albo „nowy” według `roundStatus`.
- Gdy katalog roboczy nie zawiera widocznych plików, zamiast kolumn widać pusty stan z przyciskiem „Zmień katalog”.

**Panel RAW**
- Każda linia pliku to wiersz z numerem.
- Po najechaniu na linię pojawia się „+”. Kliknięcie otwiera pod linią pole tekstowe. `Cmd/Ctrl+Enter` zapisuje, `Esc` anuluje. Pusty komentarz nie jest zapisywany.
- Linie z `changedLines` mają podświetlenie i pasek na marginesie.

**Panel RENDER**
- Markdown wyrenderowany przez markdown-it. Każdy blok ma atrybuty `data-line-start` i `data-line-end` z zakresu linii źródłowych.
- Bloki, do których można dodać komentarz: nagłówek, akapit, element listy, wiersz tabeli, cytat, blok HTML pokazany jako tekst, linia pozioma oraz pojedyncza linia bloku kodu. Przy zagnieżdżeniu „+” dotyczy najbardziej wewnętrznego bloku.
- **Proza:** komentarz dotyczy całego bloku i przypina się do jego pierwszej linii źródłowej.
- **Blok kodu:** każda linia kodu jest osobnym blokiem z własnym numerem linii źródłowej. Linie z otwierającym i zamykającym ```` ``` ```` nie są komentowalne w RENDER.
- Blok jest oznaczony jako zmieniony, jeśli jego zakres zawiera którąkolwiek linię z `changedLines`.
- **Frontmatter:** jeśli plik zaczyna się od bloku `---` … `---`, RENDER pokazuje go jako tabelę klucz–wartość. Wiersz tabeli odpowiada linii zaczynającej klucz najwyższego poziomu; linie kontynuacji należą do poprzedniego klucza. Podział jest liniowy, bez parsera YAML. Jeśli blok nie ma zamykającego `---`, plik jest renderowany w całości jako zwykły markdown.

**Komentarze w panelach**
- Ten sam komentarz jest widoczny pod swoją linią w RAW i pod blokiem, którego zakres zawiera tę linię, w RENDER.
- Komentarz pokazuje status, treść i akcje: „Edytuj”, „Usuń”, „Rozwiąż” (dla otwartych) lub „Otwórz ponownie” (dla rozwiązanych).
- Oznaczenia: „przekazany” (gdy `handedOff`), „linia zmieniona” z wierszem „było: {previousLineText}” (gdy `lineChanged`), „do sprawdzenia” z akcją „Nadal aktualny” (gdy `needsCheck`).
- Rozwiązane komentarze są domyślnie ukryte; przełącznik „Pokaż rozwiązane” nad panelami je odsłania.

**Przewijanie**
- Panele są zsynchronizowane według linii źródłowych: pierwsza widoczna linia w przewijanym panelu wyznacza pozycję drugiego. Synchronizacja ignoruje zdarzenia przewijania, które sama wywołała.

### 5.3 Widok „Komentarze”

Dwie kolumny.

**Lewa: lista komentarzy**
- Wszystkie komentarze review, z filtrem: otwarte (domyślnie) / rozwiązane / wszystkie.
- Na górze jest grupa „Do sprawdzenia” z komentarzami, które mają `needsCheck`. Pod nią pozostałe komentarze pogrupowane według plików.
- Wiersz pokazuje `{ścieżka}:{aktualna linia}`, treść, status i oznaczenia: „przekazany”, „linia zmieniona”, „plik nie istnieje”.
- Kliknięcie wiersza przełącza na widok „Pliki”, otwiera plik i przewija do linii. Dla komentarza do nieistniejącego pliku kliknięcie nic nie robi.
- Akcje przy wierszu: „Rozwiąż” / „Otwórz ponownie”, „Usuń”, a dla komentarzy do sprawdzenia także „Nadal aktualny”. Nad listą: „Usuń rozwiązane”.

**Prawa: output i przekazanie**
- Pole tylko do odczytu z outputem oraz przycisk „Kopiuj”.
- Gdy nie ma otwartych komentarzy do istniejących plików, pole pokazuje „Brak otwartych komentarzy”, a „Kopiuj” jest nieaktywny.
- Kliknięcie „Kopiuj”:
  1. Jeśli są komentarze do sprawdzenia, pojawia się pytanie „{n} komentarze z poprzedniej rundy mają zmienioną linię. Skopiować mimo to?” z przyciskami „Pokaż je” (zamyka pytanie i przewija do grupy „Do sprawdzenia”) i „Kopiuj”.
  2. Frontend kopiuje wyświetlony output do schowka.
  3. Jeśli kopiowanie się udało, frontend wywołuje `POST /api/handoff` i pokazuje komunikat „Skopiowano. Zaczęła się nowa runda.”
  4. Jeśli kopiowanie się nie udało, przekazanie nie jest wykonywane, a interfejs pokazuje błąd.
- Przekazaniem jest wyłącznie kliknięcie „Kopiuj”. Ręczne zaznaczenie i skopiowanie tekstu z pola nie zaczyna rundy.

### 5.4 Format outputu

- Do outputu trafiają wszystkie otwarte komentarze do istniejących plików.
- Kolejność: ścieżka pliku (porównanie znak po znaku), potem aktualny numer linii, potem data utworzenia.
- Każdy komentarz ma postać:

  ```
  ### {ścieżka}:{linia} > {treść}
  ```

- Ścieżka jest względna do katalogu roboczego. Numer linii to aktualna pozycja komentarza (punkt 6.3).
- Treść jest wstawiana bez nawiasów kwadratowych. Jeśli ma wiele linii, pierwsza trafia po `> `, a kolejne są dopisane pod spodem bez zmian.
- Komentarze są oddzielone jedną pustą linią. Output nie ma pustej linii na końcu.
- Output nie zawiera żadnych oznaczeń rundy ani powtórki. Jeśli poprawka agenta jest nietrafiona, recenzent edytuje treść komentarza.

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
- Migawki są deduplikowane po hashu treści. Po każdym przekazaniu i po każdym usunięciu komentarza serwer kasuje migawki, do których nie odwołuje się ani żaden komentarz, ani ostatnie przekazanie.

### 6.2 `state.json`

```json
{
  "version": 1,
  "root": "/Users/x/Projects/my-agent",
  "showIgnored": false,
  "handoff": {
    "at": "2026-10-01T12:30:00.000Z",
    "showIgnored": false,
    "files": {
      "docs/adr/0001-storage.md": "<sha256 treści w chwili przekazania>",
      "README.md": "<sha256>"
    }
  },
  "comments": [
    {
      "id": "<uuid>",
      "file": "docs/adr/0001-storage.md",
      "text": "uzasadnij wybór",
      "status": "open",
      "createdAt": "2026-10-01T12:00:00.000Z",
      "resolvedAt": null,
      "handedOffAt": "2026-10-01T12:30:00.000Z",
      "checkedAt": null,
      "anchor": {
        "snapshot": "<sha256 treści pliku>",
        "line": 8,
        "lineText": "Wybieramy SQLite."
      }
    }
  ]
}
```

- `handoff` ma wartość `null`, dopóki nie było żadnego przekazania.
- `status` to `open` albo `resolved`.
- **Kotwica (`anchor`)** to punkt odniesienia komentarza: migawka pliku, numer linii w tej migawce i treść tej linii. Powstaje przy dodaniu komentarza i jest zastępowana wyłącznie przy przekazaniu (punkt 6.5). Edycja treści i zmiana statusu jej nie ruszają.

**Cechy wyliczane** (nie są zapisywane):

| Cecha | Definicja |
|---|---|
| `handedOff` | komentarz jest otwarty i `handedOffAt` równa się `handoff.at` |
| `lineChanged` | wynik mapowania kotwicy na obecną treść pliku (punkt 6.3) |
| `previousLineText` | `anchor.lineText` |
| `needsCheck` | `handedOff` i `lineChanged`, a `checkedAt` jest `null` |
| `fileMissing` | plik komentarza nie istnieje na dysku |

`checkedAt` jest ustawiane przy edycji treści komentarza i przy akcji „Nadal aktualny”, a zerowane przy przekazaniu.

### 6.3 Aktualna pozycja komentarza

Moduł `core/anchors.ts` dostaje linie migawki, linie obecnej treści i numer linii w migawce, a zwraca `{ currentLine, lineChanged }`. Pliki są dzielone na linie po `\n`; końcowe `\r` jest usuwane, a końcowy znak nowej linii nie tworzy dodatkowej pustej linii.

Porównanie robi `diffArrays` na tablicach linii. Reguły:

1. **Linia leży we fragmencie niezmienionym:** `currentLine` to jej nowa pozycja, `lineChanged = false`.
2. **Linia leży we fragmencie usuniętym, po którym bezpośrednio następuje fragment dodany (zamiana):** `currentLine` to linia fragmentu dodanego o tym samym przesunięciu co linia w usuniętym, ograniczona do ostatniej linii fragmentu dodanego. `lineChanged = true`.
3. **Linia leży we fragmencie usuniętym bez następującego dodania:** `currentLine` to linia, która teraz następuje po miejscu usunięcia; jeśli usunięto koniec pliku, to ostatnia linia pliku. `lineChanged = true`.
4. **Plik jest pusty:** `currentLine = 1`, `lineChanged = true`.

Jeśli migawka i obecna treść mają ten sam hash, serwer pomija porównanie.

### 6.4 Zmiany w rundzie

Punktem odniesienia rundy jest ostatnie przekazanie. Dla każdego widocznego pliku:

| `roundStatus` | Warunek |
|---|---|
| `unchanged` | Nie było przekazania; albo plik jest w `handoff.files` z tym samym hashem; albo pliku nie ma w `handoff.files`, jest ignorowany, a `handoff.showIgnored` było wyłączone |
| `changed` | Plik jest w `handoff.files` z innym hashem |
| `new` | Było przekazanie, pliku nie ma w `handoff.files`, a plik jest nieignorowany albo `handoff.showIgnored` było włączone |

- `changedLines` to numery obecnych linii leżących we fragmentach dodanych względem migawki pliku z przekazania. Dla statusów `unchanged` i `new` lista jest pusta.
- Czyste usunięcia nie mają własnego znacznika w panelach; widać je przez „linia zmieniona” i „było: …” przy komentarzu.
- Plik usunięty w rundzie znika z drzewa; jego komentarze są obsługiwane według punktu 6.7.

### 6.5 Przekazanie

`POST /api/handoff` wykonuje w jednym atomowym zapisie stanu:

1. Odczyt obecnej treści wszystkich widocznych plików i zapis ich migawek.
2. Dla każdego otwartego komentarza do istniejącego pliku: wyliczenie aktualnej pozycji (punkt 6.3) i zastąpienie kotwicy nową: migawka obecnej treści, aktualny numer linii, obecna treść tej linii. Ustawienie `handedOffAt` na czas przekazania i `checkedAt` na `null`.
3. Zapis `handoff`: czas, bieżące `showIgnored` i mapa `ścieżka → hash` wszystkich widocznych plików.
4. Sprzątanie nieużywanych migawek.

Komentarze rozwiązane oraz komentarze do nieistniejących plików nie są zmieniane.

Logika kroków 2 i 3 jest w `core/handoff.ts` jako funkcja bez dostępu do dysku: dostaje stan i obecną treść plików, zwraca nowy stan.

### 6.6 Przebieg rundy

1. Recenzent dodaje komentarze. Każdy dostaje kotwicę z migawką bieżącej treści pliku.
2. Recenzent klika „Kopiuj” w widoku „Komentarze” i wkleja output agentowi. To jest przekazanie: zaczyna się nowa runda.
3. Agent zmienia pliki. Obserwator wysyła `files-changed`, frontend odświeża dane.
4. Drzewo oznacza pliki zmienione i nowe w tej rundzie, także te bez komentarzy. W zmienionych plikach linie są podświetlone w obu panelach.
5. Komentarze przesuwają się na aktualne pozycje. Te, których linia zmieniła się w tej rundzie, mają „linia zmieniona”, „było: …” (treść z chwili przekazania) i są do sprawdzenia.
6. Recenzent ocenia każdy komentarz do sprawdzenia: rozwiązuje go, edytuje jego treść (opisując, co nadal nie pasuje) albo oznacza jako nadal aktualny.
7. Recenzent może dodawać nowe komentarze. Kolejne kliknięcie „Kopiuj” zaczyna następną rundę z outputem zawierającym wszystkie otwarte komentarze.

Komentarz otwarty ponownie zachowuje swoją kotwicę i `handedOffAt`. Jest „przekazany” tylko wtedy, gdy był częścią ostatniego przekazania.

### 6.7 Przypadki brzegowe

- **Plik usunięty lub przeniesiony:** komentarze zostają w stanie. W widoku „Komentarze” mają oznaczenie „plik nie istnieje”, nie trafiają do outputu i nie liczą się do licznika w zakładce. Można je rozwiązać lub usunąć. Jeśli plik wróci pod tą samą ścieżką, komentarze znów są aktywne.
- **Plik zmienił się między wyświetleniem a zapisem komentarza:** serwer odpowiada 409. Frontend odświeża widok pliku, zostawia otwarte pole z wpisanym tekstem i pokazuje komunikat, że plik się zmienił i trzeba potwierdzić linię.
- **Brakująca migawka** (ręcznie usunięta z dysku): komentarz zostaje na numerze linii z kotwicy, ograniczonym do długości pliku, z `lineChanged = true`. Plik, którego migawki z przekazania brakuje, ma `roundStatus` wyliczony z hasha, ale puste `changedLines`.
- **Ponowne „Kopiuj” przed obejrzeniem poprawek:** zaczyna nową rundę, więc podświetlenia nieobejrzanych zmian znikają. To świadomy koszt (ADR 0001); częściowo chroni przed nim pytanie o komentarze do sprawdzenia.

## 7. Obsługa błędów

| Sytuacja | Zachowanie |
|---|---|
| Katalog startowy nie istnieje lub brak uprawnień | Komunikat w terminalu, kod wyjścia 1 |
| Zmiana katalogu w UI na nieistniejący lub nieczytelny | Komunikat w oknie wyboru; poprzedni katalog zostaje |
| Brak widocznych plików | Pusty stan z przyciskiem „Zmień katalog” |
| `state.json` nie jest poprawnym JSON-em lub ma nieznaną wersję | Serwer zmienia jego nazwę na `state.json.broken-<data>`, startuje z pustym stanem i zwraca ostrzeżenie pokazywane w UI |
| Zerwane połączenie z serwerem | Baner „Brak połączenia”, automatyczne ponawianie SSE; dodawanie i edycja komentarzy oraz „Kopiuj” są zablokowane do powrotu połączenia |
| Plik większy niż 1 MB | Tylko panel RAW, z informacją o braku renderowania |
| Zajęty port | Kolejny wolny port |
| Błąd zapisu stanu (np. brak miejsca) | Odpowiedź 500; frontend pokazuje komunikat i nie zmienia widoku |
| Kopiowanie do schowka się nie udało | Komunikat o błędzie; przekazanie nie jest wykonywane |
| Nieczytelny plik `.gitignore` | Plik jest pomijany, pozostałe reguły działają |

## 8. Testy

**Jednostkowe (Vitest)**
- `core/anchors.ts`: linia bez zmian, linia przesunięta w dół i w górę, linia zmieniona, linia usunięta w środku i na końcu pliku, zamiana wielu linii na mniej linii, pusty plik, identyczna treść, końce linii `\r\n`.
- `core/output.ts`: sortowanie, komentarz wieloliniowy, pominięcie rozwiązanych i komentarzy do nieistniejących plików, brak komentarzy.
- `core/handoff.ts`: przepięcie kotwicy na aktualną linię i treść, ustawienie `handedOffAt` i wyzerowanie `checkedAt`, pominięcie rozwiązanych i komentarzy do nieistniejących plików, mapa plików przekazania.
- Cechy wyliczane: `handedOff` po kolejnym przekazaniu i po ponownym otwarciu, `needsCheck` przed i po edycji oraz po „Nadal aktualny”, `roundStatus` dla pliku zmienionego, nowego, ignorowanego i przy braku przekazania.
- `web/lib/render.ts`: zakresy linii dla nagłówka, akapitu, listy zagnieżdżonej, tabeli i cytatu; osobne linie w bloku kodu z płotkami i z wcięciem; znaczniki HTML pokazane jako tekst.
- `web/lib/frontmatter.ts`: poprawny frontmatter, wartości wieloliniowe, brak zamykającego `---`, plik bez frontmattera.
- `server/scanner.ts` i `server/ignore.ts`: pomijanie `.git` i `node_modules`, uwzględnianie `.claude`, nieśledzenie dowiązań, wzorce z `.gitignore` w katalogu roboczym, w podkatalogu i w katalogu nadrzędnym repozytorium, plik ignorowany z komentarzem jest widoczny.

**Integracyjne serwera (Vitest, katalog tymczasowy, `~/.docsreview` przekierowane do katalogu tymczasowego)**
- Pełna runda: komentarz, przekazanie, zmiana pliku na dysku, sprawdzenie `currentLine`, `lineChanged`, `previousLineText`, `needsCheck`, `changedLines` i `roundStatus`.
- Plik bez komentarzy zmieniony po przekazaniu ma `roundStatus: changed`; plik utworzony po przekazaniu ma `new`.
- Drugie przekazanie: `previousLineText` pokazuje treść z poprzedniego przekazania, a nie z chwili dodania komentarza.
- 409 przy niezgodnym `contentHash` i przy przekazaniu bez otwartych komentarzy.
- 401 bez tokenu, 403 przy obcym nagłówku `Host`, 403 przy ścieżce poza katalogiem roboczym i przy pliku innym niż `.md`.
- Uszkodzony `state.json` jest odkładany, a serwer startuje z pustym stanem.
- Sprzątanie nieużywanych migawek po usunięciu komentarza i po przekazaniu.
- Dwie instancje aplikacji na tym samym katalogu roboczym: komentarz dodany przez jedną jest widoczny w drugiej i nie ginie po zapisie z drugiej.

**End-to-end (Playwright)**
- Jeden scenariusz pełnej rundy: komentarz w RAW, komentarz w RENDER, „Kopiuj” w widoku „Komentarze” i sprawdzenie schowka, zmiana pliku na dysku, sprawdzenie oznaczeń „zmieniony” w drzewie i „do sprawdzenia” przy komentarzu, pytanie przy ponownym „Kopiuj”, „Rozwiąż”, sprawdzenie że komentarz zniknął z outputu.

## 9. Poza zakresem MVP

- Edycja plików `.md` w narzędziu.
- Komentarze do zakresu linii, komentowanie zaznaczonego tekstu, wątki i odpowiedzi.
- Osobny tryb diff i historia rund (pamiętane jest tylko ostatnie przekazanie).
- Oznaczanie powtórek w outpucie.
- Formaty inne niż `.md` (w tym `.mdx` i `.mdc`).
- Wykrywanie korzenia repozytorium jako tożsamości review i ścieżki bezwzględne w outpucie.
- Globalne reguły ignorowania gita i własny plik konfiguracyjny ze wzorcami.
- Publikacja w npm. Struktura paczki (`bin`, zbudowany frontend w paczce) jest na nią gotowa; na start narzędzie uruchamia się lokalnie przez `npm link` lub `npx <ścieżka>`.
- Bezpośrednia integracja z agentem (czytanie stanu przez agenta zamiast wklejania outputu).
- Podświetlanie składni w panelu RAW.
- Tłumaczenia interfejsu.
