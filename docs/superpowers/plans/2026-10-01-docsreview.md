# DocsReview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Zbudować DocsReview: lokalne narzędzie uruchamiane jedną komendą, w którym recenzent ogląda pliki `.md` jako surowy tekst i render obok siebie, komentuje linie, kopiuje output dla agenta, a po poprawkach widzi zmiany z bieżącej rundy.

**Architecture:** Jedna paczka npm w TypeScripcie. Serwer Node (Hono) nasłuchuje na `127.0.0.1`, skanuje katalog roboczy, czyta pliki, obserwuje zmiany i trzyma stan review w `~/.docsreview/`; nie cache'uje stanu w pamięci. Logika domenowa (mapowanie linii, cechy wyliczane, output, przekazanie) leży w `src/core` jako czyste funkcje. Frontend Vue 3 jest budowany przez Vite do statycznych plików serwowanych przez ten sam serwer i odświeża się po zdarzeniach SSE.

**Tech Stack:** Node ≥ 20.19, TypeScript 6, Hono + @hono/node-server, chokidar, ignore, diff, open, Vue 3, Vite 8, markdown-it 15, Vitest 5, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-01-docsreview-design.md`. Słownik pojęć: `CONTEXT.md`. Decyzja o rundach: `docs/adr/0001-runda-wyznaczana-przekazaniem.md`.

## Global Constraints

- Paczka wymaga Node `>=20.19.0` (spec mówi „Node 20 lub nowszy”; chokidar 5 i Vite 8 wymagają co najmniej 20.19). Praca nad projektem wymaga Node 22.12 lub nowszego, bo tego wymaga Vitest 5.
- TypeScript jest przypięty do `^6.0.3`. `vue-tsc` 3.3 nie działa z TypeScript 7, więc nie podnoś wersji.
- Zależności są dokładnie te z `package.json` w Zadaniu 1. Bez Pinia, bez vue-router, bez biblioteki i18n, bez `@types/markdown-it` (markdown-it 15 ma własne typy).
- Moduły ESM. Importy względne w `src/` i `tests/` mają rozszerzenie `.js` (np. `'./lines.js'`), także gdy plik źródłowy to `.ts`.
- `src/core` nie importuje niczego z `src/server` ani `src/web` i nie dotyka dysku ani sieci.
- Serwer nasłuchuje wyłącznie na `127.0.0.1`. Domyślny port to 4477; gdy jest zajęty, serwer bierze kolejny wolny.
- Każde żądanie `/api/*` wymaga nagłówka `Authorization: Bearer <token>`. Wyjątkiem jest `/api/events`, które przyjmuje token w parametrze `token`. Brak lub błędny token daje 401.
- Żądanie `/api/*` z hostem innym niż `127.0.0.1:<port>` lub `localhost:<port>` daje 403.
- Recenzowane pliki są tylko do odczytu. Żaden kod nie zapisuje niczego w katalogu roboczym.
- Stan leży w `~/.docsreview/` (w testach i trybie deweloperskim katalog nadpisuje zmienna `DOCSREVIEW_HOME`). Zapis `state.json` i `recent.json` jest atomowy: plik tymczasowy i zmiana nazwy.
- Serwer nie trzyma stanu review w pamięci: każda operacja czyta `state.json` z dysku.
- Do review należą tylko pliki z rozszerzeniem `.md` (bez rozróżniania wielkości liter). Katalogi `.git` i `node_modules` są pomijane zawsze. Dowiązania symboliczne nie są śledzone.
- Ścieżki w API i w stanie są względne do katalogu roboczego, z separatorem `/`. Numery linii są liczone od 1.
- Linie pliku: podział po `\n`, końcowe `\r` usuwane, końcowy znak nowej linii nie tworzy dodatkowej pustej linii.
- markdown-it działa z `html: false`.
- Format outputu jest dokładnie taki: `### {ścieżka}:{linia} > {treść}`, komentarze oddzielone jedną pustą linią, bez pustej linii na końcu, bez żadnych oznaczeń rundy.
- Pliki powyżej 1 MB (1 048 576 bajtów) są pokazywane tylko w panelu RAW.
- Interfejs jest po polsku. Wszystkie teksty interfejsu są w `src/web/strings.ts`. Komunikaty błędów API są po polsku w kodzie serwera.
- Nazwy w interfejsie trzymają się `CONTEXT.md`: zakładka nazywa się „Komentarze” (nie „Review”), oznaczenia komentarza to „przekazany”, „linia zmieniona”, „do sprawdzenia”.
- Identyfikatory w kodzie i nazwy testów są po angielsku.

## Review Focus

Pięć sytuacji, o których spec milczy albo które łatwo przeoczyć, a które najpewniej trafią na użytkownika. Każda ma test w zadaniu, które jest właścicielem kodu.

1. **Recenzent pisze komentarz, a agent w tym samym czasie zmienia pliki.** Wpisany tekst nie może zniknąć, a zapis na zmienionym pliku ma poprosić o sprawdzenie linii zamiast przypiąć komentarz w złym miejscu. Testy: Zadanie 6 (`answers 409 when the file changed after it was displayed`), Zadanie 10 (`a draft is not lost when files change while typing`, `saving a comment on a file that just changed asks to check the line`).
2. **Nazwa pliku ze spacjami, polskimi znakami lub `#`** (np. `docs/Plan wdrożenia #2.md`). Plik ma dać się znaleźć, otworzyć, skomentować i przetrwać odświeżenie strony. Testy: Zadanie 5, Zadanie 6, Zadanie 7, Zadanie 9 (`round-trips a file name…`), Zadanie 10 (`a file name with spaces…`).
3. **Plik znika między wyświetleniem a akcją** (agent go usunął lub przeniósł). Oczekiwane: czytelny komunikat, komentarze zostają, nic się nie wywraca. Testy: Zadanie 6 (`answers 404 when the file was deleted after it was displayed`, `keeps comments of a deleted file…`, `reactivates the comments when the file comes back`), Zadanie 10 (koniec testu `a file name with spaces…`).
4. **Powtarzające się i puste linie.** Komentarz do jednej z kilku identycznych linii ma zostać przy swojej kopii, gdy wyżej pojawią się inne linie. Testy: Zadanie 1 (`stays on its own copy of a duplicated line…`, `keeps a comment on a blank line…`).
5. **Katalog roboczy sam jest ignorowany przez repozytorium nadrzędne** (np. uruchomienie w `.superpowers/`). Drzewo jest wtedy domyślnie puste, więc pusty stan musi wskazać przełącznik „Pokaż ignorowane”, a po jego włączeniu pliki mają być od razu widoczne. Testy: Zadanie 5 (`shows nothing by default when the root itself is ignored…`), Zadanie 10 (`tests/e2e/ignored.spec.ts`).

## Doprecyzowania względem specu

Spec opisuje zachowanie; poniższe decyzje zapadły przy pisaniu planu i nie zmieniają uzgodnionego zachowania, poza trzema pierwszymi punktami, które są widoczne dla użytkownika.

- **Obrazy nie są renderowane.** `![alt](url)` zostaje w RENDER jako tekst. Serwer i tak nie serwuje plików innych niż `.md`, a obrazy zdalne wysyłałyby żądania na zewnątrz.
- **Linki otwierają się w nowej karcie** z `rel="noopener noreferrer"`, a strona ma `<meta name="referrer" content="no-referrer">`, bo adres zawiera token.
- **Zwijanie ignorowanych katalogów:** katalog ignorowany jest domyślnie zwinięty tylko wtedy, gdy nie ma w nim otwartych komentarzy i gdy w drzewie są też pliki nieignorowane. Bez tego plik z komentarzem albo cały ignorowany katalog roboczy byłby schowany.
- **Struktura plików jest drobniejsza niż w specu.** Doszły: `core/derive.ts`, `server/errors.ts`, `server/files.ts`, `server/review.ts`, `server/events.ts`, `server/start.ts`, `server/args.ts`, `web/state.ts`, `web/lib/blocks.ts`, `web/lib/tree.ts`, `web/lib/route.ts` oraz komponenty `FilesView`, `FileTreeNode`, `CommentCard` (zamiast `CommentThread`), `CommentBadges`, `CommentActions`, `CommentRow`.
- **Zmienne środowiskowe** `DOCSREVIEW_HOME` (katalog stanu) i `DOCSREVIEW_TOKEN` (stały token) służą testom i trybowi deweloperskiemu.
- **Katalog stanu jest pomijany przez skaner i obserwatora**, gdy leży wewnątrz katalogu roboczego (np. przy uruchomieniu w katalogu domowym), bo migawki mają rozszerzenie `.md`.
- **Adres URL** przechowuje w hashu zakładkę i wybrany plik (`#tab=files&file=…`).
- **`POST /api/comments`** odpowiada `201 { id }`. Pozostałe zapisy odpowiadają `{ ok: true }`.
- **Pusty plik** ma w RAW jeden pusty wiersz bez przycisku „+”; komentarz można dodać tylko do istniejącej linii.
- **Przejściowy błąd odczytu pliku** (inny niż 404) nie czyści widoku, tylko pokazuje komunikat.
- **Pliki statyczne** serwuje własna obsługa w `app.ts`, a nie `serveStatic`, żeby katalog mógł być ścieżką bezwzględną.

## Struktura plików

```
package.json, tsconfig.json, tsconfig.server.json
vitest.config.ts, vite.config.ts, playwright.config.ts
README.md
src/
  core/
    types.ts       typy stanu, widoków i odpowiedzi API
    lines.ts       podział treści na linie
    anchors.ts     mapowanie linii między dwiema wersjami pliku, zmienione linie
    derive.ts      cechy wyliczane komentarza i status pliku w rundzie
    output.ts      tekst outputu
    handoff.ts     przekazanie: przepięcie kotwic i nowy punkt odniesienia
  server/
    errors.ts      HttpError i rozpoznawanie błędów systemu plików
    store.ts       state.json, recent.json, kolejka zapisów
    snapshots.ts   migawki plików i ich sprzątanie
    ignore.ts      reguły z plików .gitignore
    scanner.ts     wyszukiwanie plików .md
    files.ts       bezpieczny odczyt pliku, lista katalogów
    review.ts      operacje na review: widoki, komentarze, przekazanie
    events.ts      rozgłaszanie zdarzeń do strumieni SSE
    security.ts    token i kontrola hosta
    app.ts         trasy HTTP, SSE, pliki statyczne
    watcher.ts     obserwowanie katalogu roboczego i pliku stanu
    start.ts       uruchomienie serwera, wybór portu, zmiana katalogu
    args.ts        argumenty wiersza poleceń
    cli.ts         punkt wejścia `docsreview`
  web/
    index.html, main.ts, style.css, App.vue
    strings.ts     teksty interfejsu
    api.ts         klient REST i SSE
    state.ts       stan aplikacji i akcje
    lib/
      frontmatter.ts, render.ts, blocks.ts, tree.ts, route.ts, scrollSync.ts
    components/
      FilesView.vue, FileTree.vue, FileTreeNode.vue, RawPane.vue, RenderPane.vue,
      CommentCard.vue, CommentForm.vue, CommentBadges.vue, CommentActions.vue,
      CommentsView.vue, CommentRow.vue, DirPicker.vue
tests/
  helpers/   factories.ts, tmp.ts
  core/      anchors, derive, output, handoff
  server/    store, scanner, review, app, start
  web/       render, lib
  e2e/       prepare.mjs, comments.spec.ts, ignored.spec.ts, round.spec.ts
```

## Jak czytać zadania

- Każdy blok kodu to pełna treść pliku. Wklej ją bez zmian.
- Polecenia uruchamiaj w katalogu głównym repozytorium.
- Kolejność zadań jest obowiązkowa: każde korzysta z plików utworzonych wcześniej.
- Cały kod z tego planu został zbudowany i uruchomiony poza repozytorium: 163 testy Vitest i 7 testów Playwright przechodzą na Node 24 z wersjami bibliotek z Zadania 1.

---

### Task 1: Szkielet projektu i mapowanie linii

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `tsconfig.server.json`
- Create: `vitest.config.ts`
- Modify: `.gitignore`
- Create: `src/core/lines.ts`
- Create: `src/core/anchors.ts`
- Test: `tests/core/anchors.test.ts`

**Interfaces:**
- Consumes: nic.
- Produces:
  - `splitLines(content: string): string[]` z `src/core/lines.ts`
  - `interface LinePosition { currentLine: number; lineChanged: boolean }` z `src/core/anchors.ts`
  - `mapLine(oldLines: string[], newLines: string[], oldLine: number): LinePosition`
  - `changedLines(oldLines: string[], newLines: string[]): number[]`
  - skrypty npm: `test`, `typecheck`, `build`, `test:e2e`, `dev:server`, `dev:web`

- [ ] **Step 1: Utwórz `package.json`**

````json
{
  "name": "docsreview",
  "version": "0.1.0",
  "description": "Lokalne narzędzie do review plików Markdown pisanych dla agentów AI i przez agentów",
  "type": "module",
  "bin": {
    "docsreview": "dist/server/cli.js"
  },
  "files": [
    "dist"
  ],
  "engines": {
    "node": ">=20.19.0"
  },
  "scripts": {
    "dev:server": "DOCSREVIEW_TOKEN=dev tsx watch src/server/cli.ts --no-open",
    "dev:web": "vite",
    "build": "vite build && tsc -p tsconfig.server.json",
    "typecheck": "vue-tsc --noEmit -p tsconfig.json && tsc --noEmit -p tsconfig.server.json",
    "test": "vitest run",
    "test:e2e": "npm run build && playwright test"
  },
  "dependencies": {
    "@hono/node-server": "^2.1.3",
    "chokidar": "^5.0.0",
    "diff": "^9.0.0",
    "hono": "^4.13.12",
    "ignore": "^7.0.11",
    "open": "^11.0.4"
  },
  "devDependencies": {
    "@playwright/test": "^1.63.0",
    "@types/node": "^24.0.0",
    "@vitejs/plugin-vue": "^6.0.9",
    "markdown-it": "^15.0.2",
    "tsx": "^4.23.15",
    "typescript": "^6.0.3",
    "vite": "^8.3.2",
    "vitest": "^5.0.3",
    "vue": "^3.5.43",
    "vue-tsc": "^3.3.11"
  }
}
````

- [ ] **Step 2: Utwórz `tsconfig.json`** (edytor, testy i frontend; bez emisji)

````json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["node", "vite/client"]
  },
  "include": ["src", "tests", "*.ts"]
}
````

- [ ] **Step 3: Utwórz `tsconfig.server.json`** (kompilacja `src/core` i `src/server` do `dist/`)

````json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "skipLibCheck": true,
    "rootDir": "src",
    "outDir": "dist",
    "types": ["node"]
  },
  "include": ["src/core", "src/server"]
}
````

- [ ] **Step 4: Utwórz `vitest.config.ts`**

````ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['tests/**/*.test.ts'], exclude: ['tests/e2e/**'], environment: 'node' },
});
````

- [ ] **Step 5: Zastąp treść `.gitignore`**

````text
.superpowers/
node_modules/
dist/
tests/e2e/.work/
test-results/
playwright-report/
````

- [ ] **Step 6: Zainstaluj zależności**

Run: `npm install`
Expected: instalacja kończy się bez błędów i powstaje `package-lock.json`.

- [ ] **Step 7: Napisz test, który nie przechodzi**

Utwórz `tests/core/anchors.test.ts`:

````ts
import { describe, expect, it } from 'vitest';
import { changedLines, mapLine } from '../../src/core/anchors.js';
import { splitLines } from '../../src/core/lines.js';

describe('splitLines', () => {
  it('returns no lines for an empty file', () => {
    expect(splitLines('')).toEqual([]);
  });

  it('does not create an extra line for the trailing newline', () => {
    expect(splitLines('a\nb\n')).toEqual(['a', 'b']);
    expect(splitLines('a\nb')).toEqual(['a', 'b']);
  });

  it('keeps blank lines, including a blank last line', () => {
    expect(splitLines('a\n\nb\n\n')).toEqual(['a', '', 'b', '']);
  });

  it('strips carriage returns from CRLF files', () => {
    expect(splitLines('a\r\nb\r\n')).toEqual(['a', 'b']);
  });
});

describe('mapLine', () => {
  it('keeps the line when nothing changed', () => {
    expect(mapLine(['a', 'b', 'c'], ['a', 'b', 'c'], 2)).toEqual({ currentLine: 2, lineChanged: false });
  });

  it('follows a line shifted down by an insertion above it', () => {
    expect(mapLine(['a', 'b', 'c'], ['x', 'a', 'b', 'c'], 2)).toEqual({ currentLine: 3, lineChanged: false });
  });

  it('follows a line shifted up by a deletion above it', () => {
    expect(mapLine(['x', 'a', 'b'], ['a', 'b'], 3)).toEqual({ currentLine: 2, lineChanged: false });
  });

  it('marks a replaced line as changed and stays on the replacement', () => {
    expect(mapLine(['a', 'b', 'c'], ['a', 'B', 'c'], 2)).toEqual({ currentLine: 2, lineChanged: true });
  });

  it('moves a comment from a deleted middle line to the line that follows', () => {
    expect(mapLine(['a', 'b', 'c'], ['a', 'c'], 2)).toEqual({ currentLine: 2, lineChanged: true });
  });

  it('moves a comment from a deleted last line to the new last line', () => {
    expect(mapLine(['a', 'b', 'c'], ['a', 'b'], 3)).toEqual({ currentLine: 2, lineChanged: true });
  });

  it('clamps to the last replacement line when many lines become fewer', () => {
    expect(mapLine(['a', 'b', 'c', 'd', 'e'], ['a', 'X', 'e'], 4)).toEqual({ currentLine: 2, lineChanged: true });
  });

  it('keeps the offset inside a replacement of equal size', () => {
    expect(mapLine(['a', 'b', 'c', 'd'], ['a', 'B', 'C', 'd'], 3)).toEqual({ currentLine: 3, lineChanged: true });
  });

  it('puts the comment on line 1 of an emptied file', () => {
    expect(mapLine(['a', 'b'], [], 2)).toEqual({ currentLine: 1, lineChanged: true });
  });

  it('stays on its own copy of a duplicated line when unrelated lines are inserted above', () => {
    const before = ['a', 'x', 'b', 'x', 'c'];
    const after = ['new', 'a', 'x', 'b', 'x', 'c'];
    expect(mapLine(before, after, 4)).toEqual({ currentLine: 5, lineChanged: false });
    expect(mapLine(before, after, 2)).toEqual({ currentLine: 3, lineChanged: false });
  });

  it('keeps a comment on a blank line between paragraphs when text is appended', () => {
    expect(mapLine(['a', '', 'b'], ['a', '', 'b', '', 'c'], 2)).toEqual({ currentLine: 2, lineChanged: false });
  });

  it('gives the same answer for CRLF and LF versions of a file', () => {
    const before = splitLines('a\r\nb\r\nc\r\n');
    const after = splitLines('a\nb\nc\n');
    expect(mapLine(before, after, 3)).toEqual({ currentLine: 3, lineChanged: false });
  });
});

describe('changedLines', () => {
  it('is empty for identical content', () => {
    expect(changedLines(['a', 'b'], ['a', 'b'])).toEqual([]);
  });

  it('lists replaced and inserted lines by their current numbers', () => {
    expect(changedLines(['a', 'b', 'c'], ['a', 'B', 'c', 'd', 'e'])).toEqual([2, 4, 5]);
  });

  it('does not mark anything for a pure deletion', () => {
    expect(changedLines(['a', 'b', 'c'], ['a', 'c'])).toEqual([]);
  });

  it('marks every line of a file that was empty before', () => {
    expect(changedLines([], ['a', 'b'])).toEqual([1, 2]);
  });
});
````

- [ ] **Step 8: Uruchom test i sprawdź, że nie przechodzi**

Run: `npx vitest run tests/core/anchors.test.ts`
Expected: FAIL, bo nie da się zaimportować `../../src/core/anchors.js` (plik jeszcze nie istnieje).

- [ ] **Step 9: Utwórz `src/core/lines.ts`**

````ts
export function splitLines(content: string): string[] {
  if (content === '') return [];
  const lines = content.split('\n').map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line));
  if (content.endsWith('\n')) lines.pop();
  return lines;
}
````

- [ ] **Step 10: Utwórz `src/core/anchors.ts`**

`diffArrays` zwraca listę fragmentów `{ value, added, removed }`. Kolejne fragmenty usunięte i dodane tworzą jedną grupę zmian; reguły dla linii w takiej grupie są w punkcie 6.3 specu.

````ts
import { diffArrays } from 'diff';

export interface LinePosition {
  currentLine: number;
  lineChanged: boolean;
}

export function mapLine(oldLines: string[], newLines: string[], oldLine: number): LinePosition {
  if (newLines.length === 0) return { currentLine: 1, lineChanged: true };
  const parts = diffArrays(oldLines, newLines);
  let oldPos = 0;
  let newPos = 0;
  let index = 0;
  while (index < parts.length) {
    const part = parts[index]!;
    if (!part.added && !part.removed) {
      const count = part.value.length;
      if (oldLine <= oldPos + count) {
        return { currentLine: newPos + (oldLine - oldPos), lineChanged: false };
      }
      oldPos += count;
      newPos += count;
      index++;
      continue;
    }
    let removed = 0;
    let added = 0;
    while (index < parts.length && (parts[index]!.added || parts[index]!.removed)) {
      if (parts[index]!.removed) removed += parts[index]!.value.length;
      else added += parts[index]!.value.length;
      index++;
    }
    if (oldLine <= oldPos + removed) {
      const offset = oldLine - oldPos - 1;
      if (added > 0) {
        return { currentLine: newPos + Math.min(offset, added - 1) + 1, lineChanged: true };
      }
      return { currentLine: Math.min(newPos + 1, newLines.length), lineChanged: true };
    }
    oldPos += removed;
    newPos += added;
  }
  return { currentLine: Math.min(Math.max(oldLine, 1), newLines.length), lineChanged: true };
}

export function changedLines(oldLines: string[], newLines: string[]): number[] {
  const result: number[] = [];
  let newPos = 0;
  for (const part of diffArrays(oldLines, newLines)) {
    if (part.removed) continue;
    if (part.added) {
      for (let offset = 1; offset <= part.value.length; offset++) result.push(newPos + offset);
    }
    newPos += part.value.length;
  }
  return result;
}
````

- [ ] **Step 11: Uruchom test i sprawdź, że przechodzi**

Run: `npx vitest run tests/core/anchors.test.ts`
Expected: PASS, 20 testów.

- [ ] **Step 12: Sprawdź typy**

Run: `npm run typecheck`
Expected: brak błędów.

- [ ] **Step 13: Commit**

```bash
git add package.json package-lock.json tsconfig.json tsconfig.server.json vitest.config.ts .gitignore src/core/lines.ts src/core/anchors.ts tests/core/anchors.test.ts
git commit -m "feat: scaffold project and add line mapping"
```

---

### Task 2: Typy, cechy wyliczane i output

**Files:**
- Create: `src/core/types.ts`
- Create: `src/core/derive.ts`
- Create: `src/core/output.ts`
- Create: `tests/helpers/factories.ts`
- Test: `tests/core/derive.test.ts`
- Test: `tests/core/output.test.ts`

**Interfaces:**
- Consumes: `mapLine`, `LinePosition` z `src/core/anchors.ts`.
- Produces:
  - typy z `src/core/types.ts`: `CommentStatus`, `RoundStatus`, `Anchor`, `Comment`, `Handoff`, `ReviewState`, `CurrentFile`, `CommentView`, `FileEntry`, `FileView`, `CommentsResponse`, `SessionInfo`, `DirListing`, `ServerEvent`
  - `resolvePosition(comment: Comment, current: CurrentFile | null, snapshotLines: string[] | null): LinePosition`
  - `deriveCommentView(comment: Comment, handoff: Handoff | null, current: CurrentFile | null, snapshotLines: string[] | null): CommentView`
  - `deriveRoundStatus(path: string, currentHash: string, ignored: boolean, handoff: Handoff | null): RoundStatus`
  - `compareViews(a: CommentView, b: CommentView): number` (ścieżka, linia, data utworzenia)
  - `buildOutput(comments: CommentView[]): string`
  - pomocnicy testów: `makeComment(overrides?: Partial<Comment>): Comment`, `makeView(overrides?: Partial<CommentView>): CommentView`

- [ ] **Step 1: Utwórz `src/core/types.ts`**

`Comment`, `Handoff` i `ReviewState` to kształt `state.json` (punkt 6.2 specu). `CommentView`, `FileEntry`, `FileView`, `CommentsResponse`, `SessionInfo` i `DirListing` to odpowiedzi API (punkt 4 specu).

````ts
export type CommentStatus = 'open' | 'resolved';
export type RoundStatus = 'unchanged' | 'changed' | 'new';

export interface Anchor {
  snapshot: string;
  line: number;
  lineText: string;
}

export interface Comment {
  id: string;
  file: string;
  text: string;
  status: CommentStatus;
  createdAt: string;
  resolvedAt: string | null;
  handedOffAt: string | null;
  checkedAt: string | null;
  anchor: Anchor;
}

export interface Handoff {
  at: string;
  showIgnored: boolean;
  files: Record<string, string>;
}

export interface ReviewState {
  version: 1;
  root: string;
  showIgnored: boolean;
  handoff: Handoff | null;
  comments: Comment[];
}

export interface CurrentFile {
  lines: string[];
  hash: string;
}

export interface CommentView {
  id: string;
  file: string;
  text: string;
  status: CommentStatus;
  createdAt: string;
  resolvedAt: string | null;
  currentLine: number;
  lineChanged: boolean;
  previousLineText: string;
  handedOff: boolean;
  needsCheck: boolean;
  fileMissing: boolean;
}

export interface FileEntry {
  path: string;
  openComments: number;
  ignored: boolean;
  roundStatus: RoundStatus;
}

export interface FileView {
  path: string;
  content: string;
  contentHash: string;
  tooLarge: boolean;
  roundStatus: RoundStatus;
  changedLines: number[];
  comments: CommentView[];
}

export interface CommentsResponse {
  comments: CommentView[];
  output: string;
}

export interface SessionInfo {
  root: string;
  recent: string[];
  showIgnored: boolean;
  lastHandoffAt: string | null;
  warning: string | null;
}

export interface DirListing {
  path: string;
  parent: string | null;
  dirs: string[];
}

export type ServerEvent = { type: 'files-changed'; paths: string[] } | { type: 'review-changed' };
````

- [ ] **Step 2: Utwórz `tests/helpers/factories.ts`**

````ts
import type { Comment, CommentView } from '../../src/core/types.js';

export function makeComment(overrides: Partial<Comment> = {}): Comment {
  return {
    id: 'c1',
    file: 'docs/a.md',
    text: 'uzasadnij wybór',
    status: 'open',
    createdAt: '2026-10-01T10:00:00.000Z',
    resolvedAt: null,
    handedOffAt: null,
    checkedAt: null,
    anchor: { snapshot: 'hash-old', line: 2, lineText: 'b' },
    ...overrides,
  };
}

export function makeView(overrides: Partial<CommentView> = {}): CommentView {
  return {
    id: 'c1',
    file: 'docs/a.md',
    text: 'uzasadnij wybór',
    status: 'open',
    createdAt: '2026-10-01T10:00:00.000Z',
    resolvedAt: null,
    currentLine: 2,
    lineChanged: false,
    previousLineText: 'b',
    handedOff: false,
    needsCheck: false,
    fileMissing: false,
    ...overrides,
  };
}
````

- [ ] **Step 3: Napisz testy, które nie przechodzą**

Utwórz `tests/core/derive.test.ts`:

````ts
import { describe, expect, it } from 'vitest';
import { deriveCommentView, deriveRoundStatus } from '../../src/core/derive.js';
import type { Handoff } from '../../src/core/types.js';
import { makeComment } from '../helpers/factories.js';

const handoff: Handoff = { at: '2026-10-01T12:00:00.000Z', showIgnored: false, files: { 'docs/a.md': 'hash-old' } };

describe('deriveCommentView', () => {
  it('keeps the anchor line when the file is unchanged', () => {
    const view = deriveCommentView(makeComment(), null, { lines: ['a', 'b'], hash: 'hash-old' }, null);
    expect(view).toMatchObject({ currentLine: 2, lineChanged: false, previousLineText: 'b', fileMissing: false });
  });

  it('maps the anchor through the snapshot when the file changed', () => {
    const view = deriveCommentView(makeComment(), null, { lines: ['x', 'a', 'B'], hash: 'hash-new' }, ['a', 'b']);
    expect(view).toMatchObject({ currentLine: 3, lineChanged: true });
  });

  it('marks the file as missing and keeps the anchor line', () => {
    const view = deriveCommentView(makeComment(), null, null, null);
    expect(view).toMatchObject({ currentLine: 2, lineChanged: false, fileMissing: true });
  });

  it('clamps to the file length and marks the line changed when the snapshot is gone', () => {
    const comment = makeComment({ anchor: { snapshot: 'hash-old', line: 9, lineText: 'z' } });
    const view = deriveCommentView(comment, null, { lines: ['a', 'b', 'c'], hash: 'hash-new' }, null);
    expect(view).toMatchObject({ currentLine: 3, lineChanged: true });
  });

  it('is handed off only when it was part of the last handoff', () => {
    const current = { lines: ['a', 'b'], hash: 'hash-old' };
    expect(deriveCommentView(makeComment({ handedOffAt: handoff.at }), handoff, current, null).handedOff).toBe(true);
    expect(deriveCommentView(makeComment({ handedOffAt: '2026-09-30T08:00:00.000Z' }), handoff, current, null).handedOff).toBe(false);
    expect(deriveCommentView(makeComment({ handedOffAt: null }), handoff, current, null).handedOff).toBe(false);
  });

  it('is not handed off once resolved, and is again after reopening in the same round', () => {
    const current = { lines: ['a', 'b'], hash: 'hash-old' };
    const resolved = makeComment({ handedOffAt: handoff.at, status: 'resolved', resolvedAt: '2026-10-01T13:00:00.000Z' });
    expect(deriveCommentView(resolved, handoff, current, null).handedOff).toBe(false);
    const reopened = { ...resolved, status: 'open' as const, resolvedAt: null };
    expect(deriveCommentView(reopened, handoff, current, null).handedOff).toBe(true);
  });

  it('needs a check when handed off, changed and not yet checked', () => {
    const current = { lines: ['a', 'B'], hash: 'hash-new' };
    const comment = makeComment({ handedOffAt: handoff.at });
    expect(deriveCommentView(comment, handoff, current, ['a', 'b']).needsCheck).toBe(true);
    const checked = { ...comment, checkedAt: '2026-10-01T13:00:00.000Z' };
    expect(deriveCommentView(checked, handoff, current, ['a', 'b']).needsCheck).toBe(false);
  });

  it('does not need a check when the line is unchanged or the comment was never handed off', () => {
    const changed = { lines: ['a', 'B'], hash: 'hash-new' };
    expect(deriveCommentView(makeComment(), handoff, changed, ['a', 'b']).needsCheck).toBe(false);
    const shifted = { lines: ['x', 'a', 'b'], hash: 'hash-new' };
    const handedOff = makeComment({ handedOffAt: handoff.at });
    expect(deriveCommentView(handedOff, handoff, shifted, ['a', 'b']).needsCheck).toBe(false);
  });
});

describe('deriveRoundStatus', () => {
  it('is unchanged before the first handoff', () => {
    expect(deriveRoundStatus('docs/a.md', 'anything', false, null)).toBe('unchanged');
  });

  it('compares the hash for files that were part of the handoff', () => {
    expect(deriveRoundStatus('docs/a.md', 'hash-old', false, handoff)).toBe('unchanged');
    expect(deriveRoundStatus('docs/a.md', 'hash-new', false, handoff)).toBe('changed');
  });

  it('marks a file that was not part of the handoff as new', () => {
    expect(deriveRoundStatus('docs/b.md', 'h', false, handoff)).toBe('new');
  });

  it('does not call an ignored file new when ignored files were hidden at handoff', () => {
    expect(deriveRoundStatus('vendor/x.md', 'h', true, handoff)).toBe('unchanged');
    expect(deriveRoundStatus('vendor/x.md', 'h', true, { ...handoff, showIgnored: true })).toBe('new');
  });

  it('is not confused by file names that match object prototype members', () => {
    expect(deriveRoundStatus('constructor', 'h', false, handoff)).toBe('new');
  });
});
````

Utwórz `tests/core/output.test.ts`:

````ts
import { describe, expect, it } from 'vitest';
import { buildOutput } from '../../src/core/output.js';
import { makeView } from '../helpers/factories.js';

describe('buildOutput', () => {
  it('is empty when there are no comments', () => {
    expect(buildOutput([])).toBe('');
  });

  it('formats one comment as "### path:line > text"', () => {
    expect(buildOutput([makeView({ file: 'docs/a.md', currentLine: 8, text: 'uzasadnij wybór' })])).toBe(
      '### docs/a.md:8 > uzasadnij wybór',
    );
  });

  it('separates comments with one blank line and adds no trailing newline', () => {
    const output = buildOutput([
      makeView({ id: '1', file: 'a.md', currentLine: 1, text: 'pierwszy' }),
      makeView({ id: '2', file: 'a.md', currentLine: 5, text: 'drugi' }),
    ]);
    expect(output).toBe('### a.md:1 > pierwszy\n\n### a.md:5 > drugi');
  });

  it('sorts by path, then line, then creation time', () => {
    const output = buildOutput([
      makeView({ id: '1', file: 'b.md', currentLine: 1, text: 'b1' }),
      makeView({ id: '2', file: 'a.md', currentLine: 9, text: 'a9' }),
      makeView({ id: '3', file: 'a.md', currentLine: 2, text: 'a2-later', createdAt: '2026-10-01T11:00:00.000Z' }),
      makeView({ id: '4', file: 'a.md', currentLine: 2, text: 'a2-earlier', createdAt: '2026-10-01T09:00:00.000Z' }),
      makeView({ id: '5', file: 'Z.md', currentLine: 1, text: 'Z1' }),
    ]);
    expect(output.split('\n\n')).toEqual([
      '### Z.md:1 > Z1',
      '### a.md:2 > a2-earlier',
      '### a.md:2 > a2-later',
      '### a.md:9 > a9',
      '### b.md:1 > b1',
    ]);
  });

  it('keeps the following lines of a multi-line comment unchanged', () => {
    expect(buildOutput([makeView({ file: 'a.md', currentLine: 3, text: 'pierwsza linia\ndruga linia' })])).toBe(
      '### a.md:3 > pierwsza linia\ndruga linia',
    );
  });

  it('leaves out resolved comments and comments on missing files', () => {
    const output = buildOutput([
      makeView({ id: '1', file: 'a.md', text: 'otwarty' }),
      makeView({ id: '2', file: 'a.md', text: 'rozwiązany', status: 'resolved' }),
      makeView({ id: '3', file: 'gone.md', text: 'bez pliku', fileMissing: true }),
    ]);
    expect(output).toBe('### a.md:2 > otwarty');
  });

  it('does not reorder the array it was given', () => {
    const views = [makeView({ id: '1', file: 'b.md' }), makeView({ id: '2', file: 'a.md' })];
    buildOutput(views);
    expect(views.map((view) => view.id)).toEqual(['1', '2']);
  });
});
````

- [ ] **Step 4: Uruchom testy i sprawdź, że nie przechodzą**

Run: `npx vitest run tests/core/derive.test.ts tests/core/output.test.ts`
Expected: FAIL, bo nie da się zaimportować `derive.js` i `output.js`.

- [ ] **Step 5: Utwórz `src/core/derive.ts`**

Definicje cech są w tabeli „Cechy wyliczane” w punkcie 6.2 specu, a `roundStatus` w punkcie 6.4. `Object.hasOwn` chroni przed nazwami plików, które pokrywają się z polami prototypu obiektu.

````ts
import { mapLine, type LinePosition } from './anchors.js';
import type { Comment, CommentView, CurrentFile, Handoff, RoundStatus } from './types.js';

export function resolvePosition(
  comment: Comment,
  current: CurrentFile | null,
  snapshotLines: string[] | null,
): LinePosition {
  if (current === null) return { currentLine: comment.anchor.line, lineChanged: false };
  if (current.hash === comment.anchor.snapshot) return { currentLine: comment.anchor.line, lineChanged: false };
  if (snapshotLines === null) {
    const lastLine = Math.max(current.lines.length, 1);
    return { currentLine: Math.min(Math.max(comment.anchor.line, 1), lastLine), lineChanged: true };
  }
  return mapLine(snapshotLines, current.lines, comment.anchor.line);
}

export function deriveCommentView(
  comment: Comment,
  handoff: Handoff | null,
  current: CurrentFile | null,
  snapshotLines: string[] | null,
): CommentView {
  const { currentLine, lineChanged } = resolvePosition(comment, current, snapshotLines);
  const handedOff = comment.status === 'open' && handoff !== null && comment.handedOffAt === handoff.at;
  return {
    id: comment.id,
    file: comment.file,
    text: comment.text,
    status: comment.status,
    createdAt: comment.createdAt,
    resolvedAt: comment.resolvedAt,
    currentLine,
    lineChanged,
    previousLineText: comment.anchor.lineText,
    handedOff,
    needsCheck: handedOff && lineChanged && comment.checkedAt === null,
    fileMissing: current === null,
  };
}

export function deriveRoundStatus(
  path: string,
  currentHash: string,
  ignored: boolean,
  handoff: Handoff | null,
): RoundStatus {
  if (handoff === null) return 'unchanged';
  if (!Object.hasOwn(handoff.files, path)) {
    return !ignored || handoff.showIgnored ? 'new' : 'unchanged';
  }
  return handoff.files[path] === currentHash ? 'unchanged' : 'changed';
}

export function compareViews(a: CommentView, b: CommentView): number {
  if (a.file !== b.file) return a.file < b.file ? -1 : 1;
  if (a.currentLine !== b.currentLine) return a.currentLine - b.currentLine;
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  return 0;
}
````

- [ ] **Step 6: Utwórz `src/core/output.ts`**

````ts
import { compareViews } from './derive.js';
import type { CommentView } from './types.js';

export function buildOutput(comments: CommentView[]): string {
  return comments
    .filter((comment) => comment.status === 'open' && !comment.fileMissing)
    .sort(compareViews)
    .map((comment) => `### ${comment.file}:${comment.currentLine} > ${comment.text}`)
    .join('\n\n');
}
````

- [ ] **Step 7: Uruchom testy i sprawdź, że przechodzą**

Run: `npx vitest run tests/core`
Expected: PASS, 40 testów w 3 plikach.

- [ ] **Step 8: Sprawdź typy**

Run: `npm run typecheck`
Expected: brak błędów.

- [ ] **Step 9: Commit**

```bash
git add src/core/types.ts src/core/derive.ts src/core/output.ts tests/helpers/factories.ts tests/core/derive.test.ts tests/core/output.test.ts
git commit -m "feat: add domain types, derived comment state and output"
```

---

### Task 3: Przekazanie

**Files:**
- Create: `src/core/handoff.ts`
- Test: `tests/core/handoff.test.ts`

**Interfaces:**
- Consumes: `resolvePosition` z `src/core/derive.ts`; `CurrentFile`, `ReviewState` z `src/core/types.ts`; `makeComment` z `tests/helpers/factories.ts`.
- Produces: `performHandoff(state: ReviewState, files: Map<string, CurrentFile>, snapshots: Map<string, string[] | null>, at: string): ReviewState`
  - `files`: obecna treść wszystkich widocznych plików, klucz to ścieżka względna.
  - `snapshots`: linie migawek wskazywanych przez kotwice otwartych komentarzy, klucz to hash migawki; `null` oznacza brak migawki na dysku.
  - `at`: czas przekazania w formacie ISO.
  - Funkcja nie modyfikuje argumentu `state`.

- [ ] **Step 1: Napisz test, który nie przechodzi**

Utwórz `tests/core/handoff.test.ts`:

````ts
import { describe, expect, it } from 'vitest';
import { performHandoff } from '../../src/core/handoff.js';
import type { CurrentFile, ReviewState } from '../../src/core/types.js';
import { makeComment } from '../helpers/factories.js';

const AT = '2026-10-01T12:30:00.000Z';

function makeState(overrides: Partial<ReviewState> = {}): ReviewState {
  return { version: 1, root: '/work', showIgnored: false, handoff: null, comments: [], ...overrides };
}

describe('performHandoff', () => {
  it('records the time, the showIgnored setting and the hash of every visible file', () => {
    const files = new Map<string, CurrentFile>([
      ['docs/a.md', { lines: ['a', 'b'], hash: 'hash-a' }],
      ['README.md', { lines: ['r'], hash: 'hash-r' }],
    ]);
    const next = performHandoff(makeState({ showIgnored: true }), files, new Map(), AT);
    expect(next.handoff).toEqual({
      at: AT,
      showIgnored: true,
      files: { 'docs/a.md': 'hash-a', 'README.md': 'hash-r' },
    });
  });

  it('re-anchors an open comment to its current line, text and file hash', () => {
    const state = makeState({ comments: [makeComment({ checkedAt: '2026-10-01T11:00:00.000Z' })] });
    const files = new Map<string, CurrentFile>([['docs/a.md', { lines: ['x', 'a', 'b'], hash: 'hash-new' }]]);
    const snapshots = new Map<string, string[] | null>([['hash-old', ['a', 'b']]]);
    const [comment] = performHandoff(state, files, snapshots, AT).comments;
    expect(comment).toMatchObject({
      handedOffAt: AT,
      checkedAt: null,
      anchor: { snapshot: 'hash-new', line: 3, lineText: 'b' },
    });
  });

  it('re-anchors to the replacement text when the commented line changed', () => {
    const state = makeState({ comments: [makeComment()] });
    const files = new Map<string, CurrentFile>([['docs/a.md', { lines: ['a', 'B'], hash: 'hash-new' }]]);
    const snapshots = new Map<string, string[] | null>([['hash-old', ['a', 'b']]]);
    const [comment] = performHandoff(state, files, snapshots, AT).comments;
    expect(comment!.anchor).toEqual({ snapshot: 'hash-new', line: 2, lineText: 'B' });
  });

  it('uses an empty line text when the file became empty', () => {
    const state = makeState({ comments: [makeComment()] });
    const files = new Map<string, CurrentFile>([['docs/a.md', { lines: [], hash: 'hash-empty' }]]);
    const snapshots = new Map<string, string[] | null>([['hash-old', ['a', 'b']]]);
    const [comment] = performHandoff(state, files, snapshots, AT).comments;
    expect(comment!.anchor).toEqual({ snapshot: 'hash-empty', line: 1, lineText: '' });
  });

  it('leaves resolved comments untouched', () => {
    const resolved = makeComment({ status: 'resolved', resolvedAt: '2026-10-01T11:00:00.000Z' });
    const files = new Map<string, CurrentFile>([['docs/a.md', { lines: ['x', 'a', 'b'], hash: 'hash-new' }]]);
    const next = performHandoff(makeState({ comments: [resolved] }), files, new Map(), AT);
    expect(next.comments[0]).toEqual(resolved);
  });

  it('leaves comments on missing files untouched', () => {
    const orphan = makeComment({ file: 'gone.md' });
    const files = new Map<string, CurrentFile>([['docs/a.md', { lines: ['a'], hash: 'hash-a' }]]);
    const next = performHandoff(makeState({ comments: [orphan] }), files, new Map(), AT);
    expect(next.comments[0]).toEqual(orphan);
  });

  it('does not modify the state it was given', () => {
    const state = makeState({ comments: [makeComment()] });
    const before = structuredClone(state);
    const files = new Map<string, CurrentFile>([['docs/a.md', { lines: ['x', 'a', 'b'], hash: 'hash-new' }]]);
    performHandoff(state, files, new Map([['hash-old', ['a', 'b']]]), AT);
    expect(state).toEqual(before);
  });
});
````

- [ ] **Step 2: Uruchom test i sprawdź, że nie przechodzi**

Run: `npx vitest run tests/core/handoff.test.ts`
Expected: FAIL, bo nie da się zaimportować `../../src/core/handoff.js`.

- [ ] **Step 3: Utwórz `src/core/handoff.ts`**

To kroki 2 i 3 z punktu 6.5 specu: każdy otwarty komentarz do istniejącego pliku dostaje nową kotwicę z aktualną linią i jej treścią, a `handoff` zapamiętuje hash każdego widocznego pliku.

````ts
import { resolvePosition } from './derive.js';
import type { CurrentFile, ReviewState } from './types.js';

export function performHandoff(
  state: ReviewState,
  files: Map<string, CurrentFile>,
  snapshots: Map<string, string[] | null>,
  at: string,
): ReviewState {
  const comments = state.comments.map((comment) => {
    const current = files.get(comment.file);
    if (comment.status !== 'open' || current === undefined) return comment;
    const snapshotLines = snapshots.get(comment.anchor.snapshot) ?? null;
    const { currentLine } = resolvePosition(comment, current, snapshotLines);
    return {
      ...comment,
      handedOffAt: at,
      checkedAt: null,
      anchor: {
        snapshot: current.hash,
        line: currentLine,
        lineText: current.lines[currentLine - 1] ?? '',
      },
    };
  });
  const hashes: Record<string, string> = {};
  for (const [path, file] of files) hashes[path] = file.hash;
  return {
    ...state,
    comments,
    handoff: { at, showIgnored: state.showIgnored, files: hashes },
  };
}
````

- [ ] **Step 4: Uruchom test i sprawdź, że przechodzi**

Run: `npx vitest run tests/core/handoff.test.ts`
Expected: PASS, 7 testów.

- [ ] **Step 5: Commit**

```bash
git add src/core/handoff.ts tests/core/handoff.test.ts
git commit -m "feat: add handoff that re-anchors open comments"
```

---

### Task 4: Zapis stanu i migawki

**Files:**
- Create: `src/server/errors.ts`
- Create: `src/server/store.ts`
- Create: `src/server/snapshots.ts`
- Create: `tests/helpers/tmp.ts`
- Test: `tests/server/store.test.ts`

**Interfaces:**
- Consumes: `ReviewState` z `src/core/types.ts`; `makeComment` z `tests/helpers/factories.ts`.
- Produces:
  - `class HttpError extends Error { status: number }`, konstruktor `new HttpError(status, message)`
  - `errorCode(error: unknown): string | undefined`, `isNotFound(error: unknown): boolean` (kody `ENOENT`, `ENOTDIR`, `EISDIR`)
  - `homeDir(): string` (`DOCSREVIEW_HOME` albo `~/.docsreview`)
  - `reviewDir(root: string): string`, `stateFile(root: string): string`
  - `emptyState(root: string): ReviewState`
  - `loadState(root: string): Promise<ReviewState>`
  - `getWarning(root: string): string | null`
  - `saveState(state: ReviewState): Promise<void>`
  - `updateState(root: string, mutate: (state: ReviewState) => ReviewState | Promise<ReviewState>): Promise<ReviewState>` (odczyt, zmiana i zapis w kolejce na katalog roboczy)
  - `loadRecent(): Promise<string[]>`, `touchRecent(root: string): Promise<void>`
  - `hashContent(content: string): string` (sha256, hex)
  - `saveSnapshot(root: string, content: string): Promise<string>` (zwraca hash)
  - `readSnapshot(root: string, hash: string): Promise<string | null>`
  - `collectGarbage(root: string, state: ReviewState): Promise<void>`
  - pomocnik testów: `makeWorkspace(): Promise<Workspace>` z polami `root`, `home` i metodami `write(relPath, content)`, `remove(relPath)`, `cleanup()`; ustawia `DOCSREVIEW_HOME`

- [ ] **Step 1: Utwórz `src/server/errors.ts`**

````ts
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export function errorCode(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code: unknown }).code;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}

export function isNotFound(error: unknown): boolean {
  const code = errorCode(error);
  return code === 'ENOENT' || code === 'ENOTDIR' || code === 'EISDIR';
}
````

- [ ] **Step 2: Utwórz `tests/helpers/tmp.ts`**

Każdy test serwera dostaje własny katalog roboczy i własny katalog stanu. `realpath` usuwa dowiązanie `/var` → `/private/var` na macOS, żeby ścieżki w testach były porównywalne.

````ts
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export interface Workspace {
  root: string;
  home: string;
  write(relPath: string, content: string): Promise<void>;
  remove(relPath: string): Promise<void>;
  cleanup(): Promise<void>;
}

export async function makeWorkspace(): Promise<Workspace> {
  const base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'docsreview-')));
  const root = path.join(base, 'work');
  const home = path.join(base, 'home');
  await fs.mkdir(root);
  await fs.mkdir(home);
  process.env.DOCSREVIEW_HOME = home;
  return {
    root,
    home,
    async write(relPath, content) {
      const file = path.join(root, relPath);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, content, 'utf8');
    },
    async remove(relPath) {
      await fs.rm(path.join(root, relPath), { recursive: true, force: true });
    },
    async cleanup() {
      delete process.env.DOCSREVIEW_HOME;
      await fs.rm(base, { recursive: true, force: true });
    },
  };
}
````

- [ ] **Step 3: Napisz test, który nie przechodzi**

Utwórz `tests/server/store.test.ts`:

````ts
import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { collectGarbage, hashContent, readSnapshot, saveSnapshot } from '../../src/server/snapshots.js';
import {
  emptyState,
  getWarning,
  loadRecent,
  loadState,
  reviewDir,
  saveState,
  stateFile,
  touchRecent,
  updateState,
} from '../../src/server/store.js';
import { makeComment } from '../helpers/factories.js';
import { makeWorkspace, type Workspace } from '../helpers/tmp.js';

let ws: Workspace;

beforeEach(async () => {
  ws = await makeWorkspace();
});

afterEach(async () => {
  await ws.cleanup();
});

describe('review directory', () => {
  it('lives under the DocsReview home and is named after the root', () => {
    const dir = reviewDir('/Users/x/Projects/my agent');
    expect(path.dirname(dir)).toBe(path.join(ws.home, 'reviews'));
    expect(path.basename(dir)).toMatch(/^my_agent-[0-9a-f]{12}$/);
  });

  it('differs for two roots with the same directory name', () => {
    expect(reviewDir('/a/docs')).not.toBe(reviewDir('/b/docs'));
  });
});

describe('state', () => {
  it('starts empty when nothing was saved', async () => {
    expect(await loadState(ws.root)).toEqual(emptyState(ws.root));
  });

  it('round-trips through disk', async () => {
    const state = { ...emptyState(ws.root), showIgnored: true, comments: [makeComment()] };
    await saveState(state);
    expect(await loadState(ws.root)).toEqual(state);
  });

  it('leaves no temporary files behind', async () => {
    await saveState(emptyState(ws.root));
    expect(await fs.readdir(reviewDir(ws.root))).toEqual(['state.json']);
  });

  it('sets a corrupt state file aside and starts empty with a warning', async () => {
    await fs.mkdir(reviewDir(ws.root), { recursive: true });
    await fs.writeFile(stateFile(ws.root), '{ not json');
    expect(await loadState(ws.root)).toEqual(emptyState(ws.root));
    const names = await fs.readdir(reviewDir(ws.root));
    expect(names).toHaveLength(1);
    expect(names[0]).toMatch(/^state\.json\.broken-/);
    expect(await fs.readFile(path.join(reviewDir(ws.root), names[0]!), 'utf8')).toBe('{ not json');
    expect(getWarning(ws.root)).toContain('state.json.broken-');
  });

  it('treats an unknown version as corrupt', async () => {
    await fs.mkdir(reviewDir(ws.root), { recursive: true });
    await fs.writeFile(stateFile(ws.root), JSON.stringify({ ...emptyState(ws.root), version: 2 }));
    expect(await loadState(ws.root)).toEqual(emptyState(ws.root));
    expect((await fs.readdir(reviewDir(ws.root)))[0]).toMatch(/^state\.json\.broken-/);
  });

  it('applies concurrent updates one after another without losing any', async () => {
    await Promise.all(
      ['a', 'b', 'c', 'd', 'e'].map((id) =>
        updateState(ws.root, (state) => ({ ...state, comments: [...state.comments, makeComment({ id })] })),
      ),
    );
    const ids = (await loadState(ws.root)).comments.map((comment) => comment.id);
    expect(ids.sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('keeps working after an update that throws', async () => {
    await expect(
      updateState(ws.root, () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    await updateState(ws.root, (state) => ({ ...state, showIgnored: true }));
    expect((await loadState(ws.root)).showIgnored).toBe(true);
  });

  it('picks up a change written to disk by another instance', async () => {
    await updateState(ws.root, (state) => ({ ...state, comments: [makeComment({ id: 'mine' })] }));
    const onDisk = JSON.parse(await fs.readFile(stateFile(ws.root), 'utf8'));
    onDisk.comments.push(makeComment({ id: 'theirs' }));
    await fs.writeFile(stateFile(ws.root), JSON.stringify(onDisk));
    await updateState(ws.root, (state) => ({ ...state, comments: [...state.comments, makeComment({ id: 'mine-2' })] }));
    const ids = (await loadState(ws.root)).comments.map((comment) => comment.id);
    expect(ids).toEqual(['mine', 'theirs', 'mine-2']);
  });
});

describe('recent directories', () => {
  it('is empty at first', async () => {
    expect(await loadRecent()).toEqual([]);
  });

  it('puts the latest directory first without duplicates', async () => {
    await touchRecent('/a');
    await touchRecent('/b');
    await touchRecent('/a');
    expect(await loadRecent()).toEqual(['/a', '/b']);
  });

  it('keeps at most ten directories', async () => {
    for (let index = 0; index < 12; index++) await touchRecent(`/dir-${index}`);
    const recent = await loadRecent();
    expect(recent).toHaveLength(10);
    expect(recent[0]).toBe('/dir-11');
  });
});

describe('snapshots', () => {
  it('stores content under its hash and reads it back', async () => {
    const hash = await saveSnapshot(ws.root, 'linia\n');
    expect(hash).toBe(hashContent('linia\n'));
    expect(await readSnapshot(ws.root, hash)).toBe('linia\n');
  });

  it('returns null for a missing or malformed hash', async () => {
    expect(await readSnapshot(ws.root, hashContent('nope'))).toBeNull();
    expect(await readSnapshot(ws.root, '../state')).toBeNull();
  });

  it('deletes snapshots that neither a comment nor the handoff refers to', async () => {
    const byComment = await saveSnapshot(ws.root, 'comment\n');
    const byHandoff = await saveSnapshot(ws.root, 'handoff\n');
    const unused = await saveSnapshot(ws.root, 'unused\n');
    await collectGarbage(ws.root, {
      ...emptyState(ws.root),
      comments: [makeComment({ anchor: { snapshot: byComment, line: 1, lineText: 'comment' } })],
      handoff: { at: '2026-10-01T12:00:00.000Z', showIgnored: false, files: { 'a.md': byHandoff } },
    });
    expect(await readSnapshot(ws.root, byComment)).toBe('comment\n');
    expect(await readSnapshot(ws.root, byHandoff)).toBe('handoff\n');
    expect(await readSnapshot(ws.root, unused)).toBeNull();
  });
});
````

- [ ] **Step 4: Uruchom test i sprawdź, że nie przechodzi**

Run: `npx vitest run tests/server/store.test.ts`
Expected: FAIL, bo nie da się zaimportować `snapshots.js` i `store.js`.

- [ ] **Step 5: Utwórz `src/server/store.ts`**

`updateState` ustawia operacje jednego procesu w kolejce i przy każdej czyta stan z dysku, więc zmiana zapisana przez inną instancję nie ginie. Uszkodzony plik stanu jest odkładany pod nazwą `state.json.broken-<data>`, a ostrzeżenie zostaje w pamięci procesu do pokazania w interfejsie.

````ts
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { ReviewState } from '../core/types.js';
import { isNotFound } from './errors.js';

const MAX_RECENT = 10;
const warnings = new Map<string, string>();
const queues = new Map<string, Promise<unknown>>();

export function homeDir(): string {
  return process.env.DOCSREVIEW_HOME ?? path.join(os.homedir(), '.docsreview');
}

export function reviewDir(root: string): string {
  const name = path.basename(root).replace(/[^A-Za-z0-9._-]/g, '_') || 'root';
  const hash = createHash('sha256').update(root).digest('hex').slice(0, 12);
  return path.join(homeDir(), 'reviews', `${name}-${hash}`);
}

export function stateFile(root: string): string {
  return path.join(reviewDir(root), 'state.json');
}

function recentFile(): string {
  return path.join(homeDir(), 'recent.json');
}

export function emptyState(root: string): ReviewState {
  return { version: 1, root, showIgnored: false, handoff: null, comments: [] };
}

async function writeAtomic(file: string, data: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await fs.writeFile(temporary, data, 'utf8');
  await fs.rename(temporary, file);
}

function isValidState(value: unknown): value is ReviewState {
  if (typeof value !== 'object' || value === null) return false;
  const state = value as Record<string, unknown>;
  return (
    state.version === 1 &&
    typeof state.showIgnored === 'boolean' &&
    Array.isArray(state.comments) &&
    (state.handoff === null || typeof state.handoff === 'object')
  );
}

export async function loadState(root: string): Promise<ReviewState> {
  const file = stateFile(root);
  let raw: string;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch (error) {
    if (isNotFound(error)) return emptyState(root);
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = undefined;
  }
  if (isValidState(parsed)) return parsed;

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const broken = `${file}.broken-${stamp}`;
  try {
    await fs.rename(file, broken);
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
  warnings.set(
    root,
    `Plik stanu był uszkodzony i został odłożony jako ${path.basename(broken)}. Review zaczyna od pustego stanu.`,
  );
  return emptyState(root);
}

export function getWarning(root: string): string | null {
  return warnings.get(root) ?? null;
}

export async function saveState(state: ReviewState): Promise<void> {
  await writeAtomic(stateFile(state.root), `${JSON.stringify(state, null, 2)}\n`);
}

export function updateState(
  root: string,
  mutate: (state: ReviewState) => ReviewState | Promise<ReviewState>,
): Promise<ReviewState> {
  const previous = queues.get(root) ?? Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(async () => {
      const state = await mutate(await loadState(root));
      await saveState(state);
      return state;
    });
  queues.set(root, next);
  return next;
}

export async function loadRecent(): Promise<string[]> {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(recentFile(), 'utf8'));
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

export async function touchRecent(root: string): Promise<void> {
  const others = (await loadRecent()).filter((item) => item !== root);
  const recent = [root, ...others].slice(0, MAX_RECENT);
  await writeAtomic(recentFile(), `${JSON.stringify(recent, null, 2)}\n`);
}
````

- [ ] **Step 6: Utwórz `src/server/snapshots.ts`**

````ts
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { ReviewState } from '../core/types.js';
import { isNotFound } from './errors.js';
import { reviewDir } from './store.js';

export function hashContent(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

function snapshotDir(root: string): string {
  return path.join(reviewDir(root), 'snapshots');
}

export async function saveSnapshot(root: string, content: string): Promise<string> {
  const hash = hashContent(content);
  const file = path.join(snapshotDir(root), `${hash}.md`);
  try {
    await fs.access(file);
  } catch {
    await fs.mkdir(snapshotDir(root), { recursive: true });
    await fs.writeFile(file, content, 'utf8');
  }
  return hash;
}

export async function readSnapshot(root: string, hash: string): Promise<string | null> {
  if (!/^[0-9a-f]{64}$/.test(hash)) return null;
  try {
    return await fs.readFile(path.join(snapshotDir(root), `${hash}.md`), 'utf8');
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

export async function collectGarbage(root: string, state: ReviewState): Promise<void> {
  const used = new Set<string>();
  for (const comment of state.comments) used.add(comment.anchor.snapshot);
  if (state.handoff !== null) {
    for (const hash of Object.values(state.handoff.files)) used.add(hash);
  }
  let names: string[];
  try {
    names = await fs.readdir(snapshotDir(root));
  } catch {
    return;
  }
  const unused = names.filter((name) => name.endsWith('.md') && !used.has(name.slice(0, -3)));
  await Promise.all(unused.map((name) => fs.rm(path.join(snapshotDir(root), name), { force: true })));
}
````

- [ ] **Step 7: Uruchom test i sprawdź, że przechodzi**

Run: `npx vitest run tests/server/store.test.ts`
Expected: PASS, 16 testów.

- [ ] **Step 8: Sprawdź typy**

Run: `npm run typecheck`
Expected: brak błędów.

- [ ] **Step 9: Commit**

```bash
git add src/server/errors.ts src/server/store.ts src/server/snapshots.ts tests/helpers/tmp.ts tests/server/store.test.ts
git commit -m "feat: add atomic review state store and snapshots"
```

---

### Task 5: Skaner plików i reguły ignorowania

**Files:**
- Create: `src/server/ignore.ts`
- Create: `src/server/scanner.ts`
- Test: `tests/server/scanner.test.ts`

**Interfaces:**
- Consumes: `homeDir` z `src/server/store.ts`; `makeWorkspace` z `tests/helpers/tmp.ts`.
- Produces:
  - `interface IgnoreLayer { dir: string; rules: Ignore }`
  - `isAlwaysSkipped(name: string): boolean` (`.git`, `node_modules`)
  - `extendLayers(layers: IgnoreLayer[], dir: string): Promise<IgnoreLayer[]>`
  - `ancestorLayers(root: string): Promise<IgnoreLayer[]>`
  - `isIgnoredBy(layers: IgnoreLayer[], absPath: string, isDir: boolean): boolean`
  - `isPathIgnored(root: string, relPath: string): Promise<boolean>`
  - `interface ScannedFile { path: string; ignored: boolean }`
  - `interface ScanOptions { showIgnored: boolean; alwaysInclude: string[] }`
  - `isMarkdown(name: string): boolean`
  - `scanFiles(root: string, options: ScanOptions): Promise<ScannedFile[]>` (posortowane po ścieżce)

- [ ] **Step 1: Napisz test, który nie przechodzi**

Utwórz `tests/server/scanner.test.ts`:

````ts
import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isPathIgnored } from '../../src/server/ignore.js';
import { scanFiles } from '../../src/server/scanner.js';
import { makeWorkspace, type Workspace } from '../helpers/tmp.js';

let ws: Workspace;

beforeEach(async () => {
  ws = await makeWorkspace();
});

afterEach(async () => {
  await ws.cleanup();
});

const visible = { showIgnored: false, alwaysInclude: [] };
const everything = { showIgnored: true, alwaysInclude: [] };

async function paths(options = visible): Promise<string[]> {
  return (await scanFiles(ws.root, options)).map((file) => file.path);
}

describe('scanFiles', () => {
  it('finds markdown files recursively, sorted by path, and nothing else', async () => {
    await ws.write('README.md', '# r\n');
    await ws.write('docs/adr/0001.md', '# a\n');
    await ws.write('docs/UPPER.MD', '# u\n');
    await ws.write('docs/notes.txt', 'n\n');
    await ws.write('src/index.ts', 'x\n');
    expect(await paths()).toEqual(['README.md', 'docs/UPPER.MD', 'docs/adr/0001.md']);
  });

  it('scans hidden directories such as .claude', async () => {
    await ws.write('.claude/skills/deploy/SKILL.md', '# s\n');
    expect(await paths()).toEqual(['.claude/skills/deploy/SKILL.md']);
  });

  it('always skips .git and node_modules, even when ignored files are shown', async () => {
    await ws.write('.git/description.md', 'x\n');
    await ws.write('node_modules/pkg/README.md', 'x\n');
    await ws.write('a.md', 'x\n');
    expect(await paths(everything)).toEqual(['a.md']);
  });

  it('does not follow symbolic links', async () => {
    await ws.write('real/a.md', 'x\n');
    await fs.symlink(path.join(ws.root, 'real'), path.join(ws.root, 'linked-dir'));
    await fs.symlink(path.join(ws.root, 'real/a.md'), path.join(ws.root, 'linked.md'));
    expect(await paths()).toEqual(['real/a.md']);
  });

  it('handles file names with spaces, Polish letters and a hash sign', async () => {
    await ws.write('docs/Plan wdrożenia #2.md', 'x\n');
    expect(await paths()).toEqual(['docs/Plan wdrożenia #2.md']);
  });

  it.skipIf(process.getuid?.() === 0)('skips a directory it cannot read instead of failing', async () => {
    await ws.write('ok.md', 'x\n');
    await ws.write('locked/secret.md', 'x\n');
    await fs.chmod(path.join(ws.root, 'locked'), 0o000);
    try {
      expect(await paths()).toEqual(['ok.md']);
    } finally {
      await fs.chmod(path.join(ws.root, 'locked'), 0o755);
    }
  });

  it('does not list snapshots when the DocsReview home is inside the root', async () => {
    await ws.write('a.md', 'x\n');
    const nestedHome = path.join(ws.root, '.docsreview');
    process.env.DOCSREVIEW_HOME = nestedHome;
    await fs.mkdir(path.join(nestedHome, 'reviews/x/snapshots'), { recursive: true });
    await fs.writeFile(path.join(nestedHome, 'reviews/x/snapshots/abc.md'), 'x\n');
    expect(await paths()).toEqual(['a.md']);
  });
});

describe('ignored files', () => {
  it('hides files matched by .gitignore in the root', async () => {
    await ws.write('.gitignore', 'vendor/\n*.local.md\n');
    await ws.write('vendor/pkg/README.md', 'x\n');
    await ws.write('CLAUDE.local.md', 'x\n');
    await ws.write('docs/a.md', 'x\n');
    expect(await paths()).toEqual(['docs/a.md']);
  });

  it('shows them flagged as ignored when showIgnored is on', async () => {
    await ws.write('.gitignore', 'vendor/\n*.local.md\n');
    await ws.write('vendor/pkg/README.md', 'x\n');
    await ws.write('CLAUDE.local.md', 'x\n');
    await ws.write('docs/a.md', 'x\n');
    expect(await scanFiles(ws.root, everything)).toEqual([
      { path: 'CLAUDE.local.md', ignored: true },
      { path: 'docs/a.md', ignored: false },
      { path: 'vendor/pkg/README.md', ignored: true },
    ]);
  });

  it('applies a .gitignore in a subdirectory to that subdirectory only', async () => {
    await ws.write('docs/.gitignore', 'drafts/\n');
    await ws.write('docs/drafts/a.md', 'x\n');
    await ws.write('drafts/b.md', 'x\n');
    expect(await paths()).toEqual(['drafts/b.md']);
  });

  it('applies .gitignore files from parent directories up to the repository root', async () => {
    await fs.mkdir(path.join(ws.root, '.git'));
    await ws.write('.gitignore', 'generated/\n');
    await ws.write('docs/generated/a.md', 'x\n');
    await ws.write('docs/b.md', 'x\n');
    const sub = path.join(ws.root, 'docs');
    expect((await scanFiles(sub, visible)).map((file) => file.path)).toEqual(['b.md']);
  });

  it('ignores parent .gitignore files when the root is not inside a repository', async () => {
    await ws.write('.gitignore', 'generated/\n');
    await ws.write('docs/generated/a.md', 'x\n');
    const sub = path.join(ws.root, 'docs');
    expect((await scanFiles(sub, visible)).map((file) => file.path)).toEqual(['generated/a.md']);
  });

  it('shows nothing by default when the root itself is ignored, and everything flagged with showIgnored', async () => {
    await fs.mkdir(path.join(ws.root, '.git'));
    await ws.write('.gitignore', '.superpowers/\n');
    await ws.write('.superpowers/plan.md', 'x\n');
    const sub = path.join(ws.root, '.superpowers');
    expect(await scanFiles(sub, visible)).toEqual([]);
    expect(await scanFiles(sub, everything)).toEqual([{ path: 'plan.md', ignored: true }]);
  });

  it('always includes an ignored file that has comments', async () => {
    await ws.write('.gitignore', '.superpowers/\n');
    await ws.write('.superpowers/plan.md', 'x\n');
    await ws.write('.superpowers/other.md', 'x\n');
    await ws.write('a.md', 'x\n');
    const files = await scanFiles(ws.root, { showIgnored: false, alwaysInclude: ['.superpowers/plan.md', 'gone.md'] });
    expect(files).toEqual([
      { path: '.superpowers/plan.md', ignored: true },
      { path: 'a.md', ignored: false },
    ]);
  });

  it('keeps working when a .gitignore cannot be read', async () => {
    await fs.mkdir(path.join(ws.root, '.gitignore'));
    await ws.write('a.md', 'x\n');
    expect(await paths()).toEqual(['a.md']);
  });
});

describe('isPathIgnored', () => {
  it('agrees with the scanner for single files', async () => {
    await ws.write('.gitignore', 'vendor/\n*.local.md\n');
    await ws.write('docs/.gitignore', 'drafts/\n');
    expect(await isPathIgnored(ws.root, 'vendor/pkg/README.md')).toBe(true);
    expect(await isPathIgnored(ws.root, 'CLAUDE.local.md')).toBe(true);
    expect(await isPathIgnored(ws.root, 'docs/drafts/a.md')).toBe(true);
    expect(await isPathIgnored(ws.root, 'docs/a.md')).toBe(false);
  });

  it('treats every file as ignored when the root itself is ignored', async () => {
    await fs.mkdir(path.join(ws.root, '.git'));
    await ws.write('.gitignore', '.superpowers/\n');
    await ws.write('.superpowers/plan.md', 'x\n');
    expect(await isPathIgnored(path.join(ws.root, '.superpowers'), 'plan.md')).toBe(true);
  });
});
````

- [ ] **Step 2: Uruchom test i sprawdź, że nie przechodzi**

Run: `npx vitest run tests/server/scanner.test.ts`
Expected: FAIL, bo nie da się zaimportować `ignore.js` i `scanner.js`.

- [ ] **Step 3: Utwórz `src/server/ignore.ts`**

Każdy plik `.gitignore` to jedna warstwa reguł przypisana do swojego katalogu. Warstwy są sprawdzane od najpłytszej do najgłębszej, a ostatnie trafienie wygrywa. Biblioteka `ignore` rzuca wyjątek dla ścieżek zaczynających się od `..` i dla pustej ścieżki, dlatego `isIgnoredBy` pomija warstwy, które nie są przodkami sprawdzanej ścieżki. Katalog trzeba testować ze ścieżką zakończoną `/`.

````ts
import fs from 'node:fs/promises';
import path from 'node:path';
import ignore, { type Ignore } from 'ignore';

export interface IgnoreLayer {
  dir: string;
  rules: Ignore;
}

const ALWAYS_SKIPPED = new Set(['.git', 'node_modules']);

export function isAlwaysSkipped(name: string): boolean {
  return ALWAYS_SKIPPED.has(name);
}

async function exists(target: string): Promise<boolean> {
  try {
    await fs.lstat(target);
    return true;
  } catch {
    return false;
  }
}

async function readLayer(dir: string): Promise<IgnoreLayer | null> {
  try {
    const content = await fs.readFile(path.join(dir, '.gitignore'), 'utf8');
    return { dir, rules: ignore().add(content) };
  } catch {
    return null;
  }
}

export async function extendLayers(layers: IgnoreLayer[], dir: string): Promise<IgnoreLayer[]> {
  const layer = await readLayer(dir);
  return layer === null ? layers : [...layers, layer];
}

export async function ancestorLayers(root: string): Promise<IgnoreLayer[]> {
  let repoRoot: string | null = null;
  let dir = root;
  for (;;) {
    if (await exists(path.join(dir, '.git'))) {
      repoRoot = dir;
      break;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  if (repoRoot === null || repoRoot === root) return [];

  const dirs: string[] = [];
  let current = path.dirname(root);
  for (;;) {
    dirs.unshift(current);
    if (current === repoRoot) break;
    current = path.dirname(current);
  }
  let layers: IgnoreLayer[] = [];
  for (const ancestor of dirs) layers = await extendLayers(layers, ancestor);
  return layers;
}

export function isIgnoredBy(layers: IgnoreLayer[], absPath: string, isDir: boolean): boolean {
  let ignored = false;
  for (const layer of layers) {
    const relative = path.relative(layer.dir, absPath).split(path.sep).join('/');
    if (relative === '' || relative.startsWith('..')) continue;
    const result = layer.rules.test(isDir ? `${relative}/` : relative);
    if (result.ignored) ignored = true;
    else if (result.unignored) ignored = false;
  }
  return ignored;
}

export async function isPathIgnored(root: string, relPath: string): Promise<boolean> {
  let layers = await ancestorLayers(root);
  if (isIgnoredBy(layers, root, true)) return true;
  layers = await extendLayers(layers, root);
  const parts = relPath.split('/');
  let current = root;
  for (let index = 0; index < parts.length; index++) {
    current = path.join(current, parts[index]!);
    const isDir = index < parts.length - 1;
    if (isIgnoredBy(layers, current, isDir)) return true;
    if (isDir) layers = await extendLayers(layers, current);
  }
  return false;
}
````

- [ ] **Step 4: Utwórz `src/server/scanner.ts`**

Przy wyłączonym `showIgnored` skaner nie wchodzi do ignorowanych katalogów. Pliki z `alwaysInclude` (te, które mają komentarze) są dołączane osobno i oznaczane jako ignorowane, bo zwykły skan ich nie znalazł.

````ts
import type { Dirent } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ancestorLayers, extendLayers, isAlwaysSkipped, isIgnoredBy, type IgnoreLayer } from './ignore.js';
import { homeDir } from './store.js';

export interface ScannedFile {
  path: string;
  ignored: boolean;
}

export interface ScanOptions {
  showIgnored: boolean;
  alwaysInclude: string[];
}

export function isMarkdown(name: string): boolean {
  return name.toLowerCase().endsWith('.md');
}

async function isRegularFile(target: string): Promise<boolean> {
  try {
    return (await fs.lstat(target)).isFile();
  } catch {
    return false;
  }
}

async function walk(
  root: string,
  dir: string,
  layers: IgnoreLayer[],
  parentIgnored: boolean,
  showIgnored: boolean,
  found: Map<string, ScannedFile>,
): Promise<void> {
  let entries: Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (isAlwaysSkipped(entry.name) || absolute === homeDir()) continue;
      const ignored = parentIgnored || isIgnoredBy(layers, absolute, true);
      if (ignored && !showIgnored) continue;
      await walk(root, absolute, await extendLayers(layers, absolute), ignored, showIgnored, found);
    } else if (entry.isFile() && isMarkdown(entry.name)) {
      const ignored = parentIgnored || isIgnoredBy(layers, absolute, false);
      if (ignored && !showIgnored) continue;
      const relative = path.relative(root, absolute).split(path.sep).join('/');
      found.set(relative, { path: relative, ignored });
    }
  }
}

export async function scanFiles(root: string, options: ScanOptions): Promise<ScannedFile[]> {
  const found = new Map<string, ScannedFile>();
  const ancestors = await ancestorLayers(root);
  const rootIgnored = isIgnoredBy(ancestors, root, true);
  if (!rootIgnored || options.showIgnored) {
    await walk(root, root, await extendLayers(ancestors, root), rootIgnored, options.showIgnored, found);
  }
  for (const relative of options.alwaysInclude) {
    if (found.has(relative)) continue;
    if (await isRegularFile(path.join(root, relative))) found.set(relative, { path: relative, ignored: true });
  }
  return [...found.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
````

- [ ] **Step 5: Uruchom test i sprawdź, że przechodzi**

Run: `npx vitest run tests/server/scanner.test.ts`
Expected: PASS, 17 testów (test z `chmod` jest pomijany przy uruchomieniu jako root).

- [ ] **Step 6: Sprawdź typy**

Run: `npm run typecheck`
Expected: brak błędów.

- [ ] **Step 7: Commit**

```bash
git add src/server/ignore.ts src/server/scanner.ts tests/server/scanner.test.ts
git commit -m "feat: scan markdown files with gitignore rules"
```

---

### Task 6: Operacje na review

**Files:**
- Create: `src/server/files.ts`
- Create: `src/server/review.ts`
- Test: `tests/server/review.test.ts`

**Interfaces:**
- Consumes:
  - z `src/core`: `changedLines`, `compareViews`, `deriveCommentView`, `deriveRoundStatus`, `performHandoff`, `splitLines`, `buildOutput` i typy
  - z `src/server`: `HttpError`, `isNotFound`, `isMarkdown`, `scanFiles`, `isPathIgnored`, `hashContent`, `saveSnapshot`, `readSnapshot`, `collectGarbage`, `loadState`, `updateState`, `loadRecent`, `getWarning`, `reviewDir`
- Produces z `src/server/files.ts`:
  - `MAX_RENDER_BYTES = 1024 * 1024`
  - `interface DiskFile { content: string; hash: string; lines: string[]; bytes: number }`
  - `normalizeRelPath(value: unknown): string` (400 dla braku ścieżki, 403 dla ścieżki poza katalogiem lub nie `.md`)
  - `readDiskFile(root: string, relPath: string): Promise<DiskFile | null>` (`null`, gdy pliku nie ma; 403, gdy rzeczywista ścieżka wychodzi poza katalog roboczy)
  - `assertReadableDir(dir: string): Promise<string>` (zwraca ścieżkę bezwzględną; `HttpError` 400, gdy katalogu nie da się odczytać)
  - `listDirs(target: string | undefined): Promise<DirListing>`
- Produces z `src/server/review.ts`:
  - `getSession(root: string): Promise<SessionInfo>`
  - `setShowIgnored(root: string, value: unknown): Promise<void>`
  - `listFiles(root: string): Promise<FileEntry[]>`
  - `getFileView(root: string, rawPath: unknown): Promise<FileView>`
  - `listComments(root: string): Promise<CommentsResponse>`
  - `addComment(root: string, input: NewComment): Promise<string>` (zwraca id)
  - `patchComment(root: string, id: string, patch: CommentPatch): Promise<void>`
  - `deleteComment(root: string, id: string): Promise<void>`
  - `deleteResolved(root: string): Promise<void>`
  - `handoff(root: string): Promise<void>`
  - `interface NewComment { file?: unknown; line?: unknown; text?: unknown; contentHash?: unknown }`
  - `interface CommentPatch { text?: unknown; status?: unknown; checked?: unknown }`
  - Błędy to `HttpError` ze statusem 400, 403, 404 lub 409 i polskim komunikatem.

- [ ] **Step 1: Napisz test, który nie przechodzi**

Utwórz `tests/server/review.test.ts`:

````ts
import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  addComment,
  deleteComment,
  deleteResolved,
  getFileView,
  getSession,
  handoff,
  listComments,
  listFiles,
  patchComment,
  setShowIgnored,
} from '../../src/server/review.js';
import { reviewDir } from '../../src/server/store.js';
import { makeWorkspace, type Workspace } from '../helpers/tmp.js';

let ws: Workspace;

beforeEach(async () => {
  ws = await makeWorkspace();
});

afterEach(async () => {
  await ws.cleanup();
});

async function comment(file: string, line: number, text: string): Promise<string> {
  const view = await getFileView(ws.root, file);
  return addComment(ws.root, { file, line, text, contentHash: view.contentHash });
}

async function snapshotCount(): Promise<number> {
  try {
    return (await fs.readdir(path.join(reviewDir(ws.root), 'snapshots'))).length;
  } catch {
    return 0;
  }
}

describe('file view', () => {
  it('returns content, hash and no round information before the first handoff', async () => {
    await ws.write('docs/a.md', 'one\ntwo\n');
    const view = await getFileView(ws.root, 'docs/a.md');
    expect(view).toMatchObject({
      path: 'docs/a.md',
      content: 'one\ntwo\n',
      tooLarge: false,
      roundStatus: 'unchanged',
      changedLines: [],
      comments: [],
    });
    expect(view.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('flags files larger than 1 MB', async () => {
    await ws.write('big.md', 'x'.repeat(1024 * 1024 + 1));
    expect((await getFileView(ws.root, 'big.md')).tooLarge).toBe(true);
  });

  it('answers 404 for a file that does not exist', async () => {
    await expect(getFileView(ws.root, 'missing.md')).rejects.toMatchObject({ status: 404 });
  });

  it('answers 403 for paths outside the root and for files that are not markdown', async () => {
    await ws.write('secret.txt', 'x\n');
    await fs.writeFile(path.join(ws.root, '..', 'outside.md'), 'x\n');
    await expect(getFileView(ws.root, '../outside.md')).rejects.toMatchObject({ status: 403 });
    await expect(getFileView(ws.root, '/etc/hosts.md')).rejects.toMatchObject({ status: 403 });
    await expect(getFileView(ws.root, 'docs/../../outside.md')).rejects.toMatchObject({ status: 403 });
    await expect(getFileView(ws.root, 'secret.txt')).rejects.toMatchObject({ status: 403 });
  });

  it('answers 403 for a markdown symlink that points outside the root', async () => {
    await fs.writeFile(path.join(ws.root, '..', 'outside.md'), 'x\n');
    await fs.symlink(path.join(ws.root, '..', 'outside.md'), path.join(ws.root, 'link.md'));
    await expect(getFileView(ws.root, 'link.md')).rejects.toMatchObject({ status: 403 });
  });

  it('reads a file whose name has spaces, Polish letters and a hash sign', async () => {
    await ws.write('docs/Plan wdrożenia #2.md', 'treść\n');
    await comment('docs/Plan wdrożenia #2.md', 1, 'ok');
    const { output } = await listComments(ws.root);
    expect(output).toBe('### docs/Plan wdrożenia #2.md:1 > ok');
  });
});

describe('adding comments', () => {
  it('stores the comment with an anchor to the commented line', async () => {
    await ws.write('a.md', 'one\ntwo\nthree\n');
    await comment('a.md', 2, '  popraw to  ');
    const [view] = (await getFileView(ws.root, 'a.md')).comments;
    expect(view).toMatchObject({
      file: 'a.md',
      text: 'popraw to',
      status: 'open',
      currentLine: 2,
      lineChanged: false,
      previousLineText: 'two',
      handedOff: false,
      needsCheck: false,
    });
  });

  it('answers 409 when the file changed after it was displayed', async () => {
    await ws.write('a.md', 'one\n');
    const view = await getFileView(ws.root, 'a.md');
    await ws.write('a.md', 'changed\n');
    await expect(
      addComment(ws.root, { file: 'a.md', line: 1, text: 'x', contentHash: view.contentHash }),
    ).rejects.toMatchObject({ status: 409 });
    expect((await listComments(ws.root)).comments).toEqual([]);
  });

  it('answers 404 when the file was deleted after it was displayed', async () => {
    await ws.write('a.md', 'one\n');
    const view = await getFileView(ws.root, 'a.md');
    await ws.remove('a.md');
    await expect(
      addComment(ws.root, { file: 'a.md', line: 1, text: 'x', contentHash: view.contentHash }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('answers 400 for an empty comment and for a line outside the file', async () => {
    await ws.write('a.md', 'one\n');
    const { contentHash } = await getFileView(ws.root, 'a.md');
    await expect(addComment(ws.root, { file: 'a.md', line: 1, text: '   \n', contentHash })).rejects.toMatchObject({
      status: 400,
    });
    for (const line of [0, 2, 1.5, '1']) {
      await expect(addComment(ws.root, { file: 'a.md', line, text: 'x', contentHash })).rejects.toMatchObject({
        status: 400,
      });
    }
  });
});

describe('changing comments', () => {
  it('resolves and reopens', async () => {
    await ws.write('a.md', 'one\n');
    const id = await comment('a.md', 1, 'x');
    await patchComment(ws.root, id, { status: 'resolved' });
    let [view] = (await listComments(ws.root)).comments;
    expect(view!.status).toBe('resolved');
    expect(view!.resolvedAt).not.toBeNull();
    await patchComment(ws.root, id, { status: 'open' });
    [view] = (await listComments(ws.root)).comments;
    expect(view).toMatchObject({ status: 'open', resolvedAt: null });
  });

  it('edits the text', async () => {
    await ws.write('a.md', 'one\n');
    const id = await comment('a.md', 1, 'x');
    await patchComment(ws.root, id, { text: ' nowa treść ' });
    expect((await listComments(ws.root)).comments[0]!.text).toBe('nowa treść');
  });

  it('answers 400 for an empty text or unknown status and 404 for an unknown comment', async () => {
    await ws.write('a.md', 'one\n');
    const id = await comment('a.md', 1, 'x');
    await expect(patchComment(ws.root, id, { text: ' ' })).rejects.toMatchObject({ status: 400 });
    await expect(patchComment(ws.root, id, { status: 'done' })).rejects.toMatchObject({ status: 400 });
    await expect(patchComment(ws.root, 'nope', { status: 'resolved' })).rejects.toMatchObject({ status: 404 });
    await expect(deleteComment(ws.root, 'nope')).rejects.toMatchObject({ status: 404 });
  });

  it('deletes one comment and cleans up its snapshot', async () => {
    await ws.write('a.md', 'one\n');
    const id = await comment('a.md', 1, 'x');
    expect(await snapshotCount()).toBe(1);
    await deleteComment(ws.root, id);
    expect((await listComments(ws.root)).comments).toEqual([]);
    expect(await snapshotCount()).toBe(0);
  });

  it('deletes all resolved comments and keeps the open ones', async () => {
    await ws.write('a.md', 'one\ntwo\n');
    const first = await comment('a.md', 1, 'pierwszy');
    await comment('a.md', 2, 'drugi');
    await patchComment(ws.root, first, { status: 'resolved' });
    await deleteResolved(ws.root);
    expect((await listComments(ws.root)).comments.map((view) => view.text)).toEqual(['drugi']);
  });
});

describe('output and missing files', () => {
  it('lists open comments of existing files in the output', async () => {
    await ws.write('b.md', 'one\n');
    await ws.write('a.md', 'one\ntwo\n');
    await comment('b.md', 1, 'w b');
    await comment('a.md', 2, 'w a');
    expect((await listComments(ws.root)).output).toBe('### a.md:2 > w a\n\n### b.md:1 > w b');
  });

  it('keeps comments of a deleted file, flags them and leaves them out of the output', async () => {
    await ws.write('a.md', 'one\n');
    await comment('a.md', 1, 'x');
    await ws.remove('a.md');
    const { comments, output } = await listComments(ws.root);
    expect(comments).toHaveLength(1);
    expect(comments[0]).toMatchObject({ fileMissing: true, currentLine: 1 });
    expect(output).toBe('');
    expect(await listFiles(ws.root)).toEqual([]);
  });

  it('reactivates the comments when the file comes back', async () => {
    await ws.write('a.md', 'one\n');
    await comment('a.md', 1, 'x');
    await ws.remove('a.md');
    await ws.write('a.md', 'zero\none\n');
    const { comments, output } = await listComments(ws.root);
    expect(comments[0]).toMatchObject({ fileMissing: false, currentLine: 2 });
    expect(output).toBe('### a.md:2 > x');
  });
});

describe('a full round', () => {
  it('re-anchors on handoff and shows what the agent changed afterwards', async () => {
    await ws.write('a.md', 'intro\nUruchom `npm start`\noutro\n');
    await ws.write('b.md', 'untouched\n');
    await ws.write('c.md', 'will change\n');
    await comment('a.md', 2, 'podaj komendę npx');

    await handoff(ws.root);
    expect((await getSession(ws.root)).lastHandoffAt).not.toBeNull();
    let view = await getFileView(ws.root, 'a.md');
    expect(view.roundStatus).toBe('unchanged');
    expect(view.comments[0]).toMatchObject({ handedOff: true, lineChanged: false, needsCheck: false });

    await ws.write('a.md', 'new first line\nintro\nUruchom `npm exec docsreview`\noutro\n');
    await ws.write('c.md', 'did change\n');
    await ws.write('d.md', 'brand new\n');

    view = await getFileView(ws.root, 'a.md');
    expect(view.roundStatus).toBe('changed');
    expect(view.changedLines).toEqual([1, 3]);
    expect(view.comments[0]).toMatchObject({
      currentLine: 3,
      lineChanged: true,
      previousLineText: 'Uruchom `npm start`',
      handedOff: true,
      needsCheck: true,
    });
    expect(await listFiles(ws.root)).toEqual([
      { path: 'a.md', openComments: 1, ignored: false, roundStatus: 'changed' },
      { path: 'b.md', openComments: 0, ignored: false, roundStatus: 'unchanged' },
      { path: 'c.md', openComments: 0, ignored: false, roundStatus: 'changed' },
      { path: 'd.md', openComments: 0, ignored: false, roundStatus: 'new' },
    ]);
    expect((await getFileView(ws.root, 'c.md')).changedLines).toEqual([1]);
    expect((await getFileView(ws.root, 'd.md')).changedLines).toEqual([]);
    expect((await listComments(ws.root)).output).toBe('### a.md:3 > podaj komendę npx');
  });

  it('stops needing a check after an edit or a confirmation', async () => {
    await ws.write('a.md', 'one\ntwo\n');
    await ws.write('b.md', 'one\ntwo\n');
    const edited = await comment('a.md', 2, 'x');
    const confirmed = await comment('b.md', 2, 'y');
    await handoff(ws.root);
    await ws.write('a.md', 'one\nTWO\n');
    await ws.write('b.md', 'one\nTWO\n');
    expect((await listComments(ws.root)).comments.map((view) => view.needsCheck)).toEqual([true, true]);
    await patchComment(ws.root, edited, { text: 'nadal źle' });
    await patchComment(ws.root, confirmed, { checked: true });
    expect((await listComments(ws.root)).comments.map((view) => view.needsCheck)).toEqual([false, false]);
  });

  it('shows the text from the previous handoff after a second handoff', async () => {
    await ws.write('a.md', 'Uruchom `npm start`\n');
    await comment('a.md', 1, 'podaj komendę npx');
    await handoff(ws.root);
    await ws.write('a.md', 'Uruchom `npm exec docsreview`\n');
    await handoff(ws.root);

    let [view] = (await getFileView(ws.root, 'a.md')).comments;
    expect(view).toMatchObject({ lineChanged: false, needsCheck: false, previousLineText: 'Uruchom `npm exec docsreview`' });
    expect((await getFileView(ws.root, 'a.md')).changedLines).toEqual([]);

    await ws.write('a.md', 'Uruchom `npx docsreview`\n');
    [view] = (await getFileView(ws.root, 'a.md')).comments;
    expect(view).toMatchObject({
      lineChanged: true,
      needsCheck: true,
      previousLineText: 'Uruchom `npm exec docsreview`',
    });
  });

  it('treats a comment added after the handoff as not handed off', async () => {
    await ws.write('a.md', 'one\ntwo\n');
    await comment('a.md', 1, 'stary');
    await handoff(ws.root);
    await comment('a.md', 2, 'nowy');
    const views = (await getFileView(ws.root, 'a.md')).comments;
    expect(views.map((view) => [view.text, view.handedOff])).toEqual([
      ['stary', true],
      ['nowy', false],
    ]);
  });

  it('answers 409 when there is nothing to hand off', async () => {
    await ws.write('a.md', 'one\n');
    await expect(handoff(ws.root)).rejects.toMatchObject({ status: 409 });
    const id = await comment('a.md', 1, 'x');
    await patchComment(ws.root, id, { status: 'resolved' });
    await expect(handoff(ws.root)).rejects.toMatchObject({ status: 409 });
    await patchComment(ws.root, id, { status: 'open' });
    await ws.remove('a.md');
    await expect(handoff(ws.root)).rejects.toMatchObject({ status: 409 });
    expect((await getSession(ws.root)).lastHandoffAt).toBeNull();
  });

  it('keeps only the snapshots that the new handoff and the comments need', async () => {
    await ws.write('a.md', 'v1\n');
    await ws.write('b.md', 'b\n');
    await comment('a.md', 1, 'x');
    await handoff(ws.root);
    expect(await snapshotCount()).toBe(2);
    await ws.write('a.md', 'v2\n');
    await handoff(ws.root);
    expect(await snapshotCount()).toBe(2);
  });

  it('falls back to the anchor line when a snapshot was deleted by hand', async () => {
    await ws.write('a.md', 'one\ntwo\nthree\n');
    await comment('a.md', 3, 'x');
    await fs.rm(path.join(reviewDir(ws.root), 'snapshots'), { recursive: true });
    await ws.write('a.md', 'one\ntwo\n');
    const [view] = (await getFileView(ws.root, 'a.md')).comments;
    expect(view).toMatchObject({ currentLine: 2, lineChanged: true });
  });
});

describe('ignored files', () => {
  it('hides ignored files until showIgnored is switched on', async () => {
    await ws.write('.gitignore', 'CLAUDE.local.md\n');
    await ws.write('CLAUDE.local.md', 'x\n');
    await ws.write('a.md', 'x\n');
    expect((await listFiles(ws.root)).map((file) => file.path)).toEqual(['a.md']);
    await setShowIgnored(ws.root, true);
    expect(await getSession(ws.root)).toMatchObject({ showIgnored: true });
    expect(await listFiles(ws.root)).toEqual([
      { path: 'CLAUDE.local.md', openComments: 0, ignored: true, roundStatus: 'unchanged' },
      { path: 'a.md', openComments: 0, ignored: false, roundStatus: 'unchanged' },
    ]);
  });

  it('keeps an ignored file with a comment visible after showIgnored is switched off', async () => {
    await ws.write('.gitignore', 'CLAUDE.local.md\n');
    await ws.write('CLAUDE.local.md', 'x\n');
    await setShowIgnored(ws.root, true);
    await comment('CLAUDE.local.md', 1, 'x');
    await setShowIgnored(ws.root, false);
    expect(await listFiles(ws.root)).toEqual([
      { path: 'CLAUDE.local.md', openComments: 1, ignored: true, roundStatus: 'unchanged' },
    ]);
  });

  it('does not call ignored files new when they were hidden at handoff', async () => {
    await ws.write('.gitignore', 'vendor/\n');
    await ws.write('vendor/README.md', 'x\n');
    await ws.write('a.md', 'x\n');
    await comment('a.md', 1, 'x');
    await handoff(ws.root);
    await setShowIgnored(ws.root, true);
    const vendor = (await listFiles(ws.root)).find((file) => file.path === 'vendor/README.md');
    expect(vendor).toMatchObject({ ignored: true, roundStatus: 'unchanged' });
    expect((await getFileView(ws.root, 'vendor/README.md')).roundStatus).toBe('unchanged');
  });

  it('answers 400 for a showIgnored value that is not a boolean', async () => {
    await expect(setShowIgnored(ws.root, 'yes')).rejects.toMatchObject({ status: 400 });
  });
});
````

- [ ] **Step 2: Uruchom test i sprawdź, że nie przechodzi**

Run: `npx vitest run tests/server/review.test.ts`
Expected: FAIL, bo nie da się zaimportować `../../src/server/review.js`.

- [ ] **Step 3: Utwórz `src/server/files.ts`**

`readDiskFile` porównuje rzeczywiste ścieżki (`realpath`) pliku i katalogu roboczego, więc dowiązanie symboliczne prowadzące na zewnątrz daje 403.

````ts
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { splitLines } from '../core/lines.js';
import type { DirListing } from '../core/types.js';
import { HttpError, isNotFound } from './errors.js';
import { isMarkdown } from './scanner.js';
import { hashContent } from './snapshots.js';

export const MAX_RENDER_BYTES = 1024 * 1024;

export interface DiskFile {
  content: string;
  hash: string;
  lines: string[];
  bytes: number;
}

export function normalizeRelPath(value: unknown): string {
  if (typeof value !== 'string' || value === '') throw new HttpError(400, 'Brak ścieżki pliku');
  const normalized = path.posix.normalize(value);
  const escapes = normalized === '..' || normalized.startsWith('../') || normalized.startsWith('/');
  if (escapes || !isMarkdown(normalized)) throw new HttpError(403, 'Niedozwolona ścieżka');
  return normalized;
}

export async function readDiskFile(root: string, relPath: string): Promise<DiskFile | null> {
  let realRoot: string;
  let realFile: string;
  try {
    realRoot = await fs.realpath(root);
    realFile = await fs.realpath(path.join(root, relPath));
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
  if (!realFile.startsWith(realRoot + path.sep) || !isMarkdown(realFile)) {
    throw new HttpError(403, 'Niedozwolona ścieżka');
  }
  let buffer: Buffer;
  try {
    buffer = await fs.readFile(realFile);
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
  const content = buffer.toString('utf8');
  return { content, hash: hashContent(content), lines: splitLines(content), bytes: buffer.byteLength };
}

export async function assertReadableDir(dir: string): Promise<string> {
  const resolved = path.resolve(dir);
  try {
    const stats = await fs.stat(resolved);
    if (!stats.isDirectory()) throw new Error('not a directory');
    await fs.readdir(resolved);
  } catch {
    throw new HttpError(400, `Katalog nie istnieje lub nie można go odczytać: ${resolved}`);
  }
  return resolved;
}

export async function listDirs(target: string | undefined): Promise<DirListing> {
  const dir = await assertReadableDir(target === undefined || target === '' ? os.homedir() : target);
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const dirs = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
  const parent = path.dirname(dir);
  return { path: dir, parent: parent === dir ? null : parent, dirs };
}
````

- [ ] **Step 4: Utwórz `src/server/review.ts`**

Kolejność w `handoff` ma znaczenie: najpierw odczyt wszystkich widocznych plików, potem sprawdzenie, czy jest co przekazać (409), potem odczyt migawek starych kotwic, dopiero na końcu zapis nowych migawek i nowego stanu. Sprzątanie migawek idzie po zapisie stanu.

````ts
import { randomUUID } from 'node:crypto';
import { changedLines } from '../core/anchors.js';
import { compareViews, deriveCommentView, deriveRoundStatus } from '../core/derive.js';
import { performHandoff } from '../core/handoff.js';
import { splitLines } from '../core/lines.js';
import { buildOutput } from '../core/output.js';
import type {
  CommentView,
  CommentsResponse,
  CurrentFile,
  FileEntry,
  FileView,
  ReviewState,
  RoundStatus,
  SessionInfo,
} from '../core/types.js';
import { HttpError } from './errors.js';
import { MAX_RENDER_BYTES, normalizeRelPath, readDiskFile, type DiskFile } from './files.js';
import { isPathIgnored } from './ignore.js';
import { scanFiles } from './scanner.js';
import { collectGarbage, readSnapshot, saveSnapshot } from './snapshots.js';
import { getWarning, loadRecent, loadState, updateState } from './store.js';

type SnapshotCache = Map<string, string[] | null>;

export interface NewComment {
  file?: unknown;
  line?: unknown;
  text?: unknown;
  contentHash?: unknown;
}

export interface CommentPatch {
  text?: unknown;
  status?: unknown;
  checked?: unknown;
}

function commentedFiles(state: ReviewState): string[] {
  return [...new Set(state.comments.map((comment) => comment.file))];
}

async function safeRead(root: string, file: string): Promise<DiskFile | null> {
  try {
    return await readDiskFile(root, file);
  } catch (error) {
    if (error instanceof HttpError) return null;
    throw error;
  }
}

async function snapshotLines(root: string, hash: string, cache: SnapshotCache): Promise<string[] | null> {
  if (!cache.has(hash)) {
    const content = await readSnapshot(root, hash);
    cache.set(hash, content === null ? null : splitLines(content));
  }
  return cache.get(hash) ?? null;
}

async function viewsForFile(
  root: string,
  state: ReviewState,
  file: string,
  disk: DiskFile | null,
  cache: SnapshotCache,
): Promise<CommentView[]> {
  const views: CommentView[] = [];
  for (const comment of state.comments) {
    if (comment.file !== file) continue;
    const needsSnapshot = disk !== null && disk.hash !== comment.anchor.snapshot;
    const snapshot = needsSnapshot ? await snapshotLines(root, comment.anchor.snapshot, cache) : null;
    views.push(deriveCommentView(comment, state.handoff, disk, snapshot));
  }
  return views;
}

function cleanText(value: unknown): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (text === '') throw new HttpError(400, 'Komentarz nie może być pusty');
  return text;
}

export async function getSession(root: string): Promise<SessionInfo> {
  const state = await loadState(root);
  return {
    root,
    recent: await loadRecent(),
    showIgnored: state.showIgnored,
    lastHandoffAt: state.handoff?.at ?? null,
    warning: getWarning(root),
  };
}

export async function setShowIgnored(root: string, value: unknown): Promise<void> {
  if (typeof value !== 'boolean') throw new HttpError(400, 'Nieprawidłowa wartość showIgnored');
  await updateState(root, (state) => ({ ...state, showIgnored: value }));
}

export async function listFiles(root: string): Promise<FileEntry[]> {
  const state = await loadState(root);
  const scanned = await scanFiles(root, { showIgnored: state.showIgnored, alwaysInclude: commentedFiles(state) });
  const entries: FileEntry[] = [];
  for (const file of scanned) {
    let roundStatus: RoundStatus = 'unchanged';
    if (state.handoff !== null) {
      const tracked = Object.hasOwn(state.handoff.files, file.path);
      const disk = tracked ? await safeRead(root, file.path) : null;
      if (!tracked || disk !== null) {
        roundStatus = deriveRoundStatus(file.path, disk?.hash ?? '', file.ignored, state.handoff);
      }
    }
    const openComments = state.comments.filter(
      (comment) => comment.file === file.path && comment.status === 'open',
    ).length;
    entries.push({ path: file.path, openComments, ignored: file.ignored, roundStatus });
  }
  return entries;
}

export async function getFileView(root: string, rawPath: unknown): Promise<FileView> {
  const file = normalizeRelPath(rawPath);
  const disk = await readDiskFile(root, file);
  if (disk === null) throw new HttpError(404, 'Plik nie istnieje');
  const state = await loadState(root);
  const cache: SnapshotCache = new Map();

  const tracked = state.handoff !== null && Object.hasOwn(state.handoff.files, file);
  const ignored = state.handoff !== null && !tracked ? await isPathIgnored(root, file) : false;
  const roundStatus = deriveRoundStatus(file, disk.hash, ignored, state.handoff);
  let changed: number[] = [];
  if (roundStatus === 'changed' && state.handoff !== null) {
    const before = await snapshotLines(root, state.handoff.files[file]!, cache);
    if (before !== null) changed = changedLines(before, disk.lines);
  }
  const comments = (await viewsForFile(root, state, file, disk, cache)).sort(compareViews);
  return {
    path: file,
    content: disk.content,
    contentHash: disk.hash,
    tooLarge: disk.bytes > MAX_RENDER_BYTES,
    roundStatus,
    changedLines: changed,
    comments,
  };
}

export async function listComments(root: string): Promise<CommentsResponse> {
  const state = await loadState(root);
  const cache: SnapshotCache = new Map();
  const comments: CommentView[] = [];
  for (const file of commentedFiles(state)) {
    const disk = await safeRead(root, file);
    comments.push(...(await viewsForFile(root, state, file, disk, cache)));
  }
  comments.sort(compareViews);
  return { comments, output: buildOutput(comments) };
}

export async function addComment(root: string, input: NewComment): Promise<string> {
  const file = normalizeRelPath(input.file);
  const text = cleanText(input.text);
  const disk = await readDiskFile(root, file);
  if (disk === null) throw new HttpError(404, 'Plik nie istnieje');
  if (disk.hash !== input.contentHash) throw new HttpError(409, 'Plik zmienił się od wyświetlenia');
  const line = input.line;
  if (typeof line !== 'number' || !Number.isInteger(line) || line < 1 || line > disk.lines.length) {
    throw new HttpError(400, 'Nieprawidłowy numer linii');
  }
  await saveSnapshot(root, disk.content);
  const id = randomUUID();
  await updateState(root, (state) => ({
    ...state,
    comments: [
      ...state.comments,
      {
        id,
        file,
        text,
        status: 'open',
        createdAt: new Date().toISOString(),
        resolvedAt: null,
        handedOffAt: null,
        checkedAt: null,
        anchor: { snapshot: disk.hash, line, lineText: disk.lines[line - 1] ?? '' },
      },
    ],
  }));
  return id;
}

export async function patchComment(root: string, id: string, patch: CommentPatch): Promise<void> {
  const text = patch.text === undefined ? undefined : cleanText(patch.text);
  if (patch.status !== undefined && patch.status !== 'open' && patch.status !== 'resolved') {
    throw new HttpError(400, 'Nieprawidłowy status');
  }
  await updateState(root, (state) => {
    const index = state.comments.findIndex((comment) => comment.id === id);
    if (index === -1) throw new HttpError(404, 'Komentarz nie istnieje');
    const now = new Date().toISOString();
    let comment = state.comments[index]!;
    if (text !== undefined) comment = { ...comment, text, checkedAt: now };
    if (patch.status === 'resolved') comment = { ...comment, status: 'resolved', resolvedAt: now };
    if (patch.status === 'open') comment = { ...comment, status: 'open', resolvedAt: null };
    if (patch.checked === true) comment = { ...comment, checkedAt: now };
    const comments = [...state.comments];
    comments[index] = comment;
    return { ...state, comments };
  });
}

export async function deleteComment(root: string, id: string): Promise<void> {
  const state = await updateState(root, (current) => {
    if (!current.comments.some((comment) => comment.id === id)) throw new HttpError(404, 'Komentarz nie istnieje');
    return { ...current, comments: current.comments.filter((comment) => comment.id !== id) };
  });
  await collectGarbage(root, state);
}

export async function deleteResolved(root: string): Promise<void> {
  const state = await updateState(root, (current) => ({
    ...current,
    comments: current.comments.filter((comment) => comment.status !== 'resolved'),
  }));
  await collectGarbage(root, state);
}

export async function handoff(root: string): Promise<void> {
  const state = await updateState(root, async (current) => {
    const scanned = await scanFiles(root, {
      showIgnored: current.showIgnored,
      alwaysInclude: commentedFiles(current),
    });
    const disks = new Map<string, DiskFile>();
    for (const entry of scanned) {
      const disk = await safeRead(root, entry.path);
      if (disk !== null) disks.set(entry.path, disk);
    }
    const open = current.comments.filter((comment) => comment.status === 'open' && disks.has(comment.file));
    if (open.length === 0) throw new HttpError(409, 'Brak otwartych komentarzy do przekazania');

    const cache: SnapshotCache = new Map();
    for (const comment of open) await snapshotLines(root, comment.anchor.snapshot, cache);
    const files = new Map<string, CurrentFile>();
    for (const [file, disk] of disks) {
      await saveSnapshot(root, disk.content);
      files.set(file, { lines: disk.lines, hash: disk.hash });
    }
    return performHandoff(current, files, cache, new Date().toISOString());
  });
  await collectGarbage(root, state);
}
````

- [ ] **Step 5: Uruchom test i sprawdź, że przechodzi**

Run: `npx vitest run tests/server/review.test.ts`
Expected: PASS, 29 testów.

- [ ] **Step 6: Sprawdź typy**

Run: `npm run typecheck`
Expected: brak błędów.

- [ ] **Step 7: Commit**

```bash
git add src/server/files.ts src/server/review.ts tests/server/review.test.ts
git commit -m "feat: add review operations for files, comments and handoff"
```

---

### Task 7: API HTTP

**Files:**
- Create: `src/server/events.ts`
- Create: `src/server/security.ts`
- Create: `src/server/app.ts`
- Test: `tests/server/app.test.ts`

**Interfaces:**
- Consumes: wszystkie funkcje z `src/server/review.ts`; `listDirs`, `assertReadableDir` z `src/server/files.ts`; `HttpError`; `ServerEvent` z `src/core/types.ts`.
- Produces:
  - `class EventHub { subscribe(listener: (event: ServerEvent) => void): () => void; emit(event: ServerEvent): void }`
  - `createToken(): string` (`DOCSREVIEW_TOKEN` albo 48 losowych znaków hex)
  - `tokenMatches(provided: string | undefined, expected: string): boolean`
  - `isAllowedUrl(requestUrl: string, port: number): boolean`
  - `interface AppContext { token: string; port: number; webDir: string | null; hub: EventHub; getRoot(): string; setRoot(dir: string): Promise<void> }`
  - `createApp(ctx: AppContext): Hono`
  - Trasy: `GET /api/session`, `POST /api/root`, `GET /api/dirs`, `PATCH /api/review`, `GET /api/files`, `GET /api/file`, `GET /api/comments`, `POST /api/comments` (201 `{ id }`), `PATCH /api/comments/:id`, `DELETE /api/comments/:id`, `DELETE /api/comments?status=resolved`, `POST /api/handoff`, `GET /api/events`. Błąd ma postać `{ error: string }`.

- [ ] **Step 1: Napisz test, który nie przechodzi**

Utwórz `tests/server/app.test.ts`. Testy wołają aplikację przez `app.request()` z pełnym adresem, bo kontrola hosta czyta host z adresu żądania.

````ts
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CommentsResponse, FileEntry, FileView, ServerEvent, SessionInfo } from '../../src/core/types.js';
import { createApp, type AppContext } from '../../src/server/app.js';
import { EventHub } from '../../src/server/events.js';
import { assertReadableDir } from '../../src/server/files.js';
import { isAllowedUrl, tokenMatches } from '../../src/server/security.js';
import { makeWorkspace, type Workspace } from '../helpers/tmp.js';

const TOKEN = 'test-token';
const PORT = 4477;
const ORIGIN = `http://127.0.0.1:${PORT}`;

let ws: Workspace;
let app: Hono;
let ctx: AppContext;
let events: ServerEvent[];

beforeEach(async () => {
  ws = await makeWorkspace();
  let root = ws.root;
  const hub = new EventHub();
  events = [];
  hub.subscribe((event) => events.push(event));
  ctx = {
    token: TOKEN,
    port: PORT,
    webDir: null,
    hub,
    getRoot: () => root,
    setRoot: async (dir) => {
      root = await assertReadableDir(dir);
    },
  };
  app = createApp(ctx);
});

afterEach(async () => {
  await ws.cleanup();
});

function call(method: string, url: string, body?: unknown): Promise<Response> {
  return Promise.resolve(
    app.request(`${ORIGIN}${url}`, {
      method,
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
}

async function json<T>(method: string, url: string, body?: unknown): Promise<T> {
  const response = await call(method, url, body);
  expect(response.status).toBeLessThan(300);
  return (await response.json()) as T;
}

describe('security helpers', () => {
  it('accepts only the exact token', () => {
    expect(tokenMatches('abc', 'abc')).toBe(true);
    expect(tokenMatches('abd', 'abc')).toBe(false);
    expect(tokenMatches('abcd', 'abc')).toBe(false);
    expect(tokenMatches(undefined, 'abc')).toBe(false);
  });

  it('accepts only loopback hosts on the server port', () => {
    expect(isAllowedUrl('http://127.0.0.1:4477/api/files', 4477)).toBe(true);
    expect(isAllowedUrl('http://localhost:4477/api/files', 4477)).toBe(true);
    expect(isAllowedUrl('http://127.0.0.1:4478/api/files', 4477)).toBe(false);
    expect(isAllowedUrl('http://evil.example:4477/api/files', 4477)).toBe(false);
    expect(isAllowedUrl('http://127.0.0.1.evil.example:4477/api/files', 4477)).toBe(false);
    expect(isAllowedUrl('not a url', 4477)).toBe(false);
  });
});

describe('API access', () => {
  it('answers 401 without a token and with a wrong token', async () => {
    expect((await app.request(`${ORIGIN}/api/session`)).status).toBe(401);
    const wrong = await app.request(`${ORIGIN}/api/session`, { headers: { authorization: 'Bearer nope' } });
    expect(wrong.status).toBe(401);
  });

  it('answers 403 for a foreign Host even with a valid token', async () => {
    const response = await app.request(`http://evil.example:${PORT}/api/session`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(response.status).toBe(403);
  });

  it('does not accept the token as a query parameter outside the event stream', async () => {
    expect((await app.request(`${ORIGIN}/api/session?token=${TOKEN}`)).status).toBe(401);
  });

  it('answers 404 as JSON for an unknown API path', async () => {
    const response = await call('GET', '/api/nope');
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Nie znaleziono' });
  });
});

describe('API routes', () => {
  it('returns the session', async () => {
    const session = await json<SessionInfo>('GET', '/api/session');
    expect(session).toEqual({ root: ws.root, recent: [], showIgnored: false, lastHandoffAt: null, warning: null });
  });

  it('runs a comment through its whole life', async () => {
    await ws.write('docs/Plan wdrożenia #2.md', 'one\ntwo\n');
    const filePath = 'docs/Plan wdrożenia #2.md';
    const files = await json<FileEntry[]>('GET', '/api/files');
    expect(files.map((file) => file.path)).toEqual([filePath]);

    const view = await json<FileView>('GET', `/api/file?path=${encodeURIComponent(filePath)}`);
    const created = await call('POST', '/api/comments', {
      file: filePath,
      line: 2,
      text: 'popraw',
      contentHash: view.contentHash,
    });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };

    let comments = await json<CommentsResponse>('GET', '/api/comments');
    expect(comments.output).toBe(`### ${filePath}:2 > popraw`);

    await json('POST', '/api/handoff');
    await json('PATCH', `/api/comments/${id}`, { status: 'resolved' });
    comments = await json<CommentsResponse>('GET', '/api/comments');
    expect(comments.output).toBe('');

    await json('DELETE', '/api/comments?status=resolved');
    comments = await json<CommentsResponse>('GET', '/api/comments');
    expect(comments.comments).toEqual([]);
    expect(events.filter((event) => event.type === 'review-changed')).toHaveLength(4);
  });

  it('passes service errors through with their status and message', async () => {
    await ws.write('a.md', 'one\n');
    const stale = await call('POST', '/api/comments', { file: 'a.md', line: 1, text: 'x', contentHash: 'old' });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toEqual({ error: 'Plik zmienił się od wyświetlenia' });
    expect((await call('GET', '/api/file?path=missing.md')).status).toBe(404);
    expect((await call('GET', '/api/file?path=../x.md')).status).toBe(403);
    expect((await call('GET', '/api/file')).status).toBe(400);
    expect((await call('POST', '/api/handoff')).status).toBe(409);
    expect((await call('DELETE', '/api/comments')).status).toBe(400);
    expect((await call('DELETE', '/api/comments/nope')).status).toBe(404);
  });

  it('answers 400 for a body that is not a JSON object', async () => {
    const response = await app.request(`${ORIGIN}/api/comments`, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}` },
      body: 'not json',
    });
    expect(response.status).toBe(400);
  });

  it('switches the show-ignored setting', async () => {
    await ws.write('.gitignore', 'x.md\n');
    await ws.write('x.md', 'x\n');
    expect(await json<FileEntry[]>('GET', '/api/files')).toEqual([]);
    await json('PATCH', '/api/review', { showIgnored: true });
    expect((await json<FileEntry[]>('GET', '/api/files')).map((file) => file.path)).toEqual(['x.md']);
  });

  it('lists subdirectories and never files', async () => {
    await ws.write('docs/a.md', 'x\n');
    await ws.write('top.md', 'x\n');
    await fs.mkdir(path.join(ws.root, '.claude'));
    const listing = await json<{ path: string; parent: string; dirs: string[] }>(
      'GET',
      `/api/dirs?path=${encodeURIComponent(ws.root)}`,
    );
    expect(listing).toEqual({ path: ws.root, parent: path.dirname(ws.root), dirs: ['.claude', 'docs'] });
  });

  it('changes the root and keeps the old one when the new one is unreadable', async () => {
    await ws.write('docs/a.md', 'x\n');
    const docs = path.join(ws.root, 'docs');
    const session = await json<SessionInfo>('POST', '/api/root', { path: docs });
    expect(session.root).toBe(docs);
    const failed = await call('POST', '/api/root', { path: path.join(ws.root, 'missing') });
    expect(failed.status).toBe(400);
    expect((await json<SessionInfo>('GET', '/api/session')).root).toBe(docs);
  });
});

describe('static files', () => {
  it('serves the built frontend, falls back to index.html and stays inside the web directory', async () => {
    const webDir = path.join(ws.home, 'web');
    await fs.mkdir(path.join(webDir, 'assets'), { recursive: true });
    await fs.writeFile(path.join(webDir, 'index.html'), '<!doctype html><title>DocsReview</title>');
    await fs.writeFile(path.join(webDir, 'assets/app.js'), 'console.log(1)');
    await fs.writeFile(path.join(ws.home, 'secret.txt'), 'secret');
    ctx.webDir = webDir;

    const index = await app.request(`${ORIGIN}/?token=${TOKEN}`);
    expect(index.status).toBe(200);
    expect(index.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(await index.text()).toContain('DocsReview');

    const script = await app.request(`${ORIGIN}/assets/app.js`);
    expect(script.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
    expect(await script.text()).toBe('console.log(1)');

    const escape = await app.request(`${ORIGIN}/..%2Fsecret.txt`);
    expect(await escape.text()).toContain('DocsReview');
  });
});
````

- [ ] **Step 2: Uruchom test i sprawdź, że nie przechodzi**

Run: `npx vitest run tests/server/app.test.ts`
Expected: FAIL, bo nie da się zaimportować `app.js`, `events.js` i `security.js`.

- [ ] **Step 3: Utwórz `src/server/events.ts`**

````ts
import type { ServerEvent } from '../core/types.js';

export type Listener = (event: ServerEvent) => void;

export class EventHub {
  private readonly listeners = new Set<Listener>();

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emit(event: ServerEvent): void {
    for (const listener of [...this.listeners]) listener(event);
  }
}
````

- [ ] **Step 4: Utwórz `src/server/security.ts`**

`@hono/node-server` buduje adres żądania z nagłówka `Host`, więc sprawdzenie hosta w adresie odrzuca żądania wysłane przez obcą stronę przy ataku DNS rebinding.

````ts
import { randomBytes, timingSafeEqual } from 'node:crypto';

const LOCAL_HOSTNAMES = new Set(['127.0.0.1', 'localhost']);

export function createToken(): string {
  return process.env.DOCSREVIEW_TOKEN ?? randomBytes(24).toString('hex');
}

export function tokenMatches(provided: string | undefined, expected: string): boolean {
  if (provided === undefined) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function isAllowedUrl(requestUrl: string, port: number): boolean {
  let url: URL;
  try {
    url = new URL(requestUrl);
  } catch {
    return false;
  }
  const requestPort = url.port === '' ? '80' : url.port;
  return LOCAL_HOSTNAMES.has(url.hostname) && requestPort === String(port);
}
````

- [ ] **Step 5: Utwórz `src/server/app.ts`**

`ctx.port` jest czytany przy każdym żądaniu, bo prawdziwy port jest znany dopiero po starcie nasłuchu (Zadanie 8). Strumień SSE wysyła `ready` po połączeniu i `ping` co 15 sekund, żeby połączenie nie wygasło.

````ts
import fs from 'node:fs/promises';
import path from 'node:path';
import { Hono, type Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { ServerEvent } from '../core/types.js';
import { HttpError } from './errors.js';
import type { EventHub } from './events.js';
import { listDirs } from './files.js';
import {
  addComment,
  deleteComment,
  deleteResolved,
  getFileView,
  getSession,
  handoff,
  listComments,
  listFiles,
  patchComment,
  setShowIgnored,
} from './review.js';
import { isAllowedUrl, tokenMatches } from './security.js';

export interface AppContext {
  token: string;
  port: number;
  webDir: string | null;
  hub: EventHub;
  getRoot(): string;
  setRoot(dir: string): Promise<void>;
}

const PING_INTERVAL_MS = 15_000;

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.map': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

async function readBody(c: Context): Promise<Record<string, unknown>> {
  try {
    const value: unknown = await c.req.json();
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
  } catch {
    // fall through to the error below
  }
  throw new HttpError(400, 'Nieprawidłowe dane żądania');
}

export function createApp(ctx: AppContext): Hono {
  const app = new Hono();
  const changed = (): void => ctx.hub.emit({ type: 'review-changed' });

  app.onError((error, c) => {
    if (error instanceof HttpError) {
      return c.json({ error: error.message }, error.status as ContentfulStatusCode);
    }
    console.error(error);
    return c.json({ error: 'Błąd serwera' }, 500);
  });

  app.use('/api/*', async (c, next) => {
    if (!isAllowedUrl(c.req.url, ctx.port)) return c.json({ error: 'Niedozwolony host' }, 403);
    const header = c.req.header('authorization');
    const bearer = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;
    const provided = c.req.path === '/api/events' ? c.req.query('token') : bearer;
    if (!tokenMatches(provided, ctx.token)) return c.json({ error: 'Brak autoryzacji' }, 401);
    await next();
  });

  app.get('/api/session', async (c) => c.json(await getSession(ctx.getRoot())));

  app.post('/api/root', async (c) => {
    const body = await readBody(c);
    if (typeof body.path !== 'string' || body.path === '') throw new HttpError(400, 'Brak ścieżki katalogu');
    await ctx.setRoot(body.path);
    return c.json(await getSession(ctx.getRoot()));
  });

  app.get('/api/dirs', async (c) => c.json(await listDirs(c.req.query('path'))));

  app.patch('/api/review', async (c) => {
    const body = await readBody(c);
    await setShowIgnored(ctx.getRoot(), body.showIgnored);
    changed();
    return c.json({ ok: true });
  });

  app.get('/api/files', async (c) => c.json(await listFiles(ctx.getRoot())));

  app.get('/api/file', async (c) => c.json(await getFileView(ctx.getRoot(), c.req.query('path'))));

  app.get('/api/comments', async (c) => c.json(await listComments(ctx.getRoot())));

  app.post('/api/comments', async (c) => {
    const id = await addComment(ctx.getRoot(), await readBody(c));
    changed();
    return c.json({ id }, 201);
  });

  app.patch('/api/comments/:id', async (c) => {
    await patchComment(ctx.getRoot(), c.req.param('id'), await readBody(c));
    changed();
    return c.json({ ok: true });
  });

  app.delete('/api/comments/:id', async (c) => {
    await deleteComment(ctx.getRoot(), c.req.param('id'));
    changed();
    return c.json({ ok: true });
  });

  app.delete('/api/comments', async (c) => {
    if (c.req.query('status') !== 'resolved') throw new HttpError(400, 'Można usunąć tylko rozwiązane komentarze');
    await deleteResolved(ctx.getRoot());
    changed();
    return c.json({ ok: true });
  });

  app.post('/api/handoff', async (c) => {
    await handoff(ctx.getRoot());
    changed();
    return c.json({ ok: true });
  });

  app.get('/api/events', (c) =>
    streamSSE(c, async (stream) => {
      const queue: ServerEvent[] = [];
      let wake: (() => void) | null = null;
      const unsubscribe = ctx.hub.subscribe((event) => {
        queue.push(event);
        wake?.();
      });
      stream.onAbort(() => {
        unsubscribe();
        wake?.();
      });
      await stream.writeSSE({ event: 'ready', data: '{}' });
      while (!stream.aborted) {
        while (queue.length > 0) {
          const event = queue.shift()!;
          await stream.writeSSE({ event: event.type, data: JSON.stringify(event) });
        }
        let timer: NodeJS.Timeout | undefined;
        await new Promise<void>((resolve) => {
          wake = resolve;
          timer = setTimeout(resolve, PING_INTERVAL_MS);
        });
        clearTimeout(timer);
        wake = null;
        if (!stream.aborted && queue.length === 0) await stream.writeSSE({ event: 'ping', data: '{}' });
      }
      unsubscribe();
    }),
  );

  app.all('/api/*', (c) => c.json({ error: 'Nie znaleziono' }, 404));

  app.get('*', async (c) => {
    const webDir = ctx.webDir;
    if (webDir === null) return c.notFound();
    const index = path.join(webDir, 'index.html');
    let requested: string;
    try {
      requested = decodeURIComponent(c.req.path);
    } catch {
      requested = '/';
    }
    const candidate = path.join(webDir, requested);
    const inside = candidate.startsWith(webDir + path.sep);
    let file = inside && requested !== '/' ? candidate : index;
    let data: Buffer;
    try {
      data = await fs.readFile(file);
    } catch {
      file = index;
      try {
        data = await fs.readFile(file);
      } catch {
        return c.notFound();
      }
    }
    const type = MIME[path.extname(file)] ?? 'application/octet-stream';
    return c.body(new Uint8Array(data), 200, { 'content-type': type, 'cache-control': 'no-cache' });
  });

  return app;
}
````

- [ ] **Step 6: Uruchom test i sprawdź, że przechodzi**

Run: `npx vitest run tests/server/app.test.ts`
Expected: PASS, 14 testów.

- [ ] **Step 7: Sprawdź typy**

Run: `npm run typecheck`
Expected: brak błędów.

- [ ] **Step 8: Commit**

```bash
git add src/server/events.ts src/server/security.ts src/server/app.ts tests/server/app.test.ts
git commit -m "feat: add HTTP API with token and host checks"
```

---

### Task 8: Obserwator, start serwera i CLI

**Files:**
- Create: `src/server/watcher.ts`
- Create: `src/server/start.ts`
- Create: `src/server/args.ts`
- Create: `src/server/cli.ts`
- Test: `tests/server/start.test.ts`

**Interfaces:**
- Consumes: `createApp`, `AppContext`, `EventHub`, `createToken`, `assertReadableDir`, `touchRecent`, `homeDir`, `reviewDir`, `stateFile`, `isAlwaysSkipped`, `isMarkdown`, `errorCode`, `HttpError`.
- Produces:
  - `interface RootWatcher { ready: Promise<void>; close(): Promise<void> }`
  - `watchRoot(root: string, hub: EventHub): RootWatcher` (emituje `files-changed` z listą ścieżek i `review-changed`, oba grupowane w oknie 100 ms)
  - `interface StartOptions { root: string; port: number; webDir: string | null; token?: string }`
  - `interface RunningServer { root: string; port: number; token: string; url: string; ready: Promise<void>; close(): Promise<void> }`
  - `startServer(options: StartOptions): Promise<RunningServer>` (port `0` oznacza dowolny wolny; inny port jest punktem startu dla 50 kolejnych prób)
  - `DEFAULT_PORT = 4477`, `USAGE: string`
  - `interface CliArgs { root: string; port: number; open: boolean; help: boolean }`
  - `parseCliArgs(argv: string[]): CliArgs` (rzuca `Error` z komunikatem dla użytkownika)
  - plik wykonywalny `dist/server/cli.js` (po `npm run build`)

- [ ] **Step 1: Napisz test, który nie przechodzi**

Utwórz `tests/server/start.test.ts`:

````ts
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CommentsResponse, FileView, ServerEvent } from '../../src/core/types.js';
import { DEFAULT_PORT, parseCliArgs } from '../../src/server/args.js';
import { EventHub } from '../../src/server/events.js';
import { startServer, type RunningServer } from '../../src/server/start.js';
import { loadRecent, stateFile } from '../../src/server/store.js';
import { watchRoot } from '../../src/server/watcher.js';
import { makeWorkspace, type Workspace } from '../helpers/tmp.js';

let ws: Workspace;
const running: RunningServer[] = [];

beforeEach(async () => {
  ws = await makeWorkspace();
});

afterEach(async () => {
  await Promise.all(running.splice(0).map((server) => server.close()));
  await ws.cleanup();
});

async function start(port = 0): Promise<RunningServer> {
  const server = await startServer({ root: ws.root, port, webDir: null, token: 'tok' });
  running.push(server);
  await server.ready;
  return server;
}

async function api<T>(server: RunningServer, method: string, url: string, body?: unknown): Promise<T> {
  const response = await fetch(`http://127.0.0.1:${server.port}${url}`, {
    method,
    headers: { authorization: `Bearer ${server.token}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  expect(response.status).toBeLessThan(300);
  return (await response.json()) as T;
}

function waitFor(events: ServerEvent[], match: (event: ServerEvent) => boolean): Promise<ServerEvent> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      const found = events.find(match);
      if (found !== undefined) {
        clearInterval(timer);
        resolve(found);
      } else if (Date.now() - started > 5000) {
        clearInterval(timer);
        reject(new Error(`no matching event; got ${JSON.stringify(events)}`));
      }
    }, 20);
  });
}

describe('parseCliArgs', () => {
  it('defaults to the current directory, the default port and opening the browser', () => {
    expect(parseCliArgs([])).toEqual({ root: process.cwd(), port: DEFAULT_PORT, open: true, help: false });
  });

  it('reads the directory, the port and --no-open', () => {
    expect(parseCliArgs(['docs', '--port', '5000', '--no-open'])).toEqual({
      root: 'docs',
      port: 5000,
      open: false,
      help: false,
    });
  });

  it('rejects a port that is not a number in range, unknown options and extra directories', () => {
    expect(() => parseCliArgs(['--port', 'abc'])).toThrow('Nieprawidłowy port: abc');
    expect(() => parseCliArgs(['--port', '70000'])).toThrow('Nieprawidłowy port');
    expect(() => parseCliArgs(['--frobnicate'])).toThrow();
    expect(() => parseCliArgs(['a', 'b'])).toThrow('Podaj najwyżej jeden katalog');
  });
});

describe('startServer', () => {
  it('fails with a readable message for a directory that does not exist', async () => {
    await expect(
      startServer({ root: path.join(ws.root, 'missing'), port: 0, webDir: null }),
    ).rejects.toMatchObject({ status: 400, message: expect.stringContaining('Katalog nie istnieje') });
  });

  it('serves the API on 127.0.0.1 with the token in the URL and remembers the directory', async () => {
    const server = await start();
    expect(server.url).toBe(`http://127.0.0.1:${server.port}/?token=tok`);
    expect(await api<{ root: string }>(server, 'GET', '/api/session')).toMatchObject({ root: ws.root });
    expect(await loadRecent()).toEqual([ws.root]);
  });

  it('takes the next free port when the requested one is busy', async () => {
    const first = await start();
    const second = await start(first.port);
    expect(second.port).toBeGreaterThan(first.port);
    expect(second.port).toBeLessThan(first.port + 50);
  });

  it('rejects a request with a foreign Host header', async () => {
    const server = await start();
    const status = await new Promise<number>((resolve, reject) => {
      http
        .get(
          {
            host: '127.0.0.1',
            port: server.port,
            path: '/api/session',
            headers: { Host: `evil.example:${server.port}`, authorization: 'Bearer tok' },
          },
          (response) => {
            response.resume();
            resolve(response.statusCode ?? 0);
          },
        )
        .on('error', reject);
    });
    expect(status).toBe(403);
  });

  it('shares comments between two instances on the same directory', async () => {
    await ws.write('a.md', 'one\ntwo\n');
    const first = await start();
    const second = await start();
    const view = await api<FileView>(first, 'GET', '/api/file?path=a.md');
    await api(first, 'POST', '/api/comments', { file: 'a.md', line: 1, text: 'z pierwszej', contentHash: view.contentHash });
    await api(second, 'POST', '/api/comments', { file: 'a.md', line: 2, text: 'z drugiej', contentHash: view.contentHash });
    for (const server of [first, second]) {
      const { comments } = await api<CommentsResponse>(server, 'GET', '/api/comments');
      expect(comments.map((comment) => comment.text)).toEqual(['z pierwszej', 'z drugiej']);
    }
  });

  it('streams a files-changed event when a markdown file changes on disk', async () => {
    await ws.write('a.md', 'one\n');
    const server = await start();
    const controller = new AbortController();
    const response = await fetch(`http://127.0.0.1:${server.port}/api/events?token=tok`, {
      signal: controller.signal,
    });
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let received = decoder.decode((await reader.read()).value);
    expect(received).toContain('event: ready');

    await ws.write('a.md', 'two\n');
    while (!received.includes('event: files-changed')) {
      received += decoder.decode((await reader.read()).value);
    }
    expect(received).toContain('"paths":["a.md"]');
    controller.abort();
  });
});

describe('watchRoot', () => {
  it('groups changes into one event and reports only markdown and .gitignore files', async () => {
    await ws.write('docs/a.md', 'one\n');
    await ws.write('node_modules/pkg/README.md', 'x\n');
    const hub = new EventHub();
    const events: ServerEvent[] = [];
    hub.subscribe((event) => events.push(event));
    const watcher = watchRoot(ws.root, hub);
    await watcher.ready;
    try {
      await ws.write('docs/a.md', 'two\n');
      await ws.write('docs/new.md', 'new\n');
      await ws.write('.gitignore', 'x\n');
      await ws.write('notes.txt', 'x\n');
      await ws.write('node_modules/pkg/README.md', 'y\n');
      await waitFor(events, (event) => event.type === 'files-changed');
      await new Promise((resolve) => setTimeout(resolve, 300));
      const changed = events.filter((event) => event.type === 'files-changed');
      expect(changed).toEqual([{ type: 'files-changed', paths: ['.gitignore', 'docs/a.md', 'docs/new.md'] }]);
    } finally {
      await watcher.close();
    }
  });

  it('reports a deleted file', async () => {
    await ws.write('a.md', 'one\n');
    const hub = new EventHub();
    const events: ServerEvent[] = [];
    hub.subscribe((event) => events.push(event));
    const watcher = watchRoot(ws.root, hub);
    await watcher.ready;
    try {
      await ws.remove('a.md');
      const event = await waitFor(events, (candidate) => candidate.type === 'files-changed');
      expect(event).toEqual({ type: 'files-changed', paths: ['a.md'] });
    } finally {
      await watcher.close();
    }
  });

  it('reports a review change when another instance rewrites the state file', async () => {
    const hub = new EventHub();
    const events: ServerEvent[] = [];
    hub.subscribe((event) => events.push(event));
    const watcher = watchRoot(ws.root, hub);
    await watcher.ready;
    try {
      const temporary = `${stateFile(ws.root)}.other.tmp`;
      await fs.writeFile(temporary, '{}');
      await fs.rename(temporary, stateFile(ws.root));
      await waitFor(events, (event) => event.type === 'review-changed');
    } finally {
      await watcher.close();
    }
  });
});
````

- [ ] **Step 2: Uruchom test i sprawdź, że nie przechodzi**

Run: `npx vitest run tests/server/start.test.ts`
Expected: FAIL, bo nie da się zaimportować `args.js`, `start.js` i `watcher.js`.

- [ ] **Step 3: Utwórz `src/server/watcher.ts`**

Funkcja `ignored` w chokidar jest wołana dwa razy: raz bez `stats` i raz z nimi, dlatego filtr rozszerzeń działa tylko wtedy, gdy `stats` mówi, że to plik. Katalog stanu jest tworzony przed startem obserwatora, bo chokidar nie obserwuje katalogu, którego nie ma.

````ts
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import chokidar from 'chokidar';
import type { EventHub } from './events.js';
import { isAlwaysSkipped } from './ignore.js';
import { isMarkdown } from './scanner.js';
import { homeDir, reviewDir } from './store.js';

const DEBOUNCE_MS = 100;

export interface RootWatcher {
  ready: Promise<void>;
  close(): Promise<void>;
}

export function watchRoot(root: string, hub: EventHub): RootWatcher {
  const home = homeDir();
  const pending = new Set<string>();
  let filesTimer: NodeJS.Timeout | null = null;
  let stateTimer: NodeJS.Timeout | null = null;

  const files = chokidar.watch(root, {
    ignoreInitial: true,
    followSymlinks: false,
    ignored: (target, stats) => {
      if (target === home || target.startsWith(home + path.sep)) return true;
      if (path.relative(root, target).split(path.sep).some(isAlwaysSkipped)) return true;
      if (stats?.isFile()) return !isMarkdown(target) && path.basename(target) !== '.gitignore';
      return false;
    },
  });
  files.on('all', (event, target) => {
    if (event === 'addDir' || event === 'unlinkDir') return;
    pending.add(path.relative(root, target).split(path.sep).join('/'));
    filesTimer ??= setTimeout(() => {
      filesTimer = null;
      const paths = [...pending].sort();
      pending.clear();
      hub.emit({ type: 'files-changed', paths });
    }, DEBOUNCE_MS);
  });

  const stateDir = reviewDir(root);
  mkdirSync(stateDir, { recursive: true });
  const state = chokidar.watch(stateDir, { ignoreInitial: true, depth: 0 });
  state.on('all', (_event, target) => {
    if (path.basename(target) !== 'state.json') return;
    stateTimer ??= setTimeout(() => {
      stateTimer = null;
      hub.emit({ type: 'review-changed' });
    }, DEBOUNCE_MS);
  });

  const ready = Promise.all([
    new Promise<void>((resolve) => files.once('ready', () => resolve())),
    new Promise<void>((resolve) => state.once('ready', () => resolve())),
  ]).then(() => undefined);

  return {
    ready,
    async close() {
      if (filesTimer !== null) clearTimeout(filesTimer);
      if (stateTimer !== null) clearTimeout(stateTimer);
      await Promise.all([files.close(), state.close()]);
    },
  };
}
````

- [ ] **Step 4: Utwórz `src/server/start.ts`**

````ts
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { serve } from '@hono/node-server';
import type { Hono } from 'hono';
import { createApp, type AppContext } from './app.js';
import { errorCode } from './errors.js';
import { EventHub } from './events.js';
import { assertReadableDir } from './files.js';
import { createToken } from './security.js';
import { touchRecent } from './store.js';
import { watchRoot } from './watcher.js';

const PORT_ATTEMPTS = 50;

export interface StartOptions {
  root: string;
  port: number;
  webDir: string | null;
  token?: string;
}

export interface RunningServer {
  root: string;
  port: number;
  token: string;
  url: string;
  ready: Promise<void>;
  close(): Promise<void>;
}

function tryListen(app: Hono, port: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = serve({ fetch: app.fetch, port, hostname: '127.0.0.1' }) as Server;
    server.once('error', reject);
    server.once('listening', () => resolve(server));
  });
}

async function listen(app: Hono, port: number): Promise<Server> {
  for (let attempt = 0; attempt < PORT_ATTEMPTS; attempt++) {
    try {
      return await tryListen(app, port === 0 ? 0 : port + attempt);
    } catch (error) {
      if (errorCode(error) !== 'EADDRINUSE' || port === 0) throw error;
    }
  }
  throw new Error(`Nie znaleziono wolnego portu w zakresie ${port}-${port + PORT_ATTEMPTS - 1}`);
}

export async function startServer(options: StartOptions): Promise<RunningServer> {
  let root = await assertReadableDir(options.root);
  const hub = new EventHub();
  let watcher = watchRoot(root, hub);
  await touchRecent(root);

  const ctx: AppContext = {
    token: options.token ?? createToken(),
    port: options.port,
    webDir: options.webDir,
    hub,
    getRoot: () => root,
    setRoot: async (dir) => {
      const next = await assertReadableDir(dir);
      if (next !== root) {
        await watcher.close();
        root = next;
        watcher = watchRoot(root, hub);
      }
      await touchRecent(root);
      hub.emit({ type: 'review-changed' });
    },
  };
  const server = await listen(createApp(ctx), options.port);
  ctx.port = (server.address() as AddressInfo).port;

  return {
    root,
    port: ctx.port,
    token: ctx.token,
    url: `http://127.0.0.1:${ctx.port}/?token=${ctx.token}`,
    ready: watcher.ready,
    async close() {
      await watcher.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
````

- [ ] **Step 5: Utwórz `src/server/args.ts`**

````ts
import { parseArgs } from 'node:util';

export const DEFAULT_PORT = 4477;

export const USAGE = `Użycie: docsreview [katalog] [--port <n>] [--no-open]

  katalog     katalog roboczy z plikami .md (domyślnie bieżący katalog)
  --port <n>  port serwera (domyślnie ${DEFAULT_PORT}; gdy zajęty, kolejny wolny)
  --no-open   nie otwieraj przeglądarki
  --help      pokaż tę pomoc`;

export interface CliArgs {
  root: string;
  port: number;
  open: boolean;
  help: boolean;
}

export function parseCliArgs(argv: string[]): CliArgs {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      options: {
        port: { type: 'string' },
        'no-open': { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
      },
      allowPositionals: true,
    });
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : String(error));
  }
  const { values, positionals } = parsed;
  if (positionals.length > 1) throw new Error('Podaj najwyżej jeden katalog');

  let port = DEFAULT_PORT;
  if (values.port !== undefined) {
    port = Number(values.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error(`Nieprawidłowy port: ${values.port}`);
    }
  }
  return {
    root: positionals[0] ?? process.cwd(),
    port,
    open: values['no-open'] !== true,
    help: values.help === true,
  };
}
````

- [ ] **Step 6: Utwórz `src/server/cli.ts`**

Pierwsza linia musi być dokładnie `#!/usr/bin/env node`; kompilator przenosi ją do `dist/server/cli.js`. Katalog frontendu to `dist/web` obok `dist/server`.

````ts
#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import open from 'open';
import { parseCliArgs, USAGE, type CliArgs } from './args.js';
import { HttpError } from './errors.js';
import { startServer, type RunningServer } from './start.js';

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

async function main(): Promise<void> {
  let args: CliArgs;
  try {
    args = parseCliArgs(process.argv.slice(2));
  } catch (error) {
    fail(`${error instanceof Error ? error.message : String(error)}\n\n${USAGE}`);
  }
  if (args.help) {
    console.log(USAGE);
    return;
  }

  const webDir = fileURLToPath(new URL('../web', import.meta.url));
  let server: RunningServer;
  try {
    server = await startServer({ root: args.root, port: args.port, webDir });
  } catch (error) {
    if (error instanceof HttpError) fail(error.message);
    throw error;
  }

  console.log(`DocsReview działa: ${server.url}`);
  console.log(`Katalog roboczy:   ${server.root}`);
  console.log('Zatrzymanie: Ctrl+C');
  if (args.open) await open(server.url);

  const shutdown = (): void => {
    void server.close().finally(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

await main();
````

- [ ] **Step 7: Uruchom test i sprawdź, że przechodzi**

Run: `npx vitest run tests/server/start.test.ts`
Expected: PASS, 12 testów.

- [ ] **Step 8: Uruchom wszystkie testy i sprawdź typy**

Run: `npm test && npm run typecheck`
Expected: PASS, 135 testów w 9 plikach; brak błędów typów.

- [ ] **Step 9: Sprawdź działanie CLI**

Run: `npx tsc -p tsconfig.server.json && node dist/server/cli.js --help`
Expected: tekst zaczynający się od `Użycie: docsreview [katalog] [--port <n>] [--no-open]`.

Run: `node dist/server/cli.js /katalog/ktorego/nie/ma --no-open; echo "kod: $?"`
Expected: `Katalog nie istnieje lub nie można go odczytać: /katalog/ktorego/nie/ma` i `kod: 1`.

Run: `node dist/server/cli.js --port abc; echo "kod: $?"`
Expected: `Nieprawidłowy port: abc`, tekst pomocy i `kod: 1`.

- [ ] **Step 10: Commit**

```bash
git add src/server/watcher.ts src/server/start.ts src/server/args.ts src/server/cli.ts tests/server/start.test.ts
git commit -m "feat: add file watcher, server startup and CLI"
```

---

### Task 9: Biblioteki frontendu

**Files:**
- Create: `src/web/strings.ts`
- Create: `src/web/lib/frontmatter.ts`
- Create: `src/web/lib/blocks.ts`
- Create: `src/web/lib/render.ts`
- Create: `src/web/lib/tree.ts`
- Create: `src/web/lib/route.ts`
- Test: `tests/web/render.test.ts`
- Test: `tests/web/lib.test.ts`

**Interfaces:**
- Consumes: `splitLines` z `src/core/lines.ts`; `FileEntry` z `src/core/types.ts`.
- Produces:
  - `t` (obiekt z tekstami interfejsu) i `needsCheckQuestion(count: number): string` z `src/web/strings.ts`
  - `interface FrontmatterEntry { key: string; value: string; line: number; endLine: number }`
  - `interface Frontmatter { entries: FrontmatterEntry[]; endLine: number }` (`endLine` to linia zamykającego `---`)
  - `parseFrontmatter(lines: string[]): Frontmatter | null`
  - `interface BlockRange { start: number; end: number }`
  - `findBlockIndex(blocks: BlockRange[], line: number): number` (`-1`, gdy nie ma bloków)
  - `renderMarkdown(content: string): string` (HTML; każdy komentowalny element ma atrybuty `data-block`, `data-line-start`, `data-line-end`; linie kodu to `<span class="code-line">`)
  - `interface TreeNode { name: string; path: string; file: FileEntry | null; ignored: boolean; openComments: number; children: TreeNode[] }`
  - `buildTree(files: FileEntry[]): TreeNode[]`
  - `type Tab = 'files' | 'comments'`, `interface Route { tab: Tab; file: string | null }`
  - `parseRoute(hash: string): Route`, `formatRoute(route: Route): string`

- [ ] **Step 1: Napisz testy, które nie przechodzą**

Utwórz `tests/web/render.test.ts`:

````ts
import { describe, expect, it } from 'vitest';
import { splitLines } from '../../src/core/lines.js';
import { parseFrontmatter } from '../../src/web/lib/frontmatter.js';
import { renderMarkdown } from '../../src/web/lib/render.js';

function blocks(html: string): Array<[string, number, number]> {
  return [...html.matchAll(/<(\w+)[^>]*\bdata-block=""[^>]*>/g)].map((match) => {
    const tag = match[0];
    const start = Number(/data-line-start="(\d+)"/.exec(tag)![1]);
    const end = Number(/data-line-end="(\d+)"/.exec(tag)![1]);
    return [match[1]!, start, end];
  });
}

const DOCUMENT = [
  '# Title', // 1
  '', // 2
  'Para line one', // 3
  'para line two', // 4
  '', // 5
  '- item a', // 6
  '- item b', // 7
  '  - nested', // 8
  '', // 9
  '| h1 | h2 |', // 10
  '|----|----|', // 11
  '| c1 | c2 |', // 12
  '', // 13
  '```sh', // 14
  'npx docsreview', // 15
  '', // 16
  'echo done', // 17
  '```', // 18
  '', // 19
  '> quote', // 20
  '', // 21
  '---', // 22
].join('\n');

describe('renderMarkdown', () => {
  it('marks every commentable block with its source line range', () => {
    expect(blocks(renderMarkdown(DOCUMENT))).toEqual([
      ['h1', 1, 1],
      ['p', 3, 4],
      ['li', 6, 6],
      ['li', 7, 9],
      ['li', 8, 9],
      ['tr', 10, 10],
      ['tr', 12, 12],
      ['span', 15, 15],
      ['span', 16, 16],
      ['span', 17, 17],
      ['p', 20, 20],
      ['hr', 22, 22],
    ]);
  });

  it('renders each line of a fenced code block separately and keeps the language', () => {
    const html = renderMarkdown(DOCUMENT);
    expect(html).toContain('<pre class="code-block" data-line-start="14" data-line-end="18" data-lang="sh">');
    expect(html).toContain('<span class="code-line" data-block="" data-line-start="15" data-line-end="15">npx docsreview</span>');
    expect(html).toContain('<span class="code-line" data-block="" data-line-start="16" data-line-end="16"></span>');
  });

  it('numbers the lines of an indented code block', () => {
    expect(blocks(renderMarkdown('para\n\n    first\n    second\n'))).toEqual([
      ['p', 1, 1],
      ['span', 3, 3],
      ['span', 4, 4],
    ]);
  });

  it('numbers code lines inside a list item and in a fence that is never closed', () => {
    expect(blocks(renderMarkdown('- item\n\n  ```\n  code\n  ```\n')).filter(([tag]) => tag === 'span')).toEqual([
      ['span', 4, 4],
    ]);
    expect(blocks(renderMarkdown('```\ncode'))).toEqual([['span', 2, 2]]);
  });

  it('uses the same line numbers for CRLF files and files without a trailing newline', () => {
    const expected = [
      ['h1', 1, 1],
      ['p', 3, 3],
    ];
    expect(blocks(renderMarkdown('# T\r\n\r\npara\r\n'))).toEqual(expected);
    expect(blocks(renderMarkdown('# T\n\npara'))).toEqual(expected);
    expect(splitLines('# T\r\n\r\npara\r\n')).toHaveLength(3);
  });

  it('shows HTML and XML tags from the file as text', () => {
    const html = renderMarkdown('<HARD-GATE>\nstop\n</HARD-GATE>\n\n<script>alert(1)</script>\n');
    expect(html).toContain('&lt;HARD-GATE&gt;');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>');
  });

  it('does not load images and opens links in a new tab without a referrer', () => {
    const html = renderMarkdown('![alt](https://example.com/x.png)\n\n[link](https://example.com)\n\n[bad](javascript:alert(1))\n');
    expect(html).not.toContain('<img');
    expect(html).toContain('<a href="https://example.com" target="_blank" rel="noopener noreferrer">link</a>');
    expect(html).not.toContain('href="javascript:');
  });

  it('renders frontmatter as a table and offsets the body lines', () => {
    const html = renderMarkdown('---\nname: deploy\ndescription: Use when\n  deploying <things>\n---\n\n# Title\n');
    expect(html).toContain('<table class="frontmatter" data-line-start="1" data-line-end="5">');
    expect(html).toContain('<th>name</th><td>deploy</td>');
    expect(html).toContain('<td>Use when\ndeploying &lt;things&gt;</td>');
    expect(blocks(html)).toEqual([
      ['tr', 2, 2],
      ['tr', 3, 4],
      ['h1', 7, 7],
    ]);
  });

  it('renders a file as plain markdown when the frontmatter is never closed', () => {
    const html = renderMarkdown('---\nname: deploy\n\ntext\n');
    expect(html).not.toContain('class="frontmatter"');
    expect(html).toContain('<hr');
  });

  it('renders an empty file as nothing', () => {
    expect(renderMarkdown('')).toBe('');
  });
});

describe('parseFrontmatter', () => {
  it('returns null without an opening or a closing delimiter', () => {
    expect(parseFrontmatter(['# Title'])).toBeNull();
    expect(parseFrontmatter(['---', 'name: x'])).toBeNull();
    expect(parseFrontmatter([])).toBeNull();
  });

  it('splits keys and values and records their lines', () => {
    expect(parseFrontmatter(['---', 'name: deploy', 'description: "Use: when"', '---', 'body'])).toEqual({
      entries: [
        { key: 'name', value: 'deploy', line: 2, endLine: 2 },
        { key: 'description', value: '"Use: when"', line: 3, endLine: 3 },
      ],
      endLine: 4,
    });
  });

  it('attaches continuation lines to the previous key', () => {
    const result = parseFrontmatter(['---', 'description: >', '  first', '  second', 'name: x', '---']);
    expect(result!.entries).toEqual([
      { key: 'description', value: '>\nfirst\nsecond', line: 2, endLine: 4 },
      { key: 'name', value: 'x', line: 5, endLine: 5 },
    ]);
  });

  it('keeps a line that comes before any key', () => {
    expect(parseFrontmatter(['---', '# comment', 'name: x', '---'])!.entries[0]).toEqual({
      key: '',
      value: '# comment',
      line: 2,
      endLine: 2,
    });
  });

  it('accepts an empty block and CRLF line endings already split by splitLines', () => {
    expect(parseFrontmatter(['---', '---'])).toEqual({ entries: [], endLine: 2 });
    expect(parseFrontmatter(splitLines('---\r\nname: x\r\n---\r\n'))!.entries).toHaveLength(1);
  });
});
````

Utwórz `tests/web/lib.test.ts`:

````ts
import { describe, expect, it } from 'vitest';
import type { FileEntry } from '../../src/core/types.js';
import { findBlockIndex } from '../../src/web/lib/blocks.js';
import { formatRoute, parseRoute } from '../../src/web/lib/route.js';
import { buildTree } from '../../src/web/lib/tree.js';
import { needsCheckQuestion } from '../../src/web/strings.js';

function entry(path: string, overrides: Partial<FileEntry> = {}): FileEntry {
  return { path, openComments: 0, ignored: false, roundStatus: 'unchanged', ...overrides };
}

describe('findBlockIndex', () => {
  const blocks = [
    { start: 1, end: 1 },
    { start: 3, end: 4 },
    { start: 7, end: 9 },
    { start: 8, end: 9 },
    { start: 12, end: 12 },
  ];

  it('returns the block that contains the line', () => {
    expect(findBlockIndex(blocks, 4)).toBe(1);
  });

  it('prefers the innermost of nested blocks', () => {
    expect(findBlockIndex(blocks, 8)).toBe(3);
    expect(findBlockIndex(blocks, 7)).toBe(2);
  });

  it('falls back to the nearest block above a line that belongs to no block', () => {
    expect(findBlockIndex(blocks, 5)).toBe(1);
    expect(findBlockIndex(blocks, 11)).toBe(3);
    expect(findBlockIndex(blocks, 99)).toBe(4);
  });

  it('falls back to the first block for a line above every block', () => {
    expect(findBlockIndex([{ start: 3, end: 4 }], 1)).toBe(0);
  });

  it('returns -1 when there are no blocks', () => {
    expect(findBlockIndex([], 1)).toBe(-1);
  });
});

describe('buildTree', () => {
  it('nests files in directories, directories first, sorted by name', () => {
    const tree = buildTree([entry('README.md'), entry('docs/b.md'), entry('docs/adr/0001.md'), entry('docs/a.md')]);
    expect(tree.map((node) => node.name)).toEqual(['docs', 'README.md']);
    const docs = tree[0]!;
    expect(docs).toMatchObject({ path: 'docs', file: null });
    expect(docs.children.map((node) => node.name)).toEqual(['adr', 'a.md', 'b.md']);
    expect(docs.children[0]!.children[0]).toMatchObject({ name: '0001.md', path: 'docs/adr/0001.md' });
  });

  it('marks a directory as ignored only when everything inside it is ignored', () => {
    const tree = buildTree([
      entry('vendor/pkg/README.md', { ignored: true }),
      entry('docs/a.md'),
      entry('docs/local.md', { ignored: true }),
    ]);
    expect(tree.map((node) => [node.name, node.ignored])).toEqual([
      ['docs', false],
      ['vendor', true],
    ]);
    expect(tree[1]!.children[0]).toMatchObject({ name: 'pkg', ignored: true });
  });

  it('sums open comments of the files inside a directory', () => {
    const tree = buildTree([
      entry('docs/a.md', { openComments: 2 }),
      entry('docs/adr/0001.md', { openComments: 1 }),
      entry('README.md'),
    ]);
    expect(tree.map((node) => [node.name, node.openComments])).toEqual([
      ['docs', 3],
      ['README.md', 0],
    ]);
  });

  it('returns an empty tree for no files', () => {
    expect(buildTree([])).toEqual([]);
  });
});

describe('route', () => {
  it('defaults to the files tab with nothing selected', () => {
    expect(parseRoute('')).toEqual({ tab: 'files', file: null });
  });

  it('round-trips a file name with spaces, Polish letters and a hash sign', () => {
    const route = { tab: 'comments' as const, file: 'docs/Plan wdrożenia #2.md' };
    expect(parseRoute(formatRoute(route))).toEqual(route);
  });

  it('falls back to the files tab for an unknown tab', () => {
    expect(parseRoute('#tab=settings&file=a.md')).toEqual({ tab: 'files', file: 'a.md' });
  });
});

describe('needsCheckQuestion', () => {
  it('uses the right Polish plural form', () => {
    expect(needsCheckQuestion(1)).toBe('1 komentarz z poprzedniej rundy ma zmienioną linię.');
    expect(needsCheckQuestion(2)).toBe('2 komentarze z poprzedniej rundy mają zmienioną linię.');
    expect(needsCheckQuestion(5)).toBe('5 komentarzy z poprzedniej rundy ma zmienioną linię.');
    expect(needsCheckQuestion(12)).toBe('12 komentarzy z poprzedniej rundy ma zmienioną linię.');
    expect(needsCheckQuestion(22)).toBe('22 komentarze z poprzedniej rundy mają zmienioną linię.');
  });
});
````

- [ ] **Step 2: Uruchom testy i sprawdź, że nie przechodzą**

Run: `npx vitest run tests/web`
Expected: FAIL, bo nie da się zaimportować modułów z `src/web`.

- [ ] **Step 3: Utwórz `src/web/strings.ts`**

````ts
export const t = {
  appName: 'DocsReview',
  tabFiles: 'Pliki',
  tabComments: 'Komentarze',
  changeDir: 'Zmień katalog',
  connectionLost: 'Brak połączenia z serwerem. Ponawiam…',
  dismiss: 'Zamknij',

  showIgnored: 'Pokaż ignorowane',
  showResolved: 'Pokaż rozwiązane',
  noFiles: 'Brak plików .md w tym katalogu.',
  noFilesHint: 'Jeśli pliki są ignorowane przez gita, włącz „Pokaż ignorowane” nad drzewem plików.',
  selectFile: 'Wybierz plik z drzewa po lewej.',
  fileMissing: 'Plik nie istnieje.',
  tooLarge: 'Plik jest większy niż 1 MB, więc jest pokazany tylko jako surowy tekst.',
  statusChanged: 'zmieniony',
  statusNew: 'nowy',
  raw: 'Raw',
  render: 'Render',
  addComment: 'Dodaj komentarz',

  commentPlaceholder: 'Treść komentarza',
  save: 'Zapisz',
  cancel: 'Anuluj',
  saveHint: 'Cmd/Ctrl+Enter zapisuje, Esc anuluje',
  edit: 'Edytuj',
  remove: 'Usuń',
  resolve: 'Rozwiąż',
  reopen: 'Otwórz ponownie',
  stillValid: 'Nadal aktualny',
  open: 'otwarty',
  resolved: 'rozwiązany',
  handedOff: 'przekazany',
  lineChanged: 'linia zmieniona',
  needsCheck: 'do sprawdzenia',
  was: 'było:',
  missingFile: 'plik nie istnieje',
  fileChangedWhileCommenting: 'Plik zmienił się w trakcie pisania. Sprawdź linię i zapisz komentarz ponownie.',

  filterOpen: 'Otwarte',
  filterResolved: 'Rozwiązane',
  filterAll: 'Wszystkie',
  groupNeedsCheck: 'Do sprawdzenia',
  removeResolved: 'Usuń rozwiązane',
  noComments: 'Brak komentarzy.',
  output: 'Output',
  noOpenComments: 'Brak otwartych komentarzy',
  copy: 'Kopiuj',
  copied: 'Skopiowano. Zaczęła się nowa runda.',
  copyFailed: 'Nie udało się skopiować do schowka. Runda nie została rozpoczęta.',
  copyAnyway: 'Skopiować mimo to?',
  showThem: 'Pokaż je',

  pickerTitle: 'Zmień katalog roboczy',
  recent: 'Ostatnio używane',
  browse: 'Przeglądaj',
  parentDir: '.. (katalog wyżej)',
  chooseThis: 'Wybierz ten katalog',
  noSubdirs: 'Brak podkatalogów.',
};

export function needsCheckQuestion(count: number): string {
  const lastTwo = count % 100;
  const last = count % 10;
  if (count === 1) return '1 komentarz z poprzedniej rundy ma zmienioną linię.';
  if (last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14)) {
    return `${count} komentarze z poprzedniej rundy mają zmienioną linię.`;
  }
  return `${count} komentarzy z poprzedniej rundy ma zmienioną linię.`;
}
````

- [ ] **Step 4: Utwórz `src/web/lib/frontmatter.ts`**

````ts
export interface FrontmatterEntry {
  key: string;
  value: string;
  line: number;
  endLine: number;
}

export interface Frontmatter {
  entries: FrontmatterEntry[];
  endLine: number;
}

const DELIMITER = '---';
const KEY_PATTERN = /^([A-Za-z0-9_-]+):\s?(.*)$/;

export function parseFrontmatter(lines: string[]): Frontmatter | null {
  if (lines[0]?.trimEnd() !== DELIMITER) return null;
  const closing = lines.findIndex((line, index) => index > 0 && line.trimEnd() === DELIMITER);
  if (closing === -1) return null;

  const entries: FrontmatterEntry[] = [];
  for (let index = 1; index < closing; index++) {
    const text = lines[index]!;
    const lineNumber = index + 1;
    const match = KEY_PATTERN.exec(text);
    const previous = entries.at(-1);
    if (match !== null) {
      entries.push({ key: match[1]!, value: match[2]!, line: lineNumber, endLine: lineNumber });
    } else if (previous !== undefined) {
      previous.value = previous.value === '' ? text.trim() : `${previous.value}\n${text.trim()}`;
      previous.endLine = lineNumber;
    } else {
      entries.push({ key: '', value: text.trim(), line: lineNumber, endLine: lineNumber });
    }
  }
  return { entries, endLine: closing + 1 };
}
````

- [ ] **Step 5: Utwórz `src/web/lib/blocks.ts`**

Komentarz trafia pod najbardziej wewnętrzny blok zawierający jego linię. Linia, która nie należy do żadnego bloku (pusta, separator tabeli, płotek bloku kodu), trafia pod najbliższy blok powyżej.

````ts
export interface BlockRange {
  start: number;
  end: number;
}

export function findBlockIndex(blocks: BlockRange[], line: number): number {
  let containing = -1;
  let preceding = -1;
  for (let index = 0; index < blocks.length; index++) {
    const block = blocks[index]!;
    if (block.start <= line && line <= block.end) {
      const best = blocks[containing];
      if (best === undefined || block.end - block.start <= best.end - best.start) containing = index;
    }
    if (block.start <= line) {
      const best = blocks[preceding];
      if (best === undefined || block.start >= best.start) preceding = index;
    }
  }
  if (containing !== -1) return containing;
  if (preceding !== -1) return preceding;
  return blocks.length > 0 ? 0 : -1;
}
````

- [ ] **Step 6: Utwórz `src/web/lib/render.ts`**

markdown-it 15 eksportuje klasę jako eksport domyślny, a typy jako eksporty nazwane (`MarkdownIt`, `RendererRule`). `token.map` to `[pierwsza linia od 0, linia za blokiem]`, więc zakres liczony od 1 to `map[0] + 1` do `map[1]`. Akapit wewnątrz zwartej listy ma `hidden: true` i nie dostaje `data-block`; komentowalny jest wtedy element listy.

````ts
import Markdown, { type MarkdownIt, type RendererRule } from 'markdown-it';
import { splitLines } from '../../core/lines.js';
import { parseFrontmatter, type Frontmatter } from './frontmatter.js';

interface RenderEnv {
  lineOffset?: number;
}

const COMMENTABLE = new Set(['heading_open', 'paragraph_open', 'list_item_open', 'tr_open', 'hr']);

function createMarkdown(): MarkdownIt {
  const md = new Markdown({ html: false, linkify: false });
  md.disable('image');

  md.core.ruler.push('source_lines', (state) => {
    const offset = (state.env as RenderEnv).lineOffset ?? 0;
    for (const token of state.tokens) {
      if (token.map === null) continue;
      if (token.nesting !== 1 && token.type !== 'hr') continue;
      token.attrSet('data-line-start', String(token.map[0] + 1 + offset));
      token.attrSet('data-line-end', String(token.map[1] + offset));
      if (COMMENTABLE.has(token.type) && !token.hidden) token.attrSet('data-block', '');
    }
  });

  const renderCode: RendererRule = (tokens, index, _options, env) => {
    const token = tokens[index]!;
    const offset = (env as RenderEnv).lineOffset ?? 0;
    const [start, end] = token.map ?? [0, 0];
    const firstLine = start + 1 + offset + (token.type === 'fence' ? 1 : 0);
    const lines = token.content.split('\n');
    if (lines.at(-1) === '') lines.pop();
    const body = lines
      .map((line, lineIndex) => {
        const number = firstLine + lineIndex;
        return `<span class="code-line" data-block="" data-line-start="${number}" data-line-end="${number}">${md.utils.escapeHtml(line)}</span>`;
      })
      .join('');
    const language = token.type === 'fence' ? token.info.trim().split(/\s+/)[0] ?? '' : '';
    const languageAttr = language === '' ? '' : ` data-lang="${md.utils.escapeHtml(language)}"`;
    return `<pre class="code-block" data-line-start="${start + 1 + offset}" data-line-end="${end + offset}"${languageAttr}><code>${body}</code></pre>\n`;
  };
  md.renderer.rules.fence = renderCode;
  md.renderer.rules.code_block = renderCode;

  const defaultLinkOpen = md.renderer.rules.link_open;
  md.renderer.rules.link_open = (tokens, index, options, env, self) => {
    tokens[index]!.attrSet('target', '_blank');
    tokens[index]!.attrSet('rel', 'noopener noreferrer');
    return defaultLinkOpen ? defaultLinkOpen(tokens, index, options, env, self) : self.renderToken(tokens, index, options);
  };

  return md;
}

const markdown = createMarkdown();

function renderFrontmatter(frontmatter: Frontmatter): string {
  const rows = frontmatter.entries
    .map(
      (entry) =>
        `<tr data-block="" data-line-start="${entry.line}" data-line-end="${entry.endLine}">` +
        `<th>${markdown.utils.escapeHtml(entry.key)}</th><td>${markdown.utils.escapeHtml(entry.value)}</td></tr>`,
    )
    .join('\n');
  return `<table class="frontmatter" data-line-start="1" data-line-end="${frontmatter.endLine}"><tbody>\n${rows}\n</tbody></table>\n`;
}

export function renderMarkdown(content: string): string {
  const lines = splitLines(content);
  const frontmatter = parseFrontmatter(lines);
  if (frontmatter === null) return markdown.render(lines.join('\n'), { lineOffset: 0 });
  const body = lines.slice(frontmatter.endLine).join('\n');
  return renderFrontmatter(frontmatter) + markdown.render(body, { lineOffset: frontmatter.endLine });
}
````

- [ ] **Step 7: Utwórz `src/web/lib/tree.ts`**

````ts
import type { FileEntry } from '../../core/types.js';

export interface TreeNode {
  name: string;
  path: string;
  file: FileEntry | null;
  ignored: boolean;
  openComments: number;
  children: TreeNode[];
}

function finish(nodes: TreeNode[]): { ignored: boolean; openComments: number } {
  nodes.sort((a, b) => {
    if ((a.file === null) !== (b.file === null)) return a.file === null ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  let ignored = nodes.length > 0;
  let openComments = 0;
  for (const node of nodes) {
    if (node.file === null) Object.assign(node, finish(node.children));
    if (!node.ignored) ignored = false;
    openComments += node.openComments;
  }
  return { ignored, openComments };
}

export function buildTree(files: FileEntry[]): TreeNode[] {
  const roots: TreeNode[] = [];
  const dirs = new Map<string, TreeNode>();
  for (const file of files) {
    const parts = file.path.split('/');
    let siblings = roots;
    for (let index = 0; index < parts.length - 1; index++) {
      const dirPath = parts.slice(0, index + 1).join('/');
      let dir = dirs.get(dirPath);
      if (dir === undefined) {
        dir = { name: parts[index]!, path: dirPath, file: null, ignored: false, openComments: 0, children: [] };
        dirs.set(dirPath, dir);
        siblings.push(dir);
      }
      siblings = dir.children;
    }
    siblings.push({
      name: parts.at(-1)!,
      path: file.path,
      file,
      ignored: file.ignored,
      openComments: file.openComments,
      children: [],
    });
  }
  finish(roots);
  return roots;
}
````

- [ ] **Step 8: Utwórz `src/web/lib/route.ts`**

````ts
export type Tab = 'files' | 'comments';

export interface Route {
  tab: Tab;
  file: string | null;
}

export function parseRoute(hash: string): Route {
  const params = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);
  return {
    tab: params.get('tab') === 'comments' ? 'comments' : 'files',
    file: params.get('file') || null,
  };
}

export function formatRoute(route: Route): string {
  const params = new URLSearchParams();
  params.set('tab', route.tab);
  if (route.file !== null) params.set('file', route.file);
  return `#${params.toString()}`;
}
````

- [ ] **Step 9: Uruchom testy i sprawdź, że przechodzą**

Run: `npx vitest run tests/web`
Expected: PASS, 28 testów w 2 plikach.

- [ ] **Step 10: Uruchom wszystkie testy i sprawdź typy**

Run: `npm test && npm run typecheck`
Expected: PASS, 163 testy w 11 plikach; brak błędów typów.

- [ ] **Step 11: Commit**

```bash
git add src/web/strings.ts src/web/lib/frontmatter.ts src/web/lib/blocks.ts src/web/lib/render.ts src/web/lib/tree.ts src/web/lib/route.ts tests/web/render.test.ts tests/web/lib.test.ts
git commit -m "feat: add markdown rendering with source lines and frontend helpers"
```

---

### Task 10: Widok „Pliki”

Po tym zadaniu narzędzie da się uruchomić: drzewo plików, panele RAW i RENDER, komentarze w obu panelach, synchronizacja przewijania. Zakładka „Komentarze”, przekazanie i zmiana katalogu dochodzą w Zadaniu 11, więc przycisk „Zmień katalog” w pustym stanie jeszcze nic nie robi.

**Files:**
- Create: `playwright.config.ts`
- Create: `tests/e2e/prepare.mjs`
- Test: `tests/e2e/comments.spec.ts`
- Test: `tests/e2e/ignored.spec.ts`
- Create: `vite.config.ts`
- Create: `src/web/index.html`
- Create: `src/web/main.ts`
- Create: `src/web/style.css`
- Create: `src/web/api.ts`
- Create: `src/web/state.ts`
- Create: `src/web/lib/scrollSync.ts`
- Create: `src/web/components/CommentForm.vue`
- Create: `src/web/components/CommentBadges.vue`
- Create: `src/web/components/CommentActions.vue`
- Create: `src/web/components/CommentCard.vue`
- Create: `src/web/components/RawPane.vue`
- Create: `src/web/components/RenderPane.vue`
- Create: `src/web/components/FileTreeNode.vue`
- Create: `src/web/components/FileTree.vue`
- Create: `src/web/components/FilesView.vue`
- Create: `src/web/App.vue`

**Interfaces:**
- Consumes: API z Zadania 7; `renderMarkdown`, `findBlockIndex`, `buildTree`, `parseRoute`, `formatRoute`, `t`; typy z `src/core/types.ts`; `splitLines`.
- Produces z `src/web/api.ts`:
  - `class ApiError extends Error { status: number }` (`status` 0 oznacza brak połączenia)
  - `initToken(): void`
  - `api.session()`, `api.setRoot(path)`, `api.dirs(path?)`, `api.setShowIgnored(value)`, `api.files()`, `api.file(path)`, `api.comments()`, `api.addComment(file, line, text, contentHash)`, `api.patchComment(id, patch)`, `api.deleteComment(id)`, `api.deleteResolved()`, `api.handoff()`
  - `interface CommentPatch { text?: string; status?: CommentStatus; checked?: true }`
  - `openEvents(onChange: () => void, onStatus: (connected: boolean) => void): EventSource`
- Produces z `src/web/state.ts`:
  - `store` (reaktywny): `session`, `files`, `fileView`, `fileError`, `comments`, `route`, `focusLine`, `connected`, `showResolved`, `draft`, `error`, `notice`
  - `interface Draft { line: number; pane: 'raw' | 'render'; text: string }`
  - `init(): Promise<void>`, `refresh(): Promise<void>`
  - `navigate(change: Partial<Route>): void`, `openFile(path: string, line?: number | null): void`
  - `startDraft(line: number, pane: Draft['pane']): void`, `submitDraft(text: string): Promise<void>`
  - `updateComment(id: string, patch: CommentPatch): Promise<boolean>`, `removeComment(id: string): Promise<boolean>`, `removeResolved(): Promise<boolean>`
  - `setShowIgnored(value: boolean): Promise<boolean>`, `changeRoot(path: string): Promise<boolean>`, `copyAndHandOff(): Promise<boolean>`
- Produces z `src/web/lib/scrollSync.ts`: `topLine(pane: HTMLElement): number | null`, `scrollToLine(pane: HTMLElement, line: number): void`, `syncScroll(first: HTMLElement, second: HTMLElement): () => void`
- Produces komponenty:
  - `CommentForm`: props `initial: string`; zdarzenia `submit(text)`, `cancel()`, `change(text)`
  - `CommentBadges`: props `comment: CommentView`
  - `CommentActions`: props `comment: CommentView`, `editable?: boolean`; zdarzenie `edit()`
  - `CommentCard`: props `comment: CommentView`
  - `RawPane`, `RenderPane`: props `view: FileView`, `comments: CommentView[]`; `RenderPane` emituje `rendered()`
  - `FileTree` (bez props), `FileTreeNode`: props `node: TreeNode`, `toggled: Set<string>`, `collapseIgnored: boolean`; zdarzenie `toggle(path)`
  - `FilesView`: zdarzenie `change-dir()`
- Klasy i atrybuty, na których polegają testy end-to-end: `.file-path`, `.tree-file`, `.tree-file.ignored`, `.count`, `[data-pane="raw"]`, `[data-pane="render"]`, `.raw-line`, `.raw-line.changed`, `.comment`, `.comment.resolved`, `.comment.needs-check`, `.main .empty`, `.root`.

- [ ] **Step 1: Zainstaluj przeglądarkę dla Playwright**

Run: `npx playwright install chromium`
Expected: Chromium jest pobrany albo już obecny.

- [ ] **Step 2: Utwórz `tests/e2e/prepare.mjs`**

Skrypt tworzy od zera katalog roboczy i katalog stanu dla jednej instancji serwera. Wariant `ignored` ma katalog roboczy ignorowany przez repozytorium nadrzędne. Wariantu `round` użyje Zadanie 11.

````js
import fs from 'node:fs/promises';
import path from 'node:path';

const name = process.argv[2];
if (name === undefined) throw new Error('usage: node tests/e2e/prepare.mjs <name>');

const work = path.resolve('tests/e2e/.work', name);
const guide = ['# Przewodnik', '', 'Uruchom `npm start`.', '', '- krok pierwszy', '- krok drugi', ''].join('\n');

await fs.rm(work, { recursive: true, force: true });
await fs.mkdir(path.join(work, 'root/docs'), { recursive: true });
await fs.mkdir(path.join(work, 'home'), { recursive: true });
await fs.writeFile(path.join(work, 'root/docs/guide.md'), guide);

if (name === 'comments') {
  await fs.writeFile(path.join(work, 'root/docs/Plan wdrożenia #2.md'), '# Plan\n\nTreść planu.\n');
}

if (name === 'ignored') {
  await fs.mkdir(path.join(work, '.git'));
  await fs.writeFile(path.join(work, '.gitignore'), 'root/\n');
}
````

- [ ] **Step 3: Utwórz `playwright.config.ts`**

Każdy plik testów ma własną instancję serwera, żeby testy nie dzieliły komentarzy.

````ts
import path from 'node:path';
import { defineConfig } from '@playwright/test';

const servers = [
  { name: 'comments', port: 4599 },
  { name: 'ignored', port: 4600 },
];

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  workers: 1,
  use: {
    permissions: ['clipboard-read', 'clipboard-write'],
  },
  webServer: servers.map(({ name, port }) => ({
    command: `node tests/e2e/prepare.mjs ${name} && node dist/server/cli.js tests/e2e/.work/${name}/root --no-open --port ${port}`,
    url: `http://127.0.0.1:${port}/`,
    reuseExistingServer: false,
    env: {
      DOCSREVIEW_TOKEN: 'e2e',
      DOCSREVIEW_HOME: path.resolve('tests/e2e/.work', name, 'home'),
    },
  })),
});
````

- [ ] **Step 4: Napisz testy end-to-end, które nie przechodzą**

Utwórz `tests/e2e/comments.spec.ts`:

````ts
import fs from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '@playwright/test';

const ROOT = path.resolve('tests/e2e/.work/comments/root');
const GUIDE = path.join(ROOT, 'docs/guide.md');
const PLAN = 'docs/Plan wdrożenia #2.md';

test.use({ baseURL: 'http://127.0.0.1:4599' });

test('comments from both panes are shared, editable and persistent', async ({ page }) => {
  await page.goto('/?token=e2e');
  await page.locator('.tree-file', { hasText: 'guide.md' }).click();
  await expect(page.locator('.file-path')).toHaveText('docs/guide.md');

  const raw = page.locator('[data-pane="raw"]');
  const render = page.locator('[data-pane="render"]');
  const field = page.getByPlaceholder('Treść komentarza');

  await test.step('Esc cancels a draft and an empty comment cannot be saved', async () => {
    await raw.locator('.raw-line').nth(0).hover();
    await raw.getByRole('button', { name: 'Dodaj komentarz: 1', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Zapisz' })).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(field).toHaveCount(0);
  });

  await test.step('a comment added in the raw pane shows in both panes', async () => {
    await raw.locator('.raw-line').nth(2).hover();
    await raw.getByRole('button', { name: 'Dodaj komentarz: 3', exact: true }).click();
    await field.fill('podaj komendę npx');
    await page.keyboard.press('ControlOrMeta+Enter');
    await expect(raw.locator('.comment')).toHaveCount(1);
    await expect(render.locator('.comment')).toHaveText(/podaj komendę npx/);
  });

  await test.step('a comment added on a rendered block lands on its source line', async () => {
    await render.locator('li', { hasText: 'krok drugi' }).hover();
    await render.getByRole('button', { name: 'Dodaj komentarz: 6', exact: true }).click();
    await field.fill('rozwiń ten krok');
    await page.getByRole('button', { name: 'Zapisz' }).click();
    await expect(raw.locator('.comment')).toHaveCount(2);
    await expect(page.locator('.tree-file', { hasText: 'guide.md' }).locator('.count')).toHaveText('2');
  });

  await test.step('editing changes the text in both panes', async () => {
    await raw.locator('.comment').first().getByRole('button', { name: 'Edytuj' }).click();
    await raw.locator('.comment').first().getByPlaceholder('Treść komentarza').fill('podaj komendę npx docsreview');
    await page.keyboard.press('ControlOrMeta+Enter');
    await expect(render.locator('.comment').first()).toContainText('podaj komendę npx docsreview');
  });

  await test.step('comments survive a reload', async () => {
    await page.reload();
    await expect(page.locator('.file-path')).toHaveText('docs/guide.md');
    await expect(raw.locator('.comment')).toHaveCount(2);
  });

  await test.step('a resolved comment is hidden until resolved comments are shown', async () => {
    await raw.locator('.comment').first().getByRole('button', { name: 'Rozwiąż' }).click();
    await expect(raw.locator('.comment')).toHaveCount(1);
    await page.getByLabel('Pokaż rozwiązane').check();
    await expect(raw.locator('.comment.resolved')).toContainText('rozwiązany');
    await raw.locator('.comment.resolved').getByRole('button', { name: 'Usuń' }).click();
    await expect(raw.locator('.comment')).toHaveCount(1);
  });
});

test('a draft is not lost when files change while typing', async ({ page }) => {
  await page.goto('/?token=e2e');
  await page.locator('.tree-file', { hasText: 'guide.md' }).click();
  const render = page.locator('[data-pane="render"]');
  const field = page.getByPlaceholder('Treść komentarza');

  await render.locator('li', { hasText: 'krok pierwszy' }).hover();
  await render.getByRole('button', { name: 'Dodaj komentarz: 5', exact: true }).click();
  await field.fill('w trakcie pisania');

  await fs.writeFile(path.join(ROOT, 'docs/later.md'), '# Później\n');
  await expect(page.locator('.tree-file', { hasText: 'later.md' })).toBeVisible();
  await expect(field).toHaveValue('w trakcie pisania');

  const original = await fs.readFile(GUIDE, 'utf8');
  await fs.writeFile(GUIDE, `Nowa pierwsza linia.\n\n${original}`);
  await expect(render.locator('p', { hasText: 'Nowa pierwsza linia.' })).toBeVisible();
  await expect(field).toHaveValue('w trakcie pisania');

  await fs.writeFile(GUIDE, original);
  await expect(render.locator('p', { hasText: 'Nowa pierwsza linia.' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Zapisz' }).click();
  await expect(render.locator('.comment', { hasText: 'w trakcie pisania' })).toBeVisible();
});

test('saving a comment on a file that just changed asks to check the line', async ({ page }) => {
  await page.goto('/?token=e2e');
  await page.locator('.tree-file', { hasText: 'guide.md' }).click();
  const raw = page.locator('[data-pane="raw"]');
  const field = page.getByPlaceholder('Treść komentarza');

  await raw.locator('.raw-line').nth(0).hover();
  await raw.getByRole('button', { name: 'Dodaj komentarz: 1', exact: true }).click();
  await field.fill('tytuł do zmiany');

  await page.route(/\/api\/file\?/, (route) => route.abort());
  const original = await fs.readFile(GUIDE, 'utf8');
  await fs.writeFile(GUIDE, `${original}\nDopisana linia.\n`);
  await expect(page.getByRole('alert')).toContainText('Brak połączenia');
  await page.unroute(/\/api\/file\?/);
  await page.getByRole('button', { name: 'Zapisz' }).click();

  await expect(page.getByRole('alert')).toContainText('Plik zmienił się w trakcie pisania');
  await expect(field).toHaveValue('tytuł do zmiany');
  await expect(raw.locator('.raw-line')).toHaveCount(8);
  await page.getByRole('button', { name: 'Zapisz' }).click();
  await expect(raw.locator('.comment', { hasText: 'tytuł do zmiany' })).toBeVisible();
});

test('a file name with spaces, Polish letters and a hash sign opens and survives a reload', async ({ page }) => {
  await page.goto('/?token=e2e');
  await page.locator('.tree-file', { hasText: 'Plan wdrożenia #2.md' }).click();
  await expect(page.locator('.file-path')).toHaveText(PLAN);
  await expect(page.locator('[data-pane="render"] h1')).toHaveText('Plan');

  await page.reload();
  await expect(page.locator('.file-path')).toHaveText(PLAN);

  await fs.rm(path.join(ROOT, PLAN));
  await expect(page.locator('.main .empty')).toHaveText('Plik nie istnieje.');
  await expect(page.locator('.tree-file', { hasText: 'Plan wdrożenia #2.md' })).toHaveCount(0);
});
````

Utwórz `tests/e2e/ignored.spec.ts`:

````ts
import { expect, test } from '@playwright/test';

test.use({ baseURL: 'http://127.0.0.1:4600' });

test('a working directory that git ignores points to the show-ignored switch', async ({ page }) => {
  await page.goto('/?token=e2e');
  await expect(page.locator('.main .empty')).toContainText('Brak plików .md w tym katalogu.');
  await expect(page.locator('.main .empty')).toContainText('Pokaż ignorowane');

  await page.getByLabel('Pokaż ignorowane').check();
  await expect(page.locator('.tree-file.ignored', { hasText: 'guide.md' })).toBeVisible();
  await expect(page.locator('.file-path')).toHaveText('docs/guide.md');
});
````

- [ ] **Step 5: Uruchom testy i sprawdź, że nie przechodzą**

Run: `npm run test:e2e`
Expected: FAIL już przy budowaniu: `vite build` nie ma jeszcze konfiguracji ani pliku `index.html`.

- [ ] **Step 6: Utwórz `vite.config.ts`**

````ts
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  root: 'src/web',
  plugins: [vue()],
  build: { outDir: '../../dist/web', emptyOutDir: true },
  server: { proxy: { '/api': { target: 'http://127.0.0.1:4477', changeOrigin: true } } },
});
````

- [ ] **Step 7: Utwórz `src/web/index.html`**

````html
<!doctype html>
<html lang="pl">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="referrer" content="no-referrer" />
    <title>DocsReview</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="./main.ts"></script>
  </body>
</html>
````

- [ ] **Step 8: Utwórz `src/web/main.ts`**

````ts
import { createApp } from 'vue';
import App from './App.vue';
import './style.css';

createApp(App).mount('#app');
````

- [ ] **Step 9: Utwórz `src/web/style.css`**

````css
:root {
  --bg: #ffffff;
  --bg-soft: #f5f6f8;
  --bg-hover: #e9ecf1;
  --border: #d5d9e0;
  --text: #1c2330;
  --text-soft: #5d6778;
  --accent: #2459d6;
  --accent-soft: #e6edfc;
  --changed: #fff3d1;
  --changed-edge: #e0a100;
  --danger: #b3261e;
  --danger-soft: #fbe9e7;
  --ok-soft: #e4f4e7;
  --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  color-scheme: light dark;
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg: #171a20;
    --bg-soft: #1f232b;
    --bg-hover: #2a303a;
    --border: #353c48;
    --text: #e6e9ee;
    --text-soft: #9aa4b5;
    --accent: #7da2ff;
    --accent-soft: #24304d;
    --changed: #3d3319;
    --changed-edge: #d9a514;
    --danger: #ff8a80;
    --danger-soft: #45221f;
    --ok-soft: #1f3a26;
  }
}

* {
  box-sizing: border-box;
}

html,
body,
#app {
  height: 100%;
  margin: 0;
}

body {
  background: var(--bg);
  color: var(--text);
  font: 14px/1.5 system-ui, -apple-system, 'Segoe UI', sans-serif;
}

button {
  font: inherit;
  color: inherit;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 3px 10px;
  cursor: pointer;
}

button:hover:not(:disabled) {
  background: var(--bg-hover);
}

button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

button.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}

button.primary:hover:not(:disabled) {
  background: var(--accent);
  filter: brightness(1.1);
}

.app {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  background: var(--bg-soft);
  border-bottom: 1px solid var(--border);
}

.tabs {
  display: flex;
  gap: 4px;
}

.tabs button.active,
.filters button.active {
  background: var(--accent-soft);
  border-color: var(--accent);
  font-weight: 600;
}

.root {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--mono);
  font-size: 12px;
  color: var(--text-soft);
}

.banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin: 0;
  padding: 6px 12px;
  border-bottom: 1px solid var(--border);
}

.banner.error {
  background: var(--danger-soft);
  color: var(--danger);
}

.banner.warning {
  background: var(--changed);
}

.banner.notice {
  background: var(--ok-soft);
}

.files-view,
.comments-view {
  display: flex;
  flex: 1;
  min-height: 0;
}

.sidebar {
  width: 280px;
  flex: none;
  overflow: auto;
  border-right: 1px solid var(--border);
  background: var(--bg-soft);
}

.main {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}

.empty {
  margin: auto;
  padding: 24px;
  text-align: center;
  color: var(--text-soft);
}

.hint {
  color: var(--text-soft);
  font-size: 12px;
}

.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 6px 12px;
  border-bottom: 1px solid var(--border);
}

.file-path,
.location,
.dir-current {
  font-family: var(--mono);
  font-size: 12px;
}

.panes {
  display: flex;
  flex: 1;
  min-height: 0;
}

.pane {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}

.pane + .pane {
  border-left: 1px solid var(--border);
}

.pane-title {
  padding: 4px 12px;
  border-bottom: 1px solid var(--border);
  color: var(--text-soft);
  font-size: 11px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.pane-scroll {
  flex: 1;
  overflow: auto;
}

/* File tree */

.tree {
  padding: 8px;
}

.tree-toggle {
  display: block;
  margin-bottom: 8px;
  font-size: 12px;
}

.tree-list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.tree-list .tree-list {
  padding-left: 14px;
}

.tree-row {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 2px 6px;
  border: none;
  background: none;
  text-align: left;
  font-family: var(--mono);
  font-size: 12px;
}

.tree-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tree-file.active > .tree-row {
  background: var(--accent-soft);
}

.tree-dir.ignored > .tree-row,
.tree-file.ignored > .tree-row {
  color: var(--text-soft);
  font-style: italic;
}

.count {
  flex: none;
  min-width: 18px;
  padding: 0 6px;
  border-radius: 9px;
  background: var(--accent);
  color: #fff;
  font: 600 11px/18px system-ui, sans-serif;
  text-align: center;
}

.badge {
  flex: none;
  padding: 0 6px;
  border: 1px solid var(--border);
  border-radius: 9px;
  font: 11px/16px system-ui, sans-serif;
  white-space: nowrap;
}

.badge.round-changed,
.badge.line-changed,
.badge.needs-check {
  border-color: var(--changed-edge);
  background: var(--changed);
}

.badge.round-new,
.badge.handed-off {
  border-color: var(--accent);
  background: var(--accent-soft);
}

.badge.missing {
  border-color: var(--danger);
  color: var(--danger);
}

/* Raw pane */

.raw {
  padding: 4px 0;
  font-family: var(--mono);
  font-size: 12.5px;
}

.raw-line {
  display: flex;
  align-items: flex-start;
  min-height: 20px;
  border-left: 3px solid transparent;
}

.raw-line.changed,
.render-body .changed {
  background: var(--changed);
  box-shadow: inset 3px 0 0 var(--changed-edge);
}

.raw-number {
  flex: none;
  width: 44px;
  padding-right: 8px;
  color: var(--text-soft);
  text-align: right;
  user-select: none;
}

.raw-text {
  flex: 1;
  min-width: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.add {
  flex: none;
  width: 18px;
  height: 18px;
  padding: 0;
  border-color: var(--accent);
  border-radius: 4px;
  background: var(--accent);
  color: #fff;
  font: 700 13px/16px system-ui, sans-serif;
}

.raw-line .add {
  margin-right: 6px;
  opacity: 0;
}

.raw-line:hover .add,
.raw-line .add:focus-visible {
  opacity: 1;
}

.raw-comments {
  padding: 4px 12px 6px 68px;
  font-family: system-ui, sans-serif;
}

/* Render pane */

.render {
  position: relative;
  padding: 12px 16px 12px 34px;
}

.render-add {
  position: absolute;
  left: 8px;
  margin-top: 2px;
}

.render-body [data-block] {
  border-radius: 3px;
}

.render-body [data-block]:hover {
  outline: 1px dashed var(--border);
  outline-offset: 2px;
}

.render-body h1,
.render-body h2,
.render-body h3,
.render-body h4 {
  margin: 0.8em 0 0.4em;
  line-height: 1.25;
}

.render-body p,
.render-body ul,
.render-body ol,
.render-body table,
.render-body pre,
.render-body blockquote {
  margin: 0 0 0.8em;
}

.render-body blockquote {
  padding-left: 12px;
  border-left: 3px solid var(--border);
  color: var(--text-soft);
}

.render-body table {
  border-collapse: collapse;
}

.render-body th,
.render-body td {
  padding: 4px 8px;
  border: 1px solid var(--border);
  text-align: left;
  vertical-align: top;
}

.render-body .frontmatter {
  font-family: var(--mono);
  font-size: 12px;
}

.render-body .frontmatter td {
  white-space: pre-wrap;
}

.render-body code {
  font-family: var(--mono);
  font-size: 0.92em;
}

.render-body :not(pre) > code {
  padding: 1px 4px;
  border-radius: 3px;
  background: var(--bg-soft);
}

.render-body .code-block {
  padding: 8px 0;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-soft);
  overflow-x: auto;
}

.render-body .code-line {
  display: block;
  min-height: 1.5em;
  padding: 0 10px;
  white-space: pre;
}

.comment-slot {
  font-family: system-ui, sans-serif;
  font-size: 14px;
  font-style: normal;
  font-weight: 400;
  white-space: normal;
}

.comment-slot:empty {
  display: none;
}

.render-body .comment-slot-row > td {
  border: none;
  padding: 0;
}

/* Comments */

.comment,
.comment-form {
  margin: 4px 0;
  padding: 8px 10px;
  border: 1px solid var(--accent);
  border-radius: 6px;
  background: var(--accent-soft);
  color: var(--text);
}

.comment.resolved {
  border-color: var(--border);
  background: var(--bg-soft);
  opacity: 0.75;
}

.comment.needs-check,
.comment-row.needs-check {
  border-color: var(--changed-edge);
}

.comment .comment-form {
  margin: 6px 0 0;
  padding: 0;
  border: none;
  background: none;
}

.badges {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 4px;
}

.comment-was {
  margin-top: 4px;
  color: var(--text-soft);
  font-family: var(--mono);
  font-size: 12px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.comment-text {
  margin: 4px 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.comment-actions,
.comment-form-actions,
.modal-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
}

.comment-actions button,
.comment-form-actions button {
  padding: 1px 8px;
  font-size: 12px;
}

.comment-form textarea {
  display: block;
  width: 100%;
  margin-bottom: 6px;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg);
  color: var(--text);
  font: inherit;
  resize: vertical;
}

.comment-form-actions .hint {
  margin-right: auto;
}

/* Comments view */

.comments-list,
.output {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}

.output {
  border-left: 1px solid var(--border);
}

.filters {
  display: flex;
  gap: 4px;
}

.comments-scroll {
  flex: 1;
  overflow: auto;
  padding: 8px 12px;
}

.comment-group h3 {
  margin: 12px 0 4px;
  font-family: var(--mono);
  font-size: 12px;
  color: var(--text-soft);
}

.comment-group.needs-check-group h3 {
  font-family: inherit;
  font-size: 13px;
  color: var(--text);
}

.comment-group ul {
  margin: 0;
  padding: 0;
  list-style: none;
}

.comment-row {
  margin-bottom: 6px;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
}

.comment-row.resolved {
  opacity: 0.65;
}

.comment-row-main {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 0;
  border: none;
  background: none;
  text-align: left;
}

.comment-row-main:disabled {
  opacity: 1;
}

.comment-row-main .comment-text {
  flex-basis: 100%;
}

.output-text {
  flex: 1;
  margin: 12px;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-soft);
  color: var(--text);
  font-family: var(--mono);
  font-size: 12.5px;
  resize: none;
}

/* Modals */

.modal-backdrop {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgb(0 0 0 / 45%);
}

.modal {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: min(560px, calc(100vw - 32px));
  max-height: calc(100vh - 64px);
  padding: 16px;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg);
}

.modal h2,
.modal h3 {
  margin: 0;
}

.modal h3 {
  margin-top: 8px;
  font-size: 13px;
  color: var(--text-soft);
}

.dir-list {
  margin: 4px 0;
  padding: 0;
  list-style: none;
}

.dir-browser {
  max-height: 240px;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: 6px;
}

.dir-list button {
  width: 100%;
  border: none;
  border-radius: 0;
  background: none;
  text-align: left;
  font-family: var(--mono);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
````

- [ ] **Step 10: Utwórz `src/web/api.ts`**

Każdy dostęp do `sessionStorage` jest w `try/catch`, bo w trybie prywatnym może rzucić wyjątek.

````ts
import type {
  CommentStatus,
  CommentsResponse,
  DirListing,
  FileEntry,
  FileView,
  SessionInfo,
} from '../core/types.js';
import { t } from './strings.js';

const TOKEN_KEY = 'docsreview-token';
let token = '';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function initToken(): void {
  const fromUrl = new URLSearchParams(location.search).get('token');
  try {
    if (fromUrl !== null) sessionStorage.setItem(TOKEN_KEY, fromUrl);
    token = fromUrl ?? sessionStorage.getItem(TOKEN_KEY) ?? '';
  } catch {
    token = fromUrl ?? '';
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, t.connectionLost);
  }
  const data = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new ApiError(response.status, data.error ?? `HTTP ${response.status}`);
  return data as T;
}

export interface CommentPatch {
  text?: string;
  status?: CommentStatus;
  checked?: true;
}

export const api = {
  session: () => request<SessionInfo>('GET', '/api/session'),
  setRoot: (path: string) => request<SessionInfo>('POST', '/api/root', { path }),
  dirs: (path?: string) =>
    request<DirListing>('GET', path === undefined ? '/api/dirs' : `/api/dirs?path=${encodeURIComponent(path)}`),
  setShowIgnored: (showIgnored: boolean) => request<unknown>('PATCH', '/api/review', { showIgnored }),
  files: () => request<FileEntry[]>('GET', '/api/files'),
  file: (path: string) => request<FileView>('GET', `/api/file?path=${encodeURIComponent(path)}`),
  comments: () => request<CommentsResponse>('GET', '/api/comments'),
  addComment: (file: string, line: number, text: string, contentHash: string) =>
    request<{ id: string }>('POST', '/api/comments', { file, line, text, contentHash }),
  patchComment: (id: string, patch: CommentPatch) =>
    request<unknown>('PATCH', `/api/comments/${encodeURIComponent(id)}`, patch),
  deleteComment: (id: string) => request<unknown>('DELETE', `/api/comments/${encodeURIComponent(id)}`),
  deleteResolved: () => request<unknown>('DELETE', '/api/comments?status=resolved'),
  handoff: () => request<unknown>('POST', '/api/handoff'),
};

export function openEvents(onChange: () => void, onStatus: (connected: boolean) => void): EventSource {
  const source = new EventSource(`/api/events?token=${encodeURIComponent(token)}`);
  source.addEventListener('open', () => onStatus(true));
  source.addEventListener('error', () => onStatus(false));
  source.addEventListener('files-changed', onChange);
  source.addEventListener('review-changed', onChange);
  return source;
}
````

- [ ] **Step 11: Utwórz `src/web/state.ts`**

`navigate` zmienia stan od razu i dopiero potem hash adresu, więc zdarzenie `hashchange` po własnej nawigacji nie ładuje pliku drugi raz. Tekst szkicu komentarza jest trzymany w `store.draft.text`, żeby przetrwał przebudowanie panelu RENDER po zmianie pliku.

````ts
import { reactive } from 'vue';
import type { CommentsResponse, FileEntry, FileView, SessionInfo } from '../core/types.js';
import { api, ApiError, initToken, openEvents, type CommentPatch } from './api.js';
import { formatRoute, parseRoute, type Route } from './lib/route.js';
import { t } from './strings.js';

export interface Draft {
  line: number;
  pane: 'raw' | 'render';
  text: string;
}

interface Store {
  session: SessionInfo | null;
  files: FileEntry[];
  fileView: FileView | null;
  fileError: string | null;
  comments: CommentsResponse;
  route: Route;
  focusLine: number | null;
  connected: boolean;
  showResolved: boolean;
  draft: Draft | null;
  error: string | null;
  notice: string | null;
}

const REFRESH_DELAY_MS = 50;
const NOTICE_MS = 4000;

export const store = reactive<Store>({
  session: null,
  files: [],
  fileView: null,
  fileError: null,
  comments: { comments: [], output: '' },
  route: parseRoute(location.hash),
  focusLine: null,
  connected: true,
  showResolved: false,
  draft: null,
  error: null,
  notice: null,
});

let refreshTimer: number | null = null;
let noticeTimer: number | null = null;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function showNotice(message: string): void {
  store.notice = message;
  if (noticeTimer !== null) clearTimeout(noticeTimer);
  noticeTimer = window.setTimeout(() => {
    store.notice = null;
  }, NOTICE_MS);
}

async function loadFile(): Promise<void> {
  const path = store.route.file;
  if (path === null) {
    store.fileView = null;
    store.fileError = null;
    return;
  }
  try {
    const view = await api.file(path);
    if (store.route.file !== path) return;
    store.fileView = view;
    store.fileError = null;
  } catch (error) {
    if (store.route.file !== path) return;
    if (error instanceof ApiError && error.status === 404) {
      store.fileView = null;
      store.fileError = t.fileMissing;
    } else if (store.fileView === null) {
      store.fileError = messageOf(error);
    } else {
      store.error = messageOf(error);
    }
  }
}

function applyRoute(next: Route): void {
  const fileChanged = next.file !== store.route.file;
  store.route = next;
  if (fileChanged) {
    store.fileView = null;
    store.fileError = null;
    store.draft = null;
    void loadFile();
  }
}

export function navigate(change: Partial<Route>): void {
  const next: Route = { ...store.route, ...change };
  applyRoute(next);
  const hash = formatRoute(next);
  if (hash !== location.hash) location.hash = hash;
}

export function openFile(path: string, line: number | null = null): void {
  store.focusLine = line;
  navigate({ tab: 'files', file: path });
}

export async function refresh(): Promise<void> {
  try {
    const [session, files, comments] = await Promise.all([api.session(), api.files(), api.comments()]);
    store.session = session;
    store.files = files;
    store.comments = comments;
    if (store.route.file === null && files.length > 0) {
      navigate({ file: files[0]!.path });
      return;
    }
    await loadFile();
  } catch (error) {
    store.error = messageOf(error);
  }
}

function scheduleRefresh(): void {
  if (refreshTimer !== null) return;
  refreshTimer = window.setTimeout(() => {
    refreshTimer = null;
    void refresh();
  }, REFRESH_DELAY_MS);
}

export async function init(): Promise<void> {
  initToken();
  window.addEventListener('hashchange', () => applyRoute(parseRoute(location.hash)));
  await refresh();
  openEvents(scheduleRefresh, (connected) => {
    const reconnected = connected && !store.connected;
    store.connected = connected;
    if (reconnected) scheduleRefresh();
  });
}

async function run(action: () => Promise<unknown>): Promise<boolean> {
  let ok = true;
  try {
    await action();
    store.error = null;
  } catch (error) {
    store.error = messageOf(error);
    ok = false;
  }
  await refresh();
  return ok;
}

export function startDraft(line: number, pane: Draft['pane']): void {
  if (!store.connected) return;
  store.draft = { line, pane, text: '' };
}

export async function submitDraft(text: string): Promise<void> {
  const view = store.fileView;
  const draft = store.draft;
  if (view === null || draft === null || text.trim() === '') return;
  draft.text = text;
  try {
    await api.addComment(view.path, draft.line, text, view.contentHash);
    store.draft = null;
    store.error = null;
  } catch (error) {
    const stale = error instanceof ApiError && error.status === 409;
    store.error = stale ? t.fileChangedWhileCommenting : messageOf(error);
  }
  await refresh();
}

export function updateComment(id: string, patch: CommentPatch): Promise<boolean> {
  return run(() => api.patchComment(id, patch));
}

export function removeComment(id: string): Promise<boolean> {
  return run(() => api.deleteComment(id));
}

export function removeResolved(): Promise<boolean> {
  return run(() => api.deleteResolved());
}

export function setShowIgnored(value: boolean): Promise<boolean> {
  return run(() => api.setShowIgnored(value));
}

export async function changeRoot(path: string): Promise<boolean> {
  try {
    await api.setRoot(path);
  } catch (error) {
    store.error = messageOf(error);
    return false;
  }
  store.error = null;
  navigate({ tab: 'files', file: null });
  await refresh();
  return true;
}

export async function copyAndHandOff(): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(store.comments.output);
  } catch {
    store.error = t.copyFailed;
    return false;
  }
  const done = await run(() => api.handoff());
  if (done) showNotice(t.copied);
  return done;
}
````

- [ ] **Step 12: Utwórz `src/web/lib/scrollSync.ts`**

````ts
const SUPPRESS_MS = 150;
const LINE_SELECTOR = '.raw-line, [data-block]';

function lineElements(pane: HTMLElement): HTMLElement[] {
  return [...pane.querySelectorAll<HTMLElement>(LINE_SELECTOR)];
}

export function topLine(pane: HTMLElement): number | null {
  const edge = pane.getBoundingClientRect().top + 1;
  let crossing: number | null = null;
  let below: number | null = null;
  for (const element of lineElements(pane)) {
    const rect = element.getBoundingClientRect();
    const start = Number(element.dataset.lineStart);
    if (rect.top <= edge && rect.bottom > edge) {
      if (crossing === null || start > crossing) crossing = start;
    } else if (rect.top > edge && below === null) {
      below = start;
    }
  }
  return crossing ?? below;
}

export function scrollToLine(pane: HTMLElement, line: number): void {
  let target: HTMLElement | null = null;
  let bestStart = -1;
  for (const element of lineElements(pane)) {
    const start = Number(element.dataset.lineStart);
    if (start <= line && start >= bestStart) {
      target = element;
      bestStart = start;
    }
  }
  if (target === null) return;
  pane.scrollTop += target.getBoundingClientRect().top - pane.getBoundingClientRect().top;
}

function follow(source: HTMLElement, target: HTMLElement): void {
  const sourceMax = source.scrollHeight - source.clientHeight;
  if (source.scrollTop <= 0) {
    target.scrollTop = 0;
  } else if (source.scrollTop >= sourceMax - 1) {
    target.scrollTop = target.scrollHeight - target.clientHeight;
  } else {
    const line = topLine(source);
    if (line !== null) scrollToLine(target, line);
  }
}

export function syncScroll(first: HTMLElement, second: HTMLElement): () => void {
  let suppressed: HTMLElement | null = null;
  let timer: number | null = null;

  const listener = (source: HTMLElement, target: HTMLElement) => (): void => {
    if (suppressed === source) return;
    suppressed = target;
    if (timer !== null) clearTimeout(timer);
    timer = window.setTimeout(() => {
      suppressed = null;
    }, SUPPRESS_MS);
    follow(source, target);
  };

  const onFirst = listener(first, second);
  const onSecond = listener(second, first);
  first.addEventListener('scroll', onFirst, { passive: true });
  second.addEventListener('scroll', onSecond, { passive: true });
  return () => {
    first.removeEventListener('scroll', onFirst);
    second.removeEventListener('scroll', onSecond);
    if (timer !== null) clearTimeout(timer);
  };
}
````

- [ ] **Step 13: Utwórz `src/web/components/CommentForm.vue`**

````vue
<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { t } from '../strings.js';

const props = defineProps<{ initial: string }>();
const emit = defineEmits<{ submit: [text: string]; cancel: []; change: [text: string] }>();

const text = ref(props.initial);
const area = ref<HTMLTextAreaElement | null>(null);

onMounted(() => area.value?.focus());

function submit(): void {
  if (text.value.trim() !== '') emit('submit', text.value);
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    submit();
  } else if (event.key === 'Escape') {
    event.preventDefault();
    emit('cancel');
  }
}
</script>

<template>
  <div class="comment-form">
    <textarea
      ref="area"
      v-model="text"
      rows="3"
      :placeholder="t.commentPlaceholder"
      :aria-label="t.commentPlaceholder"
      @input="emit('change', text)"
      @keydown="onKeydown"
    ></textarea>
    <div class="comment-form-actions">
      <span class="hint">{{ t.saveHint }}</span>
      <button type="button" @click="emit('cancel')">{{ t.cancel }}</button>
      <button type="button" class="primary" :disabled="text.trim() === ''" @click="submit">{{ t.save }}</button>
    </div>
  </div>
</template>
````

- [ ] **Step 14: Utwórz `src/web/components/CommentBadges.vue`**

````vue
<script setup lang="ts">
import type { CommentView } from '../../core/types.js';
import { t } from '../strings.js';

defineProps<{ comment: CommentView }>();
</script>

<template>
  <span class="badges">
    <span class="badge" :class="comment.status">{{ comment.status === 'open' ? t.open : t.resolved }}</span>
    <span v-if="comment.handedOff" class="badge handed-off">{{ t.handedOff }}</span>
    <span v-if="comment.lineChanged" class="badge line-changed">{{ t.lineChanged }}</span>
    <span v-if="comment.needsCheck" class="badge needs-check">{{ t.needsCheck }}</span>
    <span v-if="comment.fileMissing" class="badge missing">{{ t.missingFile }}</span>
  </span>
</template>
````

- [ ] **Step 15: Utwórz `src/web/components/CommentActions.vue`**

````vue
<script setup lang="ts">
import type { CommentView } from '../../core/types.js';
import { removeComment, store, updateComment } from '../state.js';
import { t } from '../strings.js';

defineProps<{ comment: CommentView; editable?: boolean }>();
const emit = defineEmits<{ edit: [] }>();
</script>

<template>
  <div class="comment-actions">
    <button
      v-if="comment.needsCheck"
      type="button"
      :disabled="!store.connected"
      @click="updateComment(comment.id, { checked: true })"
    >
      {{ t.stillValid }}
    </button>
    <button
      v-if="comment.status === 'open'"
      type="button"
      :disabled="!store.connected"
      @click="updateComment(comment.id, { status: 'resolved' })"
    >
      {{ t.resolve }}
    </button>
    <button v-else type="button" :disabled="!store.connected" @click="updateComment(comment.id, { status: 'open' })">
      {{ t.reopen }}
    </button>
    <button v-if="editable" type="button" :disabled="!store.connected" @click="emit('edit')">{{ t.edit }}</button>
    <button type="button" :disabled="!store.connected" @click="removeComment(comment.id)">{{ t.remove }}</button>
  </div>
</template>
````

- [ ] **Step 16: Utwórz `src/web/components/CommentCard.vue`**

````vue
<script setup lang="ts">
import { ref } from 'vue';
import type { CommentView } from '../../core/types.js';
import { updateComment } from '../state.js';
import { t } from '../strings.js';
import CommentActions from './CommentActions.vue';
import CommentBadges from './CommentBadges.vue';
import CommentForm from './CommentForm.vue';

const props = defineProps<{ comment: CommentView }>();
const editing = ref(false);

async function saveEdit(text: string): Promise<void> {
  if (await updateComment(props.comment.id, { text })) editing.value = false;
}
</script>

<template>
  <div class="comment" :class="[comment.status, { 'needs-check': comment.needsCheck }]">
    <CommentBadges :comment="comment" />
    <div v-if="comment.lineChanged" class="comment-was">{{ t.was }} {{ comment.previousLineText }}</div>
    <CommentForm v-if="editing" :initial="comment.text" @submit="saveEdit" @cancel="editing = false" />
    <template v-else>
      <div class="comment-text">{{ comment.text }}</div>
      <CommentActions :comment="comment" editable @edit="editing = true" />
    </template>
  </div>
</template>
````

- [ ] **Step 17: Utwórz `src/web/components/RawPane.vue`**

````vue
<script setup lang="ts">
import { computed } from 'vue';
import { splitLines } from '../../core/lines.js';
import type { CommentView, FileView } from '../../core/types.js';
import { startDraft, store, submitDraft } from '../state.js';
import { t } from '../strings.js';
import CommentCard from './CommentCard.vue';
import CommentForm from './CommentForm.vue';

const props = defineProps<{ view: FileView; comments: CommentView[] }>();

const lines = computed(() => splitLines(props.view.content));
const changed = computed(() => new Set(props.view.changedLines));

const byLine = computed(() => {
  const lastLine = Math.max(lines.value.length, 1);
  const map = new Map<number, CommentView[]>();
  for (const comment of props.comments) {
    const line = Math.min(comment.currentLine, lastLine);
    map.set(line, [...(map.get(line) ?? []), comment]);
  }
  return map;
});

const rows = computed(() => (lines.value.length === 0 ? [''] : lines.value));

function hasDraft(line: number): boolean {
  return store.draft?.pane === 'raw' && store.draft.line === line;
}

function setDraftText(text: string): void {
  if (store.draft !== null) store.draft.text = text;
}
</script>

<template>
  <div class="raw">
    <template v-for="(text, index) in rows" :key="index">
      <div class="raw-line" :class="{ changed: changed.has(index + 1) }" :data-line-start="index + 1">
        <span class="raw-number">{{ index + 1 }}</span>
        <button
          v-if="lines.length > 0"
          type="button"
          class="add"
          :title="t.addComment"
          :aria-label="`${t.addComment}: ${index + 1}`"
          @click="startDraft(index + 1, 'raw')"
        >
          +
        </button>
        <span class="raw-text">{{ text }}</span>
      </div>
      <div v-if="byLine.has(index + 1) || hasDraft(index + 1)" class="raw-comments">
        <CommentCard v-for="comment in byLine.get(index + 1)" :key="comment.id" :comment="comment" />
        <CommentForm
          v-if="hasDraft(index + 1)"
          :initial="store.draft?.text ?? ''"
          @change="setDraftText"
          @submit="submitDraft"
          @cancel="store.draft = null"
        />
      </div>
    </template>
  </div>
</template>
````

- [ ] **Step 18: Utwórz `src/web/components/RenderPane.vue`**

HTML z `renderMarkdown` jest wstawiany przez `innerHTML`, a nie `v-html`, żeby komponent sam decydował, kiedy go wymienić. Pod blokami powstają puste elementy `.comment-slot`, do których `Teleport` wstawia komentarze i formularz. Przebudowa następuje tylko wtedy, gdy zmieni się treść pliku, zmienione linie, komentarze albo pozycja szkicu.

````vue
<script setup lang="ts">
import { computed, nextTick, onMounted, ref, shallowRef, watch } from 'vue';
import type { CommentView, FileView } from '../../core/types.js';
import { findBlockIndex } from '../lib/blocks.js';
import { renderMarkdown } from '../lib/render.js';
import { startDraft, store, submitDraft } from '../state.js';
import { t } from '../strings.js';
import CommentCard from './CommentCard.vue';
import CommentForm from './CommentForm.vue';

interface Slot {
  key: number;
  target: HTMLElement;
  comments: CommentView[];
  draft: boolean;
}

const props = defineProps<{ view: FileView; comments: CommentView[] }>();
const emit = defineEmits<{ rendered: [] }>();

const body = ref<HTMLElement | null>(null);
const slots = shallowRef<Slot[]>([]);
const hovered = ref<{ line: number; top: number } | null>(null);
let renderedHash: string | null = null;
let generation = 0;

const draftLine = computed(() => (store.draft?.pane === 'render' ? store.draft.line : null));

const signature = computed(() =>
  JSON.stringify([props.view.contentHash, props.view.changedLines, props.comments, draftLine.value]),
);

function createSlot(block: HTMLElement): HTMLElement {
  const holder = document.createElement('div');
  holder.className = 'comment-slot';
  if (block.tagName === 'TR') {
    const row = document.createElement('tr');
    row.className = 'comment-slot-row';
    const cell = document.createElement('td');
    cell.colSpan = 99;
    cell.append(holder);
    row.append(cell);
    block.after(row);
  } else if (block.tagName === 'LI') {
    const nested = block.querySelector(':scope > ul, :scope > ol');
    if (nested === null) block.append(holder);
    else nested.before(holder);
  } else {
    block.after(holder);
  }
  return holder;
}

async function rebuild(): Promise<void> {
  const current = ++generation;
  slots.value = [];
  hovered.value = null;
  await nextTick();
  const element = body.value;
  if (element === null || current !== generation) return;

  if (renderedHash !== props.view.contentHash) {
    element.innerHTML = renderMarkdown(props.view.content);
    renderedHash = props.view.contentHash;
  } else {
    for (const old of element.querySelectorAll('.comment-slot-row, .comment-slot')) old.remove();
  }

  const blocks = [...element.querySelectorAll<HTMLElement>('[data-block]')];
  const ranges = blocks.map((block) => ({
    start: Number(block.dataset.lineStart),
    end: Number(block.dataset.lineEnd),
  }));
  const changed = new Set(props.view.changedLines);
  blocks.forEach((block, index) => {
    const range = ranges[index]!;
    let isChanged = false;
    for (let line = range.start; line <= range.end && !isChanged; line++) isChanged = changed.has(line);
    block.classList.toggle('changed', isChanged);
  });

  const byBlock = new Map<number, Slot>();
  const slotAt = (index: number): Slot => {
    let slot = byBlock.get(index);
    if (slot === undefined) {
      slot = { key: index, target: createSlot(blocks[index]!), comments: [], draft: false };
      byBlock.set(index, slot);
    }
    return slot;
  };
  for (const comment of props.comments) {
    const index = findBlockIndex(ranges, comment.currentLine);
    if (index !== -1) slotAt(index).comments.push(comment);
  }
  if (draftLine.value !== null) {
    const index = findBlockIndex(ranges, draftLine.value);
    if (index !== -1) slotAt(index).draft = true;
  }
  slots.value = [...byBlock.values()];
  await nextTick();
  if (current === generation) emit('rendered');
}

function onHover(event: MouseEvent): void {
  const target = event.target as HTMLElement;
  if (target.closest('.render-add, .comment-slot') !== null) return;
  const block = target.closest<HTMLElement>('[data-block]');
  const pane = event.currentTarget as HTMLElement;
  if (block === null) return;
  hovered.value = {
    line: Number(block.dataset.lineStart),
    top: block.getBoundingClientRect().top - pane.getBoundingClientRect().top,
  };
}

function setDraftText(text: string): void {
  if (store.draft !== null) store.draft.text = text;
}

watch(signature, rebuild, { flush: 'post' });
onMounted(rebuild);
</script>

<template>
  <div class="render" @mouseover="onHover" @mouseleave="hovered = null">
    <button
      v-if="hovered !== null"
      type="button"
      class="add render-add"
      :style="{ top: `${hovered.top}px` }"
      :title="t.addComment"
      :aria-label="`${t.addComment}: ${hovered.line}`"
      @click="startDraft(hovered.line, 'render')"
    >
      +
    </button>
    <div ref="body" class="render-body"></div>
    <Teleport v-for="slot in slots" :key="slot.key" :to="slot.target">
      <CommentCard v-for="comment in slot.comments" :key="comment.id" :comment="comment" />
      <CommentForm
        v-if="slot.draft"
        :initial="store.draft?.text ?? ''"
        @change="setDraftText"
        @submit="submitDraft"
        @cancel="store.draft = null"
      />
    </Teleport>
  </div>
</template>
````

- [ ] **Step 19: Utwórz `src/web/components/FileTreeNode.vue`**

````vue
<script setup lang="ts">
import { computed } from 'vue';
import type { TreeNode } from '../lib/tree.js';
import { openFile, store } from '../state.js';
import { t } from '../strings.js';

const props = defineProps<{ node: TreeNode; toggled: Set<string>; collapseIgnored: boolean }>();
const emit = defineEmits<{ toggle: [path: string] }>();

const collapsedByDefault = computed(
  () => props.collapseIgnored && props.node.ignored && props.node.openComments === 0,
);
const collapsed = computed(() => props.toggled.has(props.node.path) !== collapsedByDefault.value);
</script>

<template>
  <li v-if="node.file === null" class="tree-dir" :class="{ ignored: node.ignored }">
    <button type="button" class="tree-row" :aria-expanded="!collapsed" @click="emit('toggle', node.path)">
      <span class="tree-arrow">{{ collapsed ? '▸' : '▾' }}</span>
      <span class="tree-name">{{ node.name }}/</span>
      <span v-if="collapsed && node.openComments > 0" class="count">{{ node.openComments }}</span>
    </button>
    <ul v-if="!collapsed" class="tree-list">
      <FileTreeNode
        v-for="child in node.children"
        :key="child.path"
        :node="child"
        :toggled="toggled"
        :collapse-ignored="collapseIgnored"
        @toggle="emit('toggle', $event)"
      />
    </ul>
  </li>
  <li v-else class="tree-file" :class="{ ignored: node.ignored, active: store.route.file === node.path }">
    <button type="button" class="tree-row" :title="node.path" @click="openFile(node.path)">
      <span class="tree-name">{{ node.name }}</span>
      <span v-if="node.file.roundStatus === 'changed'" class="badge round-changed">{{ t.statusChanged }}</span>
      <span v-if="node.file.roundStatus === 'new'" class="badge round-new">{{ t.statusNew }}</span>
      <span v-if="node.file.openComments > 0" class="count">{{ node.file.openComments }}</span>
    </button>
  </li>
</template>
````

- [ ] **Step 20: Utwórz `src/web/components/FileTree.vue`**

````vue
<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { buildTree } from '../lib/tree.js';
import { setShowIgnored, store } from '../state.js';
import { t } from '../strings.js';
import FileTreeNode from './FileTreeNode.vue';

const tree = computed(() => buildTree(store.files));
const toggled = ref(new Set<string>());
const collapseIgnored = computed(() => store.files.some((file) => !file.ignored));

function storageKey(): string {
  return `docsreview-toggled:${store.session?.root ?? ''}`;
}

function load(): Set<string> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(storageKey()) ?? '[]');
    return new Set(Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []);
  } catch {
    return new Set();
  }
}

function toggle(path: string): void {
  const next = new Set(toggled.value);
  if (!next.delete(path)) next.add(path);
  toggled.value = next;
  try {
    localStorage.setItem(storageKey(), JSON.stringify([...next]));
  } catch {
    // collapsing still works for this page view without storage
  }
}

function onShowIgnored(event: Event): void {
  void setShowIgnored((event.target as HTMLInputElement).checked);
}

watch(
  () => store.session?.root,
  () => {
    toggled.value = load();
  },
  { immediate: true },
);
</script>

<template>
  <div class="tree">
    <label class="tree-toggle">
      <input
        type="checkbox"
        :checked="store.session?.showIgnored ?? false"
        :disabled="!store.connected"
        @change="onShowIgnored"
      />
      {{ t.showIgnored }}
    </label>
    <ul class="tree-list tree-root">
      <FileTreeNode
        v-for="node in tree"
        :key="node.path"
        :node="node"
        :toggled="toggled"
        :collapse-ignored="collapseIgnored"
        @toggle="toggle"
      />
    </ul>
  </div>
</template>
````

- [ ] **Step 21: Utwórz `src/web/components/FilesView.vue`**

````vue
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { scrollToLine, syncScroll } from '../lib/scrollSync.js';
import { store } from '../state.js';
import { t } from '../strings.js';
import FileTree from './FileTree.vue';
import RawPane from './RawPane.vue';
import RenderPane from './RenderPane.vue';

const emit = defineEmits<{ 'change-dir': [] }>();

const rawScroll = ref<HTMLElement | null>(null);
const renderScroll = ref<HTMLElement | null>(null);
let stopSync: (() => void) | null = null;

const visibleComments = computed(() =>
  (store.fileView?.comments ?? []).filter((comment) => store.showResolved || comment.status === 'open'),
);

function applyFocus(clear: boolean): void {
  const line = store.focusLine;
  if (line === null) return;
  if (rawScroll.value !== null) scrollToLine(rawScroll.value, line);
  if (renderScroll.value !== null) scrollToLine(renderScroll.value, line);
  if (clear) store.focusLine = null;
}

watch(
  [rawScroll, renderScroll],
  ([raw, render]) => {
    stopSync?.();
    stopSync = raw !== null && render !== null ? syncScroll(raw, render) : null;
  },
  { flush: 'post' },
);

watch(
  () => [store.fileView?.contentHash, store.focusLine] as const,
  async () => {
    await nextTick();
    applyFocus(store.fileView?.tooLarge === true);
  },
  { flush: 'post', immediate: true },
);

onBeforeUnmount(() => stopSync?.());
</script>

<template>
  <div class="files-view">
    <aside class="sidebar">
      <FileTree />
    </aside>
    <section class="main">
      <div v-if="store.files.length === 0" class="empty">
        <p>{{ t.noFiles }}</p>
        <p class="hint">{{ t.noFilesHint }}</p>
        <button type="button" @click="emit('change-dir')">{{ t.changeDir }}</button>
      </div>
      <div v-else-if="store.fileError !== null" class="empty">{{ store.fileError }}</div>
      <div v-else-if="store.fileView === null" class="empty">{{ t.selectFile }}</div>
      <template v-else>
        <div class="toolbar">
          <span class="file-path">{{ store.fileView.path }}</span>
          <label>
            <input v-model="store.showResolved" type="checkbox" />
            {{ t.showResolved }}
          </label>
        </div>
        <div v-if="store.fileView.tooLarge" class="banner warning">{{ t.tooLarge }}</div>
        <div class="panes">
          <div class="pane">
            <div class="pane-title">{{ t.raw }}</div>
            <div ref="rawScroll" class="pane-scroll" data-pane="raw">
              <RawPane :view="store.fileView" :comments="visibleComments" />
            </div>
          </div>
          <div v-if="!store.fileView.tooLarge" class="pane">
            <div class="pane-title">{{ t.render }}</div>
            <div ref="renderScroll" class="pane-scroll" data-pane="render">
              <RenderPane :view="store.fileView" :comments="visibleComments" @rendered="applyFocus(true)" />
            </div>
          </div>
        </div>
      </template>
    </section>
  </div>
</template>
````

- [ ] **Step 22: Utwórz `src/web/App.vue`**

To wersja bez zakładek; Zadanie 11 zastąpi ten plik pełną wersją.

````vue
<script setup lang="ts">
import { onMounted } from 'vue';
import FilesView from './components/FilesView.vue';
import { init, store } from './state.js';
import { t } from './strings.js';

onMounted(init);
</script>

<template>
  <div class="app">
    <header class="header">
      <strong class="app-name">{{ t.appName }}</strong>
      <span class="root" :title="store.session?.root">{{ store.session?.root }}</span>
    </header>
    <div v-if="!store.connected" class="banner error" role="alert">{{ t.connectionLost }}</div>
    <div v-if="store.error !== null" class="banner error" role="alert">
      {{ store.error }}
      <button type="button" @click="store.error = null">{{ t.dismiss }}</button>
    </div>
    <FilesView />
  </div>
</template>
````

- [ ] **Step 23: Sprawdź typy**

Run: `npm run typecheck`
Expected: brak błędów.

- [ ] **Step 24: Uruchom testy end-to-end i sprawdź, że przechodzą**

Run: `npm run test:e2e`
Expected: PASS, 5 testów (4 w `comments.spec.ts`, 1 w `ignored.spec.ts`).

- [ ] **Step 25: Uruchom testy jednostkowe**

Run: `npm test`
Expected: PASS, 163 testy.

- [ ] **Step 26: Commit**

```bash
git add playwright.config.ts vite.config.ts tests/e2e/prepare.mjs tests/e2e/comments.spec.ts tests/e2e/ignored.spec.ts src/web/index.html src/web/main.ts src/web/style.css src/web/api.ts src/web/state.ts src/web/lib/scrollSync.ts src/web/components src/web/App.vue
git commit -m "feat: add files view with comments in raw and rendered panes"
```

---

### Task 11: Widok „Komentarze”, przekazanie i zmiana katalogu

**Files:**
- Create: `src/web/components/CommentRow.vue`
- Create: `src/web/components/CommentsView.vue`
- Create: `src/web/components/DirPicker.vue`
- Modify: `src/web/App.vue` (cały plik)
- Modify: `playwright.config.ts` (cały plik)
- Test: `tests/e2e/round.spec.ts`
- Create: `README.md`

**Interfaces:**
- Consumes: `store`, `openFile`, `navigate`, `init`, `copyAndHandOff`, `removeResolved`, `changeRoot` z `src/web/state.ts`; `api.dirs`; `CommentActions`, `CommentBadges`, `FilesView`; `needsCheckQuestion`, `t`.
- Produces:
  - `CommentRow`: props `comment: CommentView`
  - `CommentsView` (bez props)
  - `DirPicker`: zdarzenie `close()`
  - pełny `App.vue` z zakładkami „Pliki” i „Komentarze (N)”
- Klasy, na których polegają testy end-to-end: `.output`, `.badge.handed-off`, `.needs-check-group`, `.comment-row`, `.comment-row-main`, `.dir-current`.

- [ ] **Step 1: Zastąp `playwright.config.ts`** (dochodzi instancja `round`)

````ts
import path from 'node:path';
import { defineConfig } from '@playwright/test';

const servers = [
  { name: 'comments', port: 4599 },
  { name: 'ignored', port: 4600 },
  { name: 'round', port: 4601 },
];

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  workers: 1,
  use: {
    permissions: ['clipboard-read', 'clipboard-write'],
  },
  webServer: servers.map(({ name, port }) => ({
    command: `node tests/e2e/prepare.mjs ${name} && node dist/server/cli.js tests/e2e/.work/${name}/root --no-open --port ${port}`,
    url: `http://127.0.0.1:${port}/`,
    reuseExistingServer: false,
    env: {
      DOCSREVIEW_TOKEN: 'e2e',
      DOCSREVIEW_HOME: path.resolve('tests/e2e/.work', name, 'home'),
    },
  })),
});
````

- [ ] **Step 2: Napisz test end-to-end, który nie przechodzi**

Utwórz `tests/e2e/round.spec.ts`:

````ts
import fs from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '@playwright/test';

const ROOT = path.resolve('tests/e2e/.work/round/root');
const FIRST_OUTPUT = '### docs/guide.md:3 > podaj komendę npx\n\n### docs/guide.md:6 > rozwiń ten krok';

test.use({ baseURL: 'http://127.0.0.1:4601' });

test('a full review round', async ({ page }) => {
  await page.goto('/?token=e2e');
  await expect(page.locator('.file-path')).toHaveText('docs/guide.md');

  const raw = page.locator('[data-pane="raw"]');
  const render = page.locator('[data-pane="render"]');

  await test.step('comment on a line in the raw pane', async () => {
    await raw.locator('.raw-line').nth(2).hover();
    await raw.getByRole('button', { name: 'Dodaj komentarz: 3', exact: true }).click();
    await page.getByPlaceholder('Treść komentarza').fill('podaj komendę npx');
    await page.keyboard.press('ControlOrMeta+Enter');
    await expect(raw.locator('.comment')).toHaveCount(1);
    await expect(render.locator('.comment')).toHaveCount(1);
  });

  await test.step('comment on a block in the render pane', async () => {
    await render.locator('li', { hasText: 'krok drugi' }).hover();
    await render.getByRole('button', { name: 'Dodaj komentarz: 6', exact: true }).click();
    await page.getByPlaceholder('Treść komentarza').fill('rozwiń ten krok');
    await page.getByRole('button', { name: 'Zapisz' }).click();
    await expect(raw.locator('.comment')).toHaveCount(2);
    await expect(render.locator('.comment')).toHaveCount(2);
  });

  const output = page.getByRole('textbox', { name: 'Output' });
  const copy = page.locator('.output').getByRole('button', { name: 'Kopiuj' });

  await test.step('copy the output, which starts a round', async () => {
    await page.getByRole('button', { name: 'Komentarze (2)' }).click();
    await expect(output).toHaveValue(FIRST_OUTPUT);
    await copy.click();
    await expect(page.getByRole('status')).toHaveText('Skopiowano. Zaczęła się nowa runda.');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(FIRST_OUTPUT);
    await expect(page.locator('.badge.handed-off')).toHaveCount(2);
  });

  await test.step('the agent changes one file and adds another', async () => {
    await fs.writeFile(
      path.join(ROOT, 'docs/guide.md'),
      ['# Przewodnik', '', 'Uruchom `npx docsreview`.', '', '- krok pierwszy', '- krok drugi', ''].join('\n'),
    );
    await fs.writeFile(path.join(ROOT, 'docs/new.md'), '# Nowy\n');
    await expect(page.locator('.needs-check-group .comment-row')).toHaveCount(1);
    await expect(page.locator('.needs-check-group')).toContainText('linia zmieniona');
  });

  await test.step('copying again asks about comments that need a check', async () => {
    await copy.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('1 komentarz z poprzedniej rundy ma zmienioną linię. Skopiować mimo to?');
    await dialog.getByRole('button', { name: 'Pokaż je' }).click();
    await expect(dialog).toHaveCount(0);
  });

  await test.step('the files view shows what changed in this round', async () => {
    await page.locator('.needs-check-group .comment-row-main').click();
    await expect(page.locator('.tree-file', { hasText: 'guide.md' }).locator('.badge')).toHaveText('zmieniony');
    await expect(page.locator('.tree-file', { hasText: 'new.md' }).locator('.badge')).toHaveText('nowy');
    await expect(raw.locator('.raw-line.changed')).toHaveCount(1);
    await expect(render.locator('p.changed')).toHaveText('Uruchom npx docsreview.');
    const card = raw.locator('.comment.needs-check');
    await expect(card).toContainText('było: Uruchom `npm start`.');
    await card.getByRole('button', { name: 'Rozwiąż' }).click();
    await expect(raw.locator('.comment')).toHaveCount(1);
  });

  await test.step('the resolved comment is gone from the output', async () => {
    await page.getByRole('button', { name: 'Komentarze (1)' }).click();
    await expect(output).toHaveValue('### docs/guide.md:6 > rozwiń ten krok');
  });
});

test('the working directory can be changed and restored from the recent list', async ({ page }) => {
  await page.goto('/?token=e2e');
  await page.getByRole('button', { name: 'Zmień katalog' }).click();
  const dialog = page.getByRole('dialog', { name: 'Zmień katalog roboczy' });

  await dialog.getByRole('button', { name: 'docs/', exact: true }).click();
  await expect(dialog.locator('.dir-current')).toHaveText(path.join(ROOT, 'docs'));
  await dialog.getByRole('button', { name: 'Wybierz ten katalog' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.root')).toHaveText(path.join(ROOT, 'docs'));
  await expect(page.locator('.file-path')).toHaveText('guide.md');
  await expect(page.getByRole('button', { name: 'Komentarze (0)' })).toBeVisible();

  await page.getByRole('button', { name: 'Zmień katalog' }).click();
  await dialog.getByRole('button', { name: ROOT, exact: true }).click();
  await expect(page.locator('.root')).toHaveText(ROOT);
  await expect(page.locator('.file-path')).toHaveText('docs/guide.md');
});
````

- [ ] **Step 3: Uruchom test i sprawdź, że nie przechodzi**

Run: `npm run test:e2e -- tests/e2e/round.spec.ts`
Expected: FAIL, bo strona nie ma przycisku „Komentarze (2)” ani „Zmień katalog”.

- [ ] **Step 4: Utwórz `src/web/components/CommentRow.vue`**

````vue
<script setup lang="ts">
import type { CommentView } from '../../core/types.js';
import { openFile } from '../state.js';
import CommentActions from './CommentActions.vue';
import CommentBadges from './CommentBadges.vue';

const props = defineProps<{ comment: CommentView }>();

function open(): void {
  if (!props.comment.fileMissing) openFile(props.comment.file, props.comment.currentLine);
}
</script>

<template>
  <li class="comment-row" :class="[comment.status, { 'needs-check': comment.needsCheck }]">
    <button type="button" class="comment-row-main" :disabled="comment.fileMissing" @click="open">
      <span class="location">{{ comment.file }}:{{ comment.currentLine }}</span>
      <CommentBadges :comment="comment" />
      <span class="comment-text">{{ comment.text }}</span>
    </button>
    <CommentActions :comment="comment" />
  </li>
</template>
````

- [ ] **Step 5: Utwórz `src/web/components/CommentsView.vue`**

Pierwsze kliknięcie „Kopiuj” przy komentarzach do sprawdzenia otwiera pytanie; kopiowanie następuje dopiero po kliknięciu „Kopiuj” w pytaniu. Samo kopiowanie i zapis przekazania robi `copyAndHandOff` ze `state.ts`: najpierw schowek, potem `POST /api/handoff`.

````vue
<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import type { CommentView } from '../../core/types.js';
import { copyAndHandOff, removeResolved, store } from '../state.js';
import { needsCheckQuestion, t } from '../strings.js';
import CommentRow from './CommentRow.vue';

type Filter = 'open' | 'resolved' | 'all';

const filter = ref<Filter>('open');
const confirming = ref(false);
const checkGroup = ref<HTMLElement | null>(null);

const filters: Array<{ value: Filter; label: string }> = [
  { value: 'open', label: t.filterOpen },
  { value: 'resolved', label: t.filterResolved },
  { value: 'all', label: t.filterAll },
];

const filtered = computed(() =>
  store.comments.comments.filter((comment) => filter.value === 'all' || comment.status === filter.value),
);
const toCheck = computed(() => filtered.value.filter((comment) => comment.needsCheck));
const groups = computed(() => {
  const byFile = new Map<string, CommentView[]>();
  for (const comment of filtered.value) {
    if (comment.needsCheck) continue;
    byFile.set(comment.file, [...(byFile.get(comment.file) ?? []), comment]);
  }
  return [...byFile];
});
const pendingChecks = computed(() => store.comments.comments.filter((comment) => comment.needsCheck).length);
const hasResolved = computed(() => store.comments.comments.some((comment) => comment.status === 'resolved'));
const canCopy = computed(() => store.comments.output !== '' && store.connected);

async function copy(): Promise<void> {
  if (pendingChecks.value > 0 && !confirming.value) {
    confirming.value = true;
    return;
  }
  confirming.value = false;
  await copyAndHandOff();
}

async function showThem(): Promise<void> {
  confirming.value = false;
  filter.value = 'open';
  await nextTick();
  checkGroup.value?.scrollIntoView({ block: 'start' });
}
</script>

<template>
  <div class="comments-view">
    <section class="comments-list">
      <div class="toolbar">
        <div class="filters" role="group">
          <button
            v-for="option in filters"
            :key="option.value"
            type="button"
            :class="{ active: filter === option.value }"
            :aria-pressed="filter === option.value"
            @click="filter = option.value"
          >
            {{ option.label }}
          </button>
        </div>
        <button type="button" :disabled="!hasResolved || !store.connected" @click="removeResolved()">
          {{ t.removeResolved }}
        </button>
      </div>
      <div class="comments-scroll">
        <p v-if="filtered.length === 0" class="empty">{{ t.noComments }}</p>
        <div v-if="toCheck.length > 0" ref="checkGroup" class="comment-group needs-check-group">
          <h3>{{ t.groupNeedsCheck }}</h3>
          <ul>
            <CommentRow v-for="comment in toCheck" :key="comment.id" :comment="comment" />
          </ul>
        </div>
        <div v-for="[file, comments] in groups" :key="file" class="comment-group">
          <h3>{{ file }}</h3>
          <ul>
            <CommentRow v-for="comment in comments" :key="comment.id" :comment="comment" />
          </ul>
        </div>
      </div>
    </section>
    <section class="output">
      <div class="toolbar">
        <strong>{{ t.output }}</strong>
        <button type="button" class="primary" :disabled="!canCopy" @click="copy">{{ t.copy }}</button>
      </div>
      <textarea
        class="output-text"
        readonly
        :aria-label="t.output"
        :placeholder="t.noOpenComments"
        :value="store.comments.output"
      ></textarea>
    </section>
    <div v-if="confirming" class="modal-backdrop" @click.self="confirming = false">
      <div class="modal" role="dialog" aria-modal="true">
        <p>{{ needsCheckQuestion(pendingChecks) }} {{ t.copyAnyway }}</p>
        <div class="modal-actions">
          <button type="button" @click="showThem">{{ t.showThem }}</button>
          <button type="button" class="primary" @click="copy">{{ t.copy }}</button>
        </div>
      </div>
    </div>
  </div>
</template>
````

- [ ] **Step 6: Utwórz `src/web/components/DirPicker.vue`**

````vue
<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import type { DirListing } from '../../core/types.js';
import { api } from '../api.js';
import { changeRoot, store } from '../state.js';
import { t } from '../strings.js';

const emit = defineEmits<{ close: [] }>();

const listing = ref<DirListing | null>(null);
const error = ref<string | null>(null);

async function browse(path?: string): Promise<void> {
  try {
    listing.value = await api.dirs(path);
    error.value = null;
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  }
}

function child(name: string): string {
  const base = listing.value?.path ?? '';
  return base.endsWith('/') ? `${base}${name}` : `${base}/${name}`;
}

async function choose(path: string): Promise<void> {
  if (await changeRoot(path)) {
    emit('close');
  } else {
    error.value = store.error;
    store.error = null;
  }
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') emit('close');
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown);
  void browse(store.session?.root);
});
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown));
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('close')">
    <div class="modal dir-picker" role="dialog" aria-modal="true" :aria-label="t.pickerTitle">
      <h2>{{ t.pickerTitle }}</h2>
      <p v-if="error !== null" class="banner error" role="alert">{{ error }}</p>
      <section v-if="(store.session?.recent.length ?? 0) > 0">
        <h3>{{ t.recent }}</h3>
        <ul class="dir-list">
          <li v-for="dir in store.session?.recent" :key="dir">
            <button type="button" @click="choose(dir)">{{ dir }}</button>
          </li>
        </ul>
      </section>
      <section v-if="listing !== null">
        <h3>{{ t.browse }}</h3>
        <p class="dir-current">{{ listing.path }}</p>
        <ul class="dir-list dir-browser">
          <li v-if="listing.parent !== null">
            <button type="button" @click="browse(listing.parent)">{{ t.parentDir }}</button>
          </li>
          <li v-for="dir in listing.dirs" :key="dir">
            <button type="button" @click="browse(child(dir))">{{ dir }}/</button>
          </li>
        </ul>
        <p v-if="listing.dirs.length === 0" class="hint">{{ t.noSubdirs }}</p>
      </section>
      <div class="modal-actions">
        <button type="button" @click="emit('close')">{{ t.cancel }}</button>
        <button type="button" class="primary" :disabled="listing === null" @click="listing && choose(listing.path)">
          {{ t.chooseThis }}
        </button>
      </div>
    </div>
  </div>
</template>
````

- [ ] **Step 7: Zastąp `src/web/App.vue`**

````vue
<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import CommentsView from './components/CommentsView.vue';
import DirPicker from './components/DirPicker.vue';
import FilesView from './components/FilesView.vue';
import { init, navigate, store } from './state.js';
import { t } from './strings.js';

const pickerOpen = ref(false);
const warningDismissed = ref(false);

const openCount = computed(
  () => store.comments.comments.filter((comment) => comment.status === 'open' && !comment.fileMissing).length,
);

onMounted(init);
</script>

<template>
  <div class="app">
    <header class="header">
      <strong class="app-name">{{ t.appName }}</strong>
      <nav class="tabs">
        <button type="button" :class="{ active: store.route.tab === 'files' }" @click="navigate({ tab: 'files' })">
          {{ t.tabFiles }}
        </button>
        <button
          type="button"
          :class="{ active: store.route.tab === 'comments' }"
          @click="navigate({ tab: 'comments' })"
        >
          {{ t.tabComments }} ({{ openCount }})
        </button>
      </nav>
      <span class="root" :title="store.session?.root">{{ store.session?.root }}</span>
      <button type="button" :disabled="!store.connected" @click="pickerOpen = true">{{ t.changeDir }}</button>
    </header>
    <div v-if="!store.connected" class="banner error" role="alert">{{ t.connectionLost }}</div>
    <div v-if="store.session?.warning && !warningDismissed" class="banner warning" role="alert">
      {{ store.session.warning }}
      <button type="button" @click="warningDismissed = true">{{ t.dismiss }}</button>
    </div>
    <div v-if="store.error !== null" class="banner error" role="alert">
      {{ store.error }}
      <button type="button" @click="store.error = null">{{ t.dismiss }}</button>
    </div>
    <div v-if="store.notice !== null" class="banner notice" role="status">{{ store.notice }}</div>
    <FilesView v-if="store.route.tab === 'files'" @change-dir="pickerOpen = true" />
    <CommentsView v-else />
    <DirPicker v-if="pickerOpen" @close="pickerOpen = false" />
  </div>
</template>
````

- [ ] **Step 8: Sprawdź typy**

Run: `npm run typecheck`
Expected: brak błędów.

- [ ] **Step 9: Uruchom wszystkie testy end-to-end**

Run: `npm run test:e2e`
Expected: PASS, 7 testów w 3 plikach.

- [ ] **Step 10: Uruchom testy jednostkowe**

Run: `npm test`
Expected: PASS, 163 testy.

- [ ] **Step 11: Utwórz `README.md`**

````markdown
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
````

- [ ] **Step 12: Sprawdź narzędzie ręcznie na tym repozytorium**

Run: `node dist/server/cli.js .`
Expected: w terminalu pojawia się adres z tokenem i otwiera się przeglądarka.

Sprawdź po kolei:
1. Drzewo pokazuje `CONTEXT.md`, `README.md` i pliki z `docs/`; nie pokazuje niczego z `node_modules`.
2. Po otwarciu `docs/superpowers/specs/2026-10-01-docsreview-design.md` tabele i bloki kodu są wyrenderowane, a przewijanie jednego panelu przesuwa drugi.
3. Najechanie na linię w RAW i na blok w RENDER pokazuje „+”; dodany komentarz widać w obu panelach.
4. Zakładka „Komentarze” pokazuje komentarz i output w formacie `### {ścieżka}:{linia} > {treść}`.
5. Przełącznik „Pokaż ignorowane” odsłania pliki z `.superpowers/`, jeśli taki katalog istnieje.
6. „Zmień katalog” otwiera okno z listą podkatalogów.
7. Po zatrzymaniu serwera (Ctrl+C) pojawia się baner „Brak połączenia z serwerem”.

Na koniec usuń testowy komentarz w interfejsie i zatrzymaj serwer.

- [ ] **Step 13: Commit**

```bash
git add src/web/components/CommentRow.vue src/web/components/CommentsView.vue src/web/components/DirPicker.vue src/web/App.vue playwright.config.ts tests/e2e/round.spec.ts README.md
git commit -m "feat: add comments view, handoff and directory picker"
```
