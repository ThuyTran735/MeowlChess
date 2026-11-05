import { Chess } from '../vendor/chess.js';
import { expectedScore } from './review.js';
import { classifyHighlight, sacrificeOffer } from './move-highlights.js';
import { createStudyLine, moveUci } from './study.js';
import { parseCompletedPgn } from './pgn.js';
import { explainConsequence } from './tactics.js';
import { createCoachText } from './coach-notation.js';

const DEFINITIONS = Object.freeze({
  Brilliant: 'A material offer that the saved engine evidence judges sound.',
  Great: 'A critical choice or a strong tactical response supported by saved alternatives and a continuation.',
  Best: "The played move matched the engine's first choice at the saved search depth.",
  Excellent: 'Less than 1 percentage point of estimated chance loss.',
  Good: 'At least 1 but less than 4 percentage points of estimated chance loss.',
  Book: 'A known opening continuation; Book moves are excluded from study scores.',
  Inaccuracy: 'At least 4 but less than 8 percentage points of estimated chance loss.',
  Mistake: 'At least 8 but less than 20 percentage points of estimated chance loss.',
  Blunder: 'At least 20 percentage points of estimated chance loss.',
});
const RESULTS = new Set(['1-0', '0-1', '1/2-1/2']);
const UCI = /^[a-h][1-8][a-h][1-8][qrbn]?$/;
const PIECES = { n: 'knight', b: 'bishop', r: 'rook', q: 'queen' };
const sideName = color => color === 'w' ? 'White' : 'Black';
const percentage = value => (value * 100).toFixed(1).replace(/\.0$/, '');
const ordinaryLabel = loss => loss < .01 ? 'Excellent' : loss < .04 ? 'Good' : loss < .08 ? 'Inaccuracy' : loss < .2 ? 'Mistake' : 'Blunder';
const validEvaluation = value => Number.isFinite(value?.cp) && (value.mate == null || Number.isInteger(value.mate)
  && (value.mate === 0 || Math.sign(value.mate) === Math.sign(value.cp)));
function lossDescription(loss) {
  const rounded = percentage(loss);
  // Rounding must not appear to move a loss into the next grade's range.
  return ordinaryLabel(Number(rounded) / 100) !== ordinaryLabel(loss) ? `just under ${rounded}` : loss ? `about ${rounded}` : '0';
}

// A completed legal game establishes both move identity and repetition history.
// Missing evaluation details may limit an explanation; a mismatched game cannot.
function contextFor(result, game, ply) {
  if (!Number.isInteger(ply) || ply < 1 || !RESULTS.has(result?.game?.headers?.Result)
    || !Array.isArray(result.moves) || !result.moves.length || result.moves.length > 1000 || ply > result.moves.length
    || !Array.isArray(result.game.positions) || result.game.positions.length !== result.moves.length + 1
    || !Array.isArray(result.positions) || result.positions.length !== result.game.positions.length) return null;
  try {
    const replay = new Chess(result.game.positions[0]);
    replay.setHeader('Result', result.game.headers.Result);
    for (let i = 0; i < result.moves.length; i++) {
      const move = result.moves[i];
      if (replay.isGameOver() || move?.ply !== i + 1 || move.before !== replay.fen() || move.before !== result.game.positions[i]) return null;
      const actual = replay.move({ from: move.from, to: move.to, promotion: move.promotion });
      if (actual.san !== move.san || actual.color !== move.color || actual.piece !== move.piece || actual.captured !== move.captured
        || actual.promotion !== move.promotion || move.after !== replay.fen() || move.after !== result.game.positions[i + 1]) return null;
    }
    const move = result.moves[ply - 1];
    if (!Object.hasOwn(DEFINITIONS, move.label)) return null;
    let pgn = replay.pgn();
    if (game?.pgn !== undefined) {
      const supplied = parseCompletedPgn(game.pgn);
      if (supplied.result !== result.game.headers.Result || supplied.parsed.positions.length !== result.game.positions.length
        || supplied.parsed.positions.some((fen, i) => fen !== result.game.positions[i])) return null;
      pgn = supplied.pgn;
    }
    return { result, move, pgn, ply };
  } catch { return null; }
}

function savedLine(context, basePly, evaluation, title, limit = 24) {
  if (!Array.isArray(evaluation?.pv) || !evaluation.pv.length || evaluation.pv.length > 256
    || evaluation.bestMove && evaluation.bestMove !== evaluation.pv[0]) return null;
  try {
    const study = createStudyLine(context.pgn, basePly, evaluation.pv.slice(0, limit));
    const moves = study.moves;
    study.goTo(moves.length);
    return { title, basePly, moves, positions: study.positions,
      truncated: study.truncated || evaluation.pv.length > limit,
      terminalReason: study.terminalReason };
  } catch { return null; }
}

function preferredMove(context, evaluation) {
  if (!UCI.test(evaluation?.bestMove || '')) return null;
  try { return createStudyLine(context.pgn, context.ply - 1, [evaluation.bestMove]).moves[0] || null; }
  catch { return null; }
}

/** Explain an existing saved grade; never regrade, search, or mutate the review.
 * Text has explicit SAN spans for renderCoachText; line moves retain SAN/color.
 * null means the selected move cannot be tied to a legal completed game.
 */
export function explainMoveRating({ result, game, ply } = {}) {
  const context = contextFor(result, game, ply);
  if (!context) return null;
  const { move } = context;
  const before = result.positions[ply - 1], after = result.positions[ply];
  const writer = createCoachText(), mention = item => writer.move(item.san, item.color);
  const title = writer.resolve(`${move.before.split(' ')[5]}${move.color === 'w' ? '.' : '...'} ${mention(move)} — ${move.label}`);
  const facts = [], addFact = text => facts.push(writer.resolve(text));
  let consequence = null;
  const addConsequence = text => { consequence = writer.resolve(text); facts.push(consequence); };
  const choice = preferredMove(context, before), sameChoice = choice?.uci === moveUci(move);
  const line = savedLine(context, ply, after, 'Saved continuation after this move');
  let reason = `This review saved the ${move.label} label, but the retained details are not enough to explain why this particular move earned it. A fresh review can rebuild the evidence.`;
  let evidence = 'limited';
  const scoresValid = validEvaluation(before) && validEvaluation(after);
  const prior = scoresValid ? expectedScore(before, move.color) : null;
  const next = scoresValid ? expectedScore(after, move.color) : null;
  const loss = scoresValid ? Math.max(0, prior - next) : null;
  const storedLossValid = move.probabilityLoss === undefined || Number.isFinite(move.probabilityLoss)
    && move.probabilityLoss >= 0 && move.probabilityLoss <= 1 && Math.abs(move.probabilityLoss - loss) < 1e-8;

  if (scoresValid && storedLossValid) {
    addFact(`${sideName(move.color)}'s estimated chances: ${percentage(prior)}% before → ${percentage(next)}% after; loss ${lossDescription(loss)} percentage points.`);
  }

  if (move.label === 'Book') {
    const savedBook = result.opening;
    if (move.isBook === true && Number.isInteger(savedBook?.lastBookPly) && ply <= savedBook.lastBookPly
      && scoresValid && storedLossValid && (sameChoice || loss < .04) && !move.san.endsWith('#')) {
      reason = `${mention(move)} follows a known continuation in the review's local opening reference, so it received Book and does not count toward the study score.`;
      if (typeof move.opening?.name === 'string' && move.opening.name.length <= 200) addFact(`Saved opening: ${move.opening.name}${/^[A-E]\d\d$/.test(move.opening.eco || '') ? ` (${move.opening.eco})` : ''}.`);
      evidence = 'verified';
    }
  } else if (move.label === 'Best' && sameChoice) {
    reason = `${mention(move)} was the saved engine's first choice. Matching that choice earns Best even when the separate before-and-after searches differ slightly.`;
    evidence = 'verified';
  } else if (['Brilliant', 'Great'].includes(move.label)) {
    const fullLine = savedLine(context, ply, after, 'Saved continuation after this move', 200);
    const previousMove = result.moves[ply - 2], previousEvaluation = result.positions[ply - 2];
    const supported = scoresValid && storedLossValid && fullLine && !fullLine.truncated && fullLine.moves.length
      && classifyHighlight(move, before, after, { previousMove, previousEvaluation }) === move.label;
    if (supported && move.label === 'Brilliant') {
      const offer = sacrificeOffer(move, { previousMove });
      const capture = offer && createStudyLine(context.pgn, ply, [offer.capture]).moves[0];
      if (capture) {
        reason = `${mention(move)} offers the ${PIECES[offer.piece]} on ${offer.square}: ${mention(capture)} can accept a net material investment of about ${offer.investment} pawns. The saved deeper evaluations keep enough compensation for Brilliant.`;
        if (fullLine.terminalReason === 'Checkmate' && fullLine.moves.at(-1)?.color === move.color && fullLine.moves[0].uci === offer.capture) {
          addFact('In the saved continuation, the opponent accepts the offer and the player who offered it delivers checkmate.');
        }
        evidence = 'verified';
      }
    } else if (supported) {
      const second = before.candidates[1], secondMove = preferredMove(context, second);
      const secondChance = expectedScore(second, move.color), gap = prior - secondChance;
      const criticalChoice = sameChoice && (prior >= .45 && secondChance < .4 && gap >= .1 || prior >= .5 && secondChance < .65 && gap >= .15);
      if (criticalChoice && secondMove) {
        reason = `${mention(move)} keeps much stronger chances than the next engine choice, ${mention(secondMove)}. That saved comparison makes this a critical choice and supports Great.`;
        addFact(`The top two choices were compared at depth ${before.depth}: ${percentage(prior)}% versus ${percentage(secondChance)}% estimated chances, a ${percentage(gap)}-point gap.`);
      } else {
        reason = `${mention(move)} takes advantage of the opponent's preceding error with a near-best continuation that gains material. The saved alternatives and checked continuation support Great.`;
        addFact(`The opponent's preceding move increased ${sideName(move.color)}'s estimated chances by ${percentage(prior - expectedScore(previousEvaluation, move.color))} percentage points; the checked continuation meets the material-gain test of at least 2 pawns.`);
      }
      evidence = 'verified';
    }
  } else if (scoresValid && storedLossValid && !sameChoice && ordinaryLabel(loss) === move.label) {
    reason = `${mention(move)} lost ${lossDescription(loss)} percentage points of estimated chances for ${sideName(move.color)}, putting it in this review's ${move.label} range.`;
    evidence = 'verified';
  }

  if (choice && move.label !== 'Best') addFact(`The saved engine preferred ${mention(choice)}${sameChoice ? ', the move played' : ''}.`);
  if (Number.isInteger(before?.depth) && before.depth > 0 && Number.isInteger(after?.depth) && after.depth > 0) addFact(`Saved search depths: ${before.depth} before the move and ${after.depth} after it.`);

  // Feed only the history-validated prefix to tactical wording. Repetition and
  // fifty-move endings must take precedence over a stale engine mate forecast.
  if (line?.terminalReason && line.terminalReason !== 'Checkmate') {
    addConsequence(`${line.moves.length ? 'The saved continuation reaches a draw' : 'This position is drawn'} by ${line.terminalReason.toLowerCase()}.`);
  } else if (line?.moves.length && scoresValid && storedLossValid) {
    const finding = explainConsequence(move, { ...after, pv: line.moves.map(item => item.uci) }, { formatMove: mention });
    if (['fork', 'material', 'mate'].includes(finding.type)) addConsequence(finding.text);
  } else if (move.san.endsWith('#')) {
    // The legal game itself proves a delivered mate without requiring a PV.
    const finding = explainConsequence(move, { ...after, pv: [] }, { formatMove: mention });
    if (finding.type === 'mate') addConsequence(finding.text);
  }
  const resolved = writer.resolve(reason);
  return {
    ply, label: move.label, color: move.color, san: move.san,
    title: title.text, titleNotation: title.notation, definition: DEFINITIONS[move.label],
    reason: resolved.text, reasonNotation: resolved.notation, facts, line: line?.moves.length ? line : null, evidence,
    ...(consequence ? { consequence } : {}),
    note: 'MeowlChess grades are local engine estimates. Estimated chances use an expected-score model, not a measured win probability; search depth can change the result.',
  };
}
