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
      if (options.has('MultiPV')) commands.push('setoption name MultiPV value 1');
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

  async evaluate(fen, { moveTimeMs = 150, signal, moves = [], initialFen } = {}) {
    validateFen(fen);
    if (initialFen !== undefined) validateFen(initialFen);
    if (!Array.isArray(moves) || moves.some((move) => typeof move !== 'string' || !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(move))) {
      throw new Error('The engine received an invalid move history.');
    }
    if (moves.length && initialFen === undefined) throw new Error('Move history requires its starting position.');
    if (this.busy) throw new Error('Wait for the current position to finish analyzing.');
    this.busy = true;
    try {
      await this.init(signal);
      const time = Math.max(50, Math.min(5000, Math.round(Number(moveTimeMs) || 150)));
      const perspective = fen.split(/\s+/)[1] === 'w' ? 1 : -1;
      let evaluation = null;
      const position = initialFen === undefined ? `position fen ${fen}` : `position fen ${initialFen}${moves.length ? ` moves ${moves.join(' ')}` : ''}`;
      return await this._command([position, `go movetime ${time}`], (line) => {
        if (line.startsWith('info ') && !/\b(?:lowerbound|upperbound)\b/.test(line)) {
          const multipv = line.match(/\bmultipv (\d+)\b/);
          const score = line.match(/\bscore (cp|mate) (-?\d+)\b/);
          if (score && (!multipv || multipv[1] === '1')) {
            const raw = Number(score[2]);
            const mate = score[1] === 'mate' ? raw * perspective : null;
            evaluation = {
              cp: mate === null ? raw * perspective : Math.sign(mate) * Math.max(10000, 100000 - Math.abs(mate) * 100),
              mate,
              pv: line.match(/\bpv (.+)$/)?.[1].split(/\s+/).filter((move) => /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(move)) || [],
              depth: Number(line.match(/\bdepth (\d+)\b/)?.[1] || 0),
            };
          }
        }
        const best = line.match(/^bestmove (\S+)/);
        if (!best) return null;
        const bestMove = /^(?:\(none\)|0000)$/.test(best[1]) ? null : best[1];
        if (!evaluation && bestMove) throw new Error('The chess engine returned no evaluation. Try reviewing again.');
        return { done: true, value: { ...(evaluation || { cp: 0, mate: null, pv: [], depth: 0 }), bestMove } };
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
