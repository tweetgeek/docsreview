# DocsReview

Lokalne narzędzie do review plików Markdown pisanych dla agentów AI i przez agentów (skille, dokumentacja, ADR, specyfikacje). Pokazuje surowy markdown obok wersji wyrenderowanej, pozwala komentować linie i generuje output do wklejenia agentowi.

## Wymagania

- Node.js 20.19 lub nowszy do uruchamiania.
- Node.js 22.12 lub nowszy do pracy nad projektem (wymaga tego Vitest).

## Instalacja

```sh
npm install
npm run build
npm link
```

## Uruchomienie

Uruchom narzędzie w tym samym katalogu, w którym pracuje agent, bo ścieżki w outpucie są względne do katalogu roboczego:

```sh
docsreview [katalog] [--port <n>] [--no-open]
```

- `katalog`: katalog roboczy; domyślnie bieżący.
- `--port <n>`: port serwera; domyślnie 4477, a gdy jest zajęty, kolejny wolny.
- `--no-open`: nie otwieraj przeglądarki.

Serwer nasłuchuje tylko na `127.0.0.1` i wypisuje adres z tokenem. Bez tokenu API nie odpowiada.

## Jak wygląda runda

1. W zakładce „Pliki” dodajesz komentarze do linii w panelu RAW albo do bloków w panelu RENDER.
2. W zakładce „Komentarze” klikasz „Kopiuj” i wklejasz output agentowi. To jest przekazanie: zaczyna nową rundę.
3. Agent zmienia pliki. Drzewo oznacza pliki zmienione i nowe, a zmienione linie są podświetlone.
4. Komentarze, których linia się zmieniła, trafiają do grupy „Do sprawdzenia”. Każdy rozwiązujesz, edytujesz albo oznaczasz jako nadal aktualny.
5. Kolejne „Kopiuj” zaczyna następną rundę.

Format outputu:

```
### docs/adr/0001-storage.md:8 > uzasadnij wybór
```

## Które pliki widać

Narzędzie pokazuje pliki `.md`, których git nie ignoruje. Przełącznik „Pokaż ignorowane” nad drzewem odsłania pozostałe. Katalogi `.git` i `node_modules` są pomijane zawsze.

## Gdzie są dane

Komentarze i migawki plików leżą w `~/.docsreview/`, osobno dla każdego katalogu roboczego. Recenzowane pliki nie są nigdy modyfikowane.

## Rozwój

```sh
npm test            # testy jednostkowe i integracyjne
npm run test:e2e    # budowanie i testy end-to-end (Playwright)
npm run typecheck
```

Przed pierwszym uruchomieniem testów end-to-end: `npx playwright install chromium`.

Tryb deweloperski to dwa procesy:

```sh
npm run dev:server -- <katalog>   # API na porcie 4477, token "dev"
npm run dev:web                   # Vite z proxy do API
```

Potem otwórz `http://localhost:5173/?token=dev`.

Słownik pojęć jest w `CONTEXT.md`, a decyzje architektoniczne w `docs/adr/`.
