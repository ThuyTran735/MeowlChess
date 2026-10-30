import { importPgn } from './pgn.js';

export const PGN_IMPORT_MAX_BYTES = 5 * 1024 * 1024;
export const PGN_IMPORT_MAX_GAMES = 100;
const GAME_MAX_BYTES = 250000;
const RESULTS = new Set(['1-0', '0-1', '1/2-1/2', '*']);
const encoder = new TextEncoder();

// A bracket in a quoted tag value is data, including after an escaped quote.
function readTag(text, start) {
  let quoted = false;
  let end = start + 1;
  for (; end < text.length; end++) {
    const char = text[end];
    if (quoted && char === '\\') { end++; continue; }
    if (char === '"') quoted = !quoted;
    else if (!quoted && char === ']') { end++; break; }
  }
  return { end, name: /^\[\s*([A-Za-z][A-Za-z0-9_]*)\s*"/.exec(text.slice(start, end))?.[1] };
}

function splitGames(text) {
  const games = [];
  let start = -1;
  let movetext = false;
  let finished = false;
  let variationDepth = 0;
  let headers = new Set();

  function finish(end) {
    if (start >= 0) {
      games.push(text.slice(start, end).trim());
      if (games.length > PGN_IMPORT_MAX_GAMES) throw new Error(`Import up to ${PGN_IMPORT_MAX_GAMES} games at a time. Split this collection into smaller files.`);
    }
    start = -1;
    movetext = false;
    finished = false;
    headers = new Set();
  }

  for (let at = 0; at < text.length;) {
    const char = text[at];
    if (/\s/.test(char)) { at++; continue; }
    if (char === '{') {
      const end = text.indexOf('}', at + 1);
      at = end < 0 ? text.length : end + 1;
      continue;
    }
    if (char === ';') {
      while (at < text.length && text[at] !== '\n' && text[at] !== '\r') at++;
      continue;
    }
    if (char === '[') {
      const tag = readTag(text, at);
      if (!variationDepth) {
        // A new header after moves also separates an unfinished prior game.
        // Repeated Event tags recover a header-only record in normal exports.
        if (movetext || (tag.name === 'Event' && headers.has('Event'))) finish(at);
        if (start < 0) start = at;
        if (tag.name) headers.add(tag.name);
      }
      at = tag.end;
      continue;
    }
    if (char === '(') {
      if (start < 0) start = at;
      movetext = true;
      variationDepth++;
      at++;
      continue;
    }
    if (char === ')') {
      if (start < 0) start = at;
      if (variationDepth) variationDepth--;
      else movetext = true;
      at++;
      continue;
    }

    let end = at + 1;
    while (end < text.length && !/[\s{};[\]()]/.test(text[end])) end++;
    if (!variationDepth) {
      // Delay the split until the next record, retaining trailing comments.
      if (finished) finish(at);
      if (start < 0) start = at;
      movetext = true;
      finished = RESULTS.has(text.slice(at, end));
    }
    at = end;
  }
  finish(text.length);
  return games;
}

function checkImportSize(texts) {
  let bytes = 0;
  for (const text of texts) {
    if (typeof text !== 'string') throw new Error('Choose PGN files containing text.');
    if (text.length > PGN_IMPORT_MAX_BYTES - bytes) throw new Error('Choose a PGN collection no larger than 5 MiB.');
    bytes += encoder.encode(text).byteLength;
    if (bytes > PGN_IMPORT_MAX_BYTES) throw new Error('Choose a PGN collection no larger than 5 MiB.');
  }
}

function importRecords(records) {
  const games = [];
  const rejected = [];
  records.forEach((pgn, index) => {
    try {
      if (!pgn) throw new Error('This file contains no games.');
      if (encoder.encode(pgn).byteLength > GAME_MAX_BYTES) throw new Error('This game exceeds the 250 KB PGN limit.');
      games.push(importPgn(pgn));
    } catch (error) {
      rejected.push({ index: index + 1, message: error instanceof Error ? error.message : 'This game could not be imported.' });
    }
  });
  return { games, rejected, total: records.length };
}

/** Import completed standard games, retaining per-record failures in source order. */
export function importPgnCollection(text) {
  if (typeof text !== 'string' || !text.trim()) throw new Error('Choose a PGN file or paste at least one completed game.');
  checkImportSize([text]);
  const records = splitGames(text);
  if (!records.length) throw new Error('Choose a PGN file or paste at least one completed game.');
  return importRecords(records);
}

/** Keep file boundaries so an incomplete record cannot consume the next file. */
export function importPgnFiles(texts) {
  if (!Array.isArray(texts) || !texts.length) throw new Error('Choose at least one PGN file.');
  checkImportSize(texts);
  const records = [];
  for (const text of texts) {
    const inFile = splitGames(text);
    // An empty file is one visible failure, with the same sequential indexing.
    records.push(...(inFile.length ? inFile : ['']));
    if (records.length > PGN_IMPORT_MAX_GAMES) throw new Error('Import up to 100 games at a time. Split this collection into smaller files.');
  }
  return importRecords(records);
}
