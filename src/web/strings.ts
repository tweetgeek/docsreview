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
