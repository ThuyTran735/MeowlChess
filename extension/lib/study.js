import { Chess } from '../vendor/chess.js';
import { parseCompletedPgn } from './pgn.js';

const UCI = /^[a-h][1-8][a-h][1-8][qrbn]?$/;
const squarePattern = /^[a-h][1-8]$/;
export const moveUci = move => `${move.from}${move.to}${move.promotion || ''}`;

function moveInput(value) {
  if (typeof value === 'string') {
    if (!UCI.test(value)) throw new Error('Choose a legal move on the board.');
    return { from: value.slice(0, 2), to: value.slice(2, 4), ...(value[4] ? { promotion: value[4] } : {}) };
  }
  if (!value || !squarePattern.test(value.from || '') || !squarePattern.test(value.to || '') || (value.promotion !== undefined && !/^[qrbn]$/.test(value.promotion))) throw new Error('Choose a legal move on the board.');
  return { from: value.from, to: value.to, ...(value.promotion ? { promotion: value.promotion } : {}) };
}

/** A variation is always rooted in a position from a validated completed game. */
class StudyLine {
  constructor(pgn, basePly, uciLine) {
    this._game = parseCompletedPgn(pgn).parsed;
    if (!Number.isInteger(basePly) || basePly < 0 || basePly >= this._game.positions.length) throw new Error('Choose a position from the completed game.');
    if (!Array.isArray(uciLine)) throw new Error('The suggested line must be a list of moves.');
    this._basePly = basePly;
    this._prefix = this._game.moves.slice(0, basePly).map(moveUci);
    this._chess = new Chess(this._game.positions[0]);
    for (const uci of this._prefix) this._chess.move(moveInput(uci));
    this._positions = [this._game.positions[basePly]];
    this._moves = [];
    this._cursor = 0;
    this.truncated = uciLine.length > 200;
    for (const uci of uciLine.slice(0, 200)) {
      try { this.play(uci); } catch { this.truncated = true; break; }
    }
    this.goTo(0);
  }
  get basePly() { return this._basePly; }
  get positions() { return [...this._positions]; }
  get moves() { return this._moves.map(move => ({ ...move })); }
  get cursor() { return this._cursor; }
  get fen() { return this._positions[this._cursor]; }
  get turn() { return this.fen.split(' ')[1]; }
  get initialFen() { return this._game.positions[0]; }
  get history() { return [...this._prefix, ...this._moves.slice(0, this._cursor).map(move => move.uci)]; }
  get terminal() { return this._chess.isGameOver(); }
  get terminalReason() {
    if (this._chess.isCheckmate()) return 'Checkmate';
    if (this._chess.isStalemate()) return 'Stalemate';
    if (this._chess.isThreefoldRepetition()) return 'Threefold repetition';
    if (this._chess.isDrawByFiftyMoves()) return 'Fifty-move rule';
    if (this._chess.isInsufficientMaterial()) return 'Insufficient material';
    return null;
  }
  get canBack() { return this._cursor > 0; }
  get canForward() { return this._cursor < this._moves.length; }
  legalMoves(square) {
    if (this.terminal || (square !== undefined && !squarePattern.test(square))) return [];
    return this._chess.moves({ verbose: true, ...(square ? { square } : {}) }).map(move => ({ ...move, uci: moveUci(move) }));
  }
  promotionChoices(from, to) { return this.legalMoves(from).filter(move => move.to === to && move.promotion).map(move => move.promotion); }
  play(value) {
    if (this.terminal) throw new Error(`This position is finished: ${this.terminalReason}. Return to an earlier position to explore another line.`);
    if (this._cursor >= 200) throw new Error('This study line is limited to 200 moves. Return to the game to start another line.');
    const input = moveInput(value);
    if (!input.promotion && this.promotionChoices(input.from, input.to).length) {
      const error = new Error('Choose a queen, rook, bishop, or knight for promotion.'); error.code = 'PROMOTION_REQUIRED'; throw error;
    }
    const board = this._chess;
    let move;
    try { move = board.move(input); } catch { throw new Error('That move is not legal in this position.'); }
    const entry = { ...move, uci: moveUci(move) };
    this._moves = this._moves.slice(0, this._cursor);
    this._positions = this._positions.slice(0, this._cursor + 1);
    this._moves.push(entry); this._positions.push(board.fen()); this._cursor++;
    return { ...entry };
  }
  goTo(cursor) {
    if (!Number.isInteger(cursor) || cursor < 0 || cursor > this._moves.length) throw new Error('Choose a position within this study line.');
    while (this._cursor > cursor) { this._chess.undo(); this._cursor--; }
    while (this._cursor < cursor) { this._chess.move(moveInput(this._moves[this._cursor].uci)); this._cursor++; }
    return this.fen;
  }
  back() { return this.goTo(Math.max(0, this._cursor - 1)); }
  forward() { return this.goTo(Math.min(this._moves.length, this._cursor + 1)); }
  reset() { return this.goTo(0); }
}

export function createStudyLine(pgn, basePly, uciLine = []) { return new StudyLine(pgn, basePly, uciLine); }
