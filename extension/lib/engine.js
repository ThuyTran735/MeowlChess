const STOCKFISH_URL = new URL('../vendor/stockfish-18-lite-single.js', import.meta.url);
const LOZZA_URL = new URL('../vendor/lozza-9.js', import.meta.url);

export const ENGINE_OPTIONS = Object.freeze([
  Object.freeze({ id: 'stockfish', label: 'Stockfish 18', description: 'Stronger analysis · up to 3 lines', maxLines: 3 }),
  Object.freeze({ id: 'lozza', label: 'Lozza 9', description: 'Small JavaScript engine · best move only', maxLines: 1 }),
]);

function abortError() {
  return new DOMException('Review cancelled.', 'AbortError');
}

function validateFen(fen) {
  if (typeof fen !== 'string' || /[\r\n]/.test(fen) || fen.trim().split(/\s+/).length !== 6 || !/^[wb]$/.test(fen.split(/\s+/)[1])) {
    throw new Error('The engine received an invalid chess position.');
  }
}

/** Local, single-threaded UCI engine. A separate instance belongs to each review. */
class LocalUciEngine {
  constructor({ workerFactory = (url) => new Worker(url), bootTimeoutMs = 15000 } = {}, { url, maxLines }) {
    this.engineUrl = url;
    this.maxLines = maxLines;
    this.workerFactory = workerFactory;
    this.bootTimeoutMs = bootTimeoutMs;
    this.worker = null;
    this.pending = null;
    this.initialized = false;
    this.initPromise = null;
    this.disposed = false;
    this.busy = false;
    this.supportsMultiPV = false;
    this.multiPV = 1;
  }

  async init(signal) {
    if (signal?.aborted) throw abortError();
    if (this.disposed) throw new Error('The chess engine has been stopped. Start a new review.');
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;
    this.initPromise = this._initialize(signal);
    return this.initPromise;
  }

  async _initialize(signal) {
    try {
      this.worker = this.workerFactory(this.engineUrl);
      this.worker.onmessage = ({ data }) => {
        if (typeof data !== 'string') return;
        for (const line of data.split(/\r?\n/)) {
          this.pending?.onLine(line.trim());
        }
      };
      this.worker.onerror = (event) => {
        event.preventDefault?.();
        this._fail(new Error('The local chess engine could not run. Reload the extension and try again.'));
      };
      this.worker.onmessageerror = () => this._fail(new Error('The chess engine returned an unreadable message.'));
      const options = new Set();
      await this._command(['uci'], (line) => {
        const option = line.match(/^option name (.+?) type /);
        if (option) options.add(option[1]);
        return line === 'uciok' ? { done: true } : null;
      }, this.bootTimeoutMs, signal);
      const commands = [];
      if (options.has('Threads')) commands.push('setoption name Threads value 1');
      if (options.has('Hash')) commands.push('setoption name Hash value 32');
      this.supportsMultiPV = options.has('MultiPV');
      if (this.supportsMultiPV) commands.push('setoption name MultiPV value 1');
      commands.push('ucinewgame', 'isready');
      await this._command(commands, (line) => line === 'readyok' ? { done: true } : null, this.bootTimeoutMs, signal);
      this.initialized = true;
    } catch (error) {
      this._fail(error);
      throw error;
    }
  }

  _command(commands, inspect, timeoutMs, signal) {
    if (signal?.aborted) {
      this.dispose();
      return Promise.reject(abortError());
    }
    if (this.disposed) return Promise.reject(new Error('The chess engine has been stopped.'));
    if (this.pending) return Promise.reject(new Error('The chess engine is already processing a command.'));
    return new Promise((resolve, reject) => {
      let timeout;
      const finish = (error, value) => {
        if (this.pending !== pending) return;
        clearTimeout(timeout);
        signal?.removeEventListener('abort', onAbort);
        this.pending = null;
        if (error) reject(error);
        else resolve(value);
      };
      const pending = {
        reject: (error) => finish(error),
        onLine: (line) => {
          try {
            const result = inspect(line);
            if (result?.done) finish(null, result.value);
          } catch (error) {
            this._fail(error);
          }
        },
      };
      const onAbort = () => this._fail(abortError());
      this.pending = pending;
      signal?.addEventListener('abort', onAbort, { once: true });
      timeout = setTimeout(() => this._fail(new Error('The chess engine took too long to respond. Start a new review.')), timeoutMs);
      try {
        for (const command of commands) this.worker.postMessage(command);
      } catch (error) {
        this._fail(error);
      }
    });
  }

  async evaluate(fen, { moveTimeMs = 150, multiPV = 1, signal, moves = [], initialFen } = {}) {
    validateFen(fen);
    if (initialFen !== undefined) validateFen(initialFen);
    if (!Number.isInteger(multiPV) || multiPV < 1 || multiPV > 3) {
      throw new Error('Choose between one and three engine lines.');
    }
    // Lozza is offered as a one-line engine. Do not invent extra alternatives.
    multiPV = Math.min(multiPV, this.maxLines);
    if (!Array.isArray(moves) || moves.some((move) => typeof move !== 'string' || !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(move))) {
      throw new Error('The engine received an invalid move history.');
    }
    if (moves.length && initialFen === undefined) throw new Error('Move history requires its starting position.');
    if (this.busy) throw new Error('Wait for the current position to finish analyzing.');
    this.busy = true;
    try {
      await this.init(signal);
      if (multiPV > 1 && !this.supportsMultiPV) throw new Error('This engine does not support multiple candidate moves.');
      const time = Math.max(50, Math.min(5000, Math.round(Number(moveTimeMs) || 150)));
      const perspective = fen.split(/\s+/)[1] === 'w' ? 1 : -1;
      const position = initialFen === undefined ? `position fen ${fen}` : `position fen ${initialFen}${moves.length ? ` moves ${moves.join(' ')}` : ''}`;
      for (let attempt = 0; attempt < 2; attempt++) {
        const lines = attempt === 0 ? multiPV : 1;
        if (lines !== this.multiPV) {
          await this._command([`setoption name MultiPV value ${lines}`, 'isready'],
            (line) => line === 'readyok' ? { done: true } : null, this.bootTimeoutMs, signal);
          this.multiPV = lines;
        }
        const result = await this._search(position, {
          time: attempt === 0 ? time : Math.max(500, time), multiPV: lines, perspective, signal,
        });
        if (result) return result;
        // A timed search can stop before its final move has an exact score.
        // Re-search this same position once, with its full history and one line.
      }
      const error = new Error('The chess engine returned no evaluation for its chosen move after a second search. Try a different engine or more thinking time.');
      this._fail(error);
      throw error;
    } finally {
      this.busy = false;
    }
  }

  _search(position, { time, multiPV, perspective, signal }) {
    const reports = [];
    const observations = new Map();
    let report = new Map();
    let terminalScore = null;
    const finishReport = () => {
      const first = report.get(1), group = [], seen = new Set();
      if (!first?.bestMove) return;
      for (let rank = 1; rank <= multiPV; rank++) {
        const candidate = report.get(rank);
        if (!candidate?.bestMove || candidate.depth !== first.depth || seen.has(candidate.bestMove)) break;
        group.push(candidate); seen.add(candidate.bestMove);
      }
      if (group.length) reports.push(group);
    };
    return this._command([position, `go movetime ${time}`], (line) => {
      if (line.startsWith('info ')) {
        const rank = Number(line.match(/\bmultipv (\d+)\b/)?.[1] || 1);
        const score = line.match(/\bscore (cp|mate) (-?\d+)\b/);
        if (rank === 1 && (score || /\bpv\b/.test(line))) {
          // Repeated depths are separate reports. Even a bound or malformed
          // primary starts a new report: its alternatives cannot reuse old ranks.
          finishReport(); report = new Map();
        } else if (score && report.has(rank)) {
          // A repeated secondary rank is a separate update, not a replacement
          // that can erase a completed report or borrow its other alternatives.
          finishReport(); report = new Map();
        }
        if (score && rank >= 1 && rank <= multiPV && !/\b(?:lowerbound|upperbound)\b/.test(line)) {
          const raw = Number(score[2]);
          const mate = score[1] === 'mate' ? raw * perspective : null;
          const rawPv = line.match(/\bpv (.+)$/)?.[1].split(/\s+/) || [];
          const validPv = rawPv.every(move => /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(move));
          const pv = validPv ? rawPv : [];
          const evaluation = {
            rank,
            cp: mate === null ? (raw * perspective || 0) : raw === 0 ? -100000 * perspective : Math.sign(mate) * Math.max(10000, 100000 - Math.abs(mate) * 100),
            mate, pv,
            depth: Number(line.match(/\bdepth (\d+)\b/)?.[1] || 0),
            bestMove: pv[0] || null,
          };
          report.set(rank, evaluation);
          if (evaluation.bestMove) {
            const previous = observations.get(evaluation.bestMove);
            if (!previous || evaluation.depth >= previous.depth) observations.set(evaluation.bestMove, evaluation);
          } else if (rank === 1 && !rawPv.length && (mate === 0 || (mate === null && raw === 0))) terminalScore = evaluation;
        } else if (score && rank >= 1 && rank <= multiPV) report.delete(rank);
      }
      const best = line.match(/^bestmove (\S+)/);
      if (!best) return null;
      const bestMove = /^(?:\(none\)|0000)$/.test(best[1]) ? null : best[1];
      if (bestMove && !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(bestMove)) throw new Error('The chess engine returned an invalid best move.');
      finishReport();
      if (!bestMove) return { done: true, value: terminalScore ? { cp: terminalScore.cp, mate: terminalScore.mate, pv: [], depth: terminalScore.depth, bestMove: null, candidates: [] } : null };

      // Prefer the most recent complete, same-depth report for the final move.
      // Stockfish can promote a previously secondary move when a search stops.
      // In that case retain only that move's own exact score and continuation.
      const matching = reports.filter(group => group[0].bestMove === bestMove).reverse().sort((a, b) => b[0].depth - a[0].depth);
      let candidates = matching.find(group => group.length === multiPV) || matching[0];
      if (!candidates) {
        const observation = observations.get(bestMove);
        if (observation) candidates = [{ ...observation, rank: 1 }];
      }
      const chosen = candidates?.[0];
      return { done: true, value: chosen ? { cp: chosen.cp, mate: chosen.mate, pv: chosen.pv, depth: chosen.depth, bestMove, candidates } : null };
    }, time + 10000, signal);
  }

  _fail(error) {
    this.pending?.reject(error);
    this.disposed = true;
    this.initialized = false;
    this.worker?.terminate();
    this.worker = null;
  }

  dispose() {
    this._fail(abortError());
  }
}

export class StockfishEngine extends LocalUciEngine {
  constructor(options = {}) {
    super(options, { url: STOCKFISH_URL, maxLines: 3 });
  }
}

export class LozzaEngine extends LocalUciEngine {
  constructor(options = {}) {
    super(options, { url: LOZZA_URL, maxLines: 1 });
  }
}

export function createEngine(engineId = 'stockfish', options = {}) {
  if (engineId === 'stockfish') return new StockfishEngine(options);
  if (engineId === 'lozza') return new LozzaEngine(options);
  throw new Error('Choose an available local chess engine.');
}
