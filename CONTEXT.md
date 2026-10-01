# DocsReview

Narzędzie do recenzowania plików Markdown pisanych dla agentów AI lub przez agentów. Recenzent komentuje linie, a zebrane komentarze przekazuje agentowi do poprawy.

Nazwy w nawiasach to odpowiedniki używane w kodzie.

## Language

**Review** (`review`):
Zbiór komentarzy przypisany do jednego katalogu roboczego. Ten sam plik widziany przez dwa różne katalogi robocze należy do dwóch niezależnych review.
_Avoid_: sesja, stan; nie używać jako nazwy widoku ani zakładki

**Katalog roboczy** (`root`):
Katalog wybrany przez recenzenta, w którym narzędzie szuka plików do recenzji. Wyznacza tożsamość review i jest punktem odniesienia dla wszystkich ścieżek plików.
_Avoid_: projekt, repozytorium, folder

**Plik** (`file`):
Plik Markdown (`.md`) leżący w katalogu roboczym, identyfikowany ścieżką względną do tego katalogu.
_Avoid_: dokument, strona

**Plik ignorowany** (`ignored file`):
Plik, który git ignoruje. Jest niewidoczny dla recenzenta, dopóki ten nie włączy pokazywania ignorowanych albo nie doda do niego komentarza.
_Avoid_: ukryty, wykluczony

**Komentarz** (`comment`):
Uwaga recenzenta przypięta do jednej linii pliku. Jest otwarty albo rozwiązany; rozwiązać go może wyłącznie recenzent.
_Avoid_: uwaga, notatka, adnotacja, wątek

**Kotwica** (`anchor`):
Punkt odniesienia komentarza: linia i jej treść w tej wersji pliku, do której komentarz się odnosi. Powstaje przy dodaniu komentarza i jest zastępowana aktualnym stanem pliku przy każdym przekazaniu.
_Avoid_: pozycja, lokalizacja, wskaźnik

**Blok** (`block`):
Najmniejszy fragment wyrenderowanego dokumentu, który można skomentować: nagłówek, akapit, element listy, wiersz tabeli, cytat albo pojedyncza linia bloku kodu. Komentarz do bloku jest przypięty do jego pierwszej linii źródłowej i dotyczy całego bloku.
_Avoid_: element, sekcja, fragment

**Komentarz przekazany**:
Otwarty komentarz, który był częścią ostatniego przekazania. To cecha wynikająca z przekazania, a nie trzeci status komentarza.
_Avoid_: wysłany, oczekujący

**Komentarz do sprawdzenia**:
Komentarz przekazany, którego linia zmieniła się w bieżącej rundzie, a recenzent jeszcze go nie rozwiązał, nie edytował ani nie potwierdził jako nadal aktualnego.
_Avoid_: nieaktualny, przeterminowany, osierocony

**Output** (`output`):
Tekst zbudowany ze wszystkich otwartych komentarzy review, gotowy do wklejenia agentowi. Każdy komentarz ma w nim postać `### {ścieżka}:{linia} > {treść}`.
_Avoid_: raport, eksport, podsumowanie

**Przekazanie** (`handoff`):
Moment, w którym recenzent kopiuje output, żeby dać go agentowi. Narzędzie pamięta tylko ostatnie przekazanie.
_Avoid_: eksport, wysłanie, kopiowanie

**Runda** (`round`):
Okres od jednego przekazania do następnego. Obejmuje wszystkie pliki review, także te bez komentarzy: zmiany pokazywane recenzentowi to zawsze zmiany z bieżącej rundy, czyli od ostatniego przekazania.
_Avoid_: iteracja, cykl, wersja
