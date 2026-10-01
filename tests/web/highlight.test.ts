import { describe, expect, it } from 'vitest';
import { highlightMarkdown, type Segment } from '../../src/web/lib/highlight.js';

type Pair = [string, Segment['kind']];

function pairs(segments: Segment[]): Pair[] {
  return segments.map((segment) => [segment.text, segment.kind]);
}

function line(text: string): Pair[] {
  return pairs(highlightMarkdown([text])[0]!);
}

function kinds(lines: string[]): Array<Segment['kind'] | 'mixed'> {
  return highlightMarkdown(lines).map((segments) => {
    if (segments.length === 0) return null;
    return segments.length === 1 ? segments[0]!.kind : 'mixed';
  });
}

describe('highlightMarkdown', () => {
  it('returns one list of segments per line and keeps every character', () => {
    const document = [
      '---',
      'name: deploy',
      '---',
      '# Tytuł',
      '',
      'Uruchom `npm start` i **poczekaj** na *wynik*, zobacz [opis](docs/a.md).',
      '- [x] krok <HARD-GATE>',
      '> cytat',
      '```sh',
      'npm install  # komentarz',
      '```',
      '   wcięta linia  ',
    ];
    const highlighted = highlightMarkdown(document);
    expect(highlighted).toHaveLength(document.length);
    expect(highlighted.map((segments) => segments.map((segment) => segment.text).join(''))).toEqual(document);
  });

  it('returns no segments for an empty line and for an empty file', () => {
    expect(highlightMarkdown([''])).toEqual([[]]);
    expect(highlightMarkdown([])).toEqual([]);
  });

  it('marks a whole heading line', () => {
    expect(line('# Tytuł')).toEqual([['# Tytuł', 'heading']]);
    expect(line('###### szósty poziom')).toEqual([['###### szósty poziom', 'heading']]);
    expect(line('##')).toEqual([['##', 'heading']]);
  });

  it('does not treat a hash without a space or seven hashes as a heading', () => {
    expect(line('#hashtag')).toEqual([['#hashtag', null]]);
    expect(line('####### siedem')).toEqual([['####### siedem', null]]);
  });

  it('marks list markers and task checkboxes', () => {
    expect(line('- krok')).toEqual([
      ['-', 'marker'],
      [' krok', null],
    ]);
    expect(line('  12. krok')).toEqual([
      ['  ', null],
      ['12.', 'marker'],
      [' krok', null],
    ]);
    expect(line('* [ ] do zrobienia')).toEqual([
      ['*', 'marker'],
      [' ', null],
      ['[ ]', 'marker'],
      [' do zrobienia', null],
    ]);
    expect(line('- [x] gotowe')[2]).toEqual(['[x]', 'marker']);
  });

  it('marks the quote prefix and keeps highlighting the quoted text', () => {
    expect(line('> zobacz `kod`')).toEqual([
      ['> ', 'quote'],
      ['zobacz ', null],
      ['`kod`', 'inline-code'],
    ]);
  });

  it('marks horizontal rules', () => {
    expect(kinds(['tekst', '---', '* * *', '___'])).toEqual([null, 'rule', 'rule', 'rule']);
  });

  it('marks fences and treats everything inside a code block as code', () => {
    expect(kinds(['```sh', '# nie nagłówek', '- nie lista', '', '```', '# nagłówek'])).toEqual([
      'fence',
      'code',
      'code',
      null,
      'fence',
      'heading',
    ]);
  });

  it('closes a fence only with the same character and at least the same length', () => {
    expect(kinds(['~~~', '```', 'kod', '~~~', 'tekst'])).toEqual(['fence', 'code', 'code', 'fence', null]);
    expect(kinds(['````', '```', '````', 'tekst'])).toEqual(['fence', 'code', 'fence', null]);
  });

  it('treats the rest of the file as code when a fence is never closed', () => {
    expect(kinds(['```', 'kod', '# dalej kod'])).toEqual(['fence', 'code', 'code']);
  });

  it('marks inline code, including double backticks', () => {
    expect(line('Uruchom `npm start` teraz')).toEqual([
      ['Uruchom ', null],
      ['`npm start`', 'inline-code'],
      [' teraz', null],
    ]);
    expect(line('``a ` b``')).toEqual([['``a ` b``', 'inline-code']]);
    expect(line('samotny ` znak')).toEqual([['samotny ` znak', null]]);
  });

  it('marks strong and emphasised text', () => {
    expect(line('**ważne** i *kursywa*')).toEqual([
      ['**ważne**', 'strong'],
      [' i ', null],
      ['*kursywa*', 'emphasis'],
    ]);
    expect(line('__mocne__ oraz _lekkie_')).toEqual([
      ['__mocne__', 'strong'],
      [' oraz ', null],
      ['_lekkie_', 'emphasis'],
    ]);
  });

  it('leaves underscores inside words and spaced asterisks alone', () => {
    expect(line('snake_case_name i a * b * c')).toEqual([['snake_case_name i a * b * c', null]]);
  });

  it('does not highlight characters escaped with a backslash', () => {
    expect(line('\\*nie kursywa\\* i \\`nie kod\\`')).toEqual([['\\*nie kursywa\\* i \\`nie kod\\`', null]]);
  });

  it('marks link text and link target separately, also for images', () => {
    expect(line('zobacz [opis](docs/a.md) tutaj')).toEqual([
      ['zobacz ', null],
      ['[opis]', 'link-text'],
      ['(docs/a.md)', 'link-url'],
      [' tutaj', null],
    ]);
    expect(line('![schemat](img/a.png "Tytuł")')).toEqual([
      ['![schemat]', 'link-text'],
      ['(img/a.png "Tytuł")', 'link-url'],
    ]);
    expect(line('<https://example.com>')).toEqual([['<https://example.com>', 'link-url']]);
  });

  it('marks tags such as <HARD-GATE> but not comparison signs', () => {
    expect(line('<HARD-GATE>')).toEqual([['<HARD-GATE>', 'tag']]);
    expect(line('koniec </HARD-GATE> tutaj')).toEqual([
      ['koniec ', null],
      ['</HARD-GATE>', 'tag'],
      [' tutaj', null],
    ]);
    expect(line('<div class="x">')).toEqual([['<div class="x">', 'tag']]);
    expect(line('a < b > c')).toEqual([['a < b > c', null]]);
  });

  it('marks frontmatter delimiters and keys and leaves the values plain', () => {
    const highlighted = highlightMarkdown([
      '---',
      'name: deploy',
      'description: Use *when*',
      '  deploying `things`',
      '---',
      '# Tytuł',
    ]);
    expect(highlighted.map(pairs)).toEqual([
      [['---', 'meta-delimiter']],
      [
        ['name:', 'meta-key'],
        [' deploy', null],
      ],
      [
        ['description:', 'meta-key'],
        [' Use *when*', null],
      ],
      [['  deploying `things`', null]],
      [['---', 'meta-delimiter']],
      [['# Tytuł', 'heading']],
    ]);
  });

  it('treats a leading --- as a rule when the frontmatter is never closed', () => {
    expect(highlightMarkdown(['---', 'name: deploy']).map(pairs)).toEqual([
      [['---', 'rule']],
      [['name: deploy', null]],
    ]);
  });
});
