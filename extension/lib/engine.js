const ENGINE_URL = new URL('../vendor/stockfish-18-lite-single.js', import.meta.url);

function abortError() {
  return new DOMException('Review cancelled.', 'AbortError');
}

function validateFen(fen) {
  if (typeof fen !== 'string' || /[\r\n]/.test(fen) || fen.trim().split(/\s+/).length !== 6 || !/^[wb]$/.test(fen.split(/\s+/)[1])) {
    throw new Error('The engine received an invalid chess position.');
  }
}

/** Local, single-threaded UCI engine. A separate instance belongs to each review. */
export class StockfishEngine {
  constructor({ workerFactory = (url) => new Worker(url), bootTimeoutMs = 15000 } = {}) {
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
      this.worker = this.workerFactory(ENGINE_URL);
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
    if (!Array.isArray(moves) || moves.some((move) => typeof move !== 'string' || !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(move))) {
      throw new Error('The engine received an invalid move history.');
    }
    if (moves.length && initialFen === undefined) throw new Error('Move history requires its starting position.');
    if (this.busy) throw new Error('Wait for the current position to finish analyzing.');
    this.busy = true;
    try {
      await this.init(signal);
      if (multiPV > 1 && !this.supportsMultiPV) throw new Error('This engine does not support multiple candidate moves.');
      if (multiPV !== this.multiPV) {
        await this._command([`setoption name MultiPV value ${multiPV}`, 'isready'],
          (line) => line === 'readyok' ? { done: true } : null, this.bootTimeoutMs, signal);
        this.multiPV = multiPV;
      }
      const time = Math.max(50, Math.min(5000, Math.round(Number(moveTimeMs) || 150)));
      const perspective = fen.split(/\s+/)[1] === 'w' ? 1 : -1;
      const iterations = new Map();
      let primary = null;
      const position = initialFen === undefined ? `position fen ${fen}` : `position fen ${initialFen}${moves.length ? ` moves ${moves.join(' ')}` : ''}`;
      return await this._command([position, `go movetime ${time}`], (line) => {
        if (line.startsWith('info ') && !/\b(?:lowerbound|upperbound)\b/.test(line)) {
          const rank = Number(line.match(/\bmultipv (\d+)\b/)?.[1] || 1);
          const score = line.match(/\bscore (cp|mate) (-?\d+)\b/);
          if (score && rank >= 1 && rank <= multiPV) {
            const raw = Number(score[2]);
            const mate = score[1] === 'mate' ? raw * perspective : null;
            const rawPv = line.match(/\bpv (.+)$/)?.[1].split(/\s+/) || [];
            const pv = rawPv.every((move) => /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(move)) ? rawPv : [];
            const evaluation = {
              rank,
              cp: mate === null ? raw * perspective : raw === 0 ? -100000 * perspective : Math.sign(mate) * Math.max(10000, 100000 - Math.abs(mate) * 100),
              mate,
              pv,
              depth: Number(line.match(/\bdepth (\d+)\b/)?.[1] || 0),
              bestMove: pv[0] || null,
            };
            if (rank === 1 && (!primary || evaluation.depth >= primary.depth)) primary = evaluation;
            if (!iterations.has(evaluation.depth)) iterations.set(evaluation.depth, new Map());
            iterations.get(evaluation.depth).set(rank, evaluation);
          }
        }
        const best = line.match(/^bestmove (\S+)/);
        if (!best) return null;
        const bestMove = /^(?:\(none\)|0000)$/.test(best[1]) ? null : best[1];
        if (bestMove && !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(bestMove)) throw new Error('The chess engine returned an invalid best move.');
        if (!primary && bestMove) throw new Error('The chess engine returned no evaluation. Try reviewing again.');

        // UCI may stop halfway through a deeper MultiPV iteration. Never mix
        // ranks from different depths or display a stale rank-one alternative.
        let candidates = [];
        for (const depth of [...iterations.keys()].sort((a, b) => b - a)) {
          const iteration = iterations.get(depth);
          if (!bestMove || iteration.get(1)?.bestMove !== bestMove) continue;
          const group = [];
          const seen = new Set();
          for (let rank = 1; rank <= multiPV; rank++) {
            const candidate = iteration.get(rank);
            if (!candidate?.bestMove || seen.has(candidate.bestMove)) break;
            group.push(candidate); seen.add(candidate.bestMove);
          }
          if (!candidates.length) candidates = group;
          if (group.length === multiPV) { candidates = group; break; }
        }
        if (bestMove && primary?.bestMove && !candidates.length) throw new Error('The chess engine returned inconsistent candidate moves. Try reviewing again.');
        const chosen = candidates[0] || primary || { cp: 0, mate: null, pv: [], depth: 0 };
        return { done: true, value: { cp: chosen.cp, mate: chosen.mate, pv: chosen.pv, depth: chosen.depth, bestMove, candidates } };
      }, time + 10000, signal);
    } finally {
      this.busy = false;
    }
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
