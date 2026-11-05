import { Chess } from '../vendor/chess.js';
import { explainConsequence } from './tactics.js';
import { createStudyLine } from './study.js';
import { parseCompletedPgn } from './pgn.js';
import { getPhasePerformance } from './game-performance.js';
import { recognizeOpening } from './openings.js';
import { createCoachText } from './coach-notation.js';
import { normalizeCoachPerspective, resolveCoachFocus } from './coach-focus.js';

import { COACHES, coachResponseText, coachStudyStep, coachMoveLead, coachMoveTask, coachTopicStep } from './coach-personalities.js';
export { COACHES } from './coach-personalities.js';

const RESULTS = new Set(['1-0', '0-1', '1/2-1/2']);
const LABELS = new Set(['Brilliant', 'Great', 'Best', 'Excellent', 'Good', 'Book', 'Inaccuracy', 'Mistake', 'Blunder']);
const ERRORS = new Set(['Inaccuracy', 'Mistake', 'Blunder']);
const UCI = /^[a-h][1-8][a-h][1-8][qrbn]?$/;
const MAX_QUESTION = 600;
const sideName = color => color === 'w' ? 'White' : 'Black';
const moveLabel = (context, move) => `${move.before.split(' ')[5]}${move.color === 'w' ? '.' : '...'} ${context.notation.move(move.san, move.color)}`;
const action = (context, move) => ({ ply: move.ply, label: moveLabel(context, move) });
const cleanSan = value => value.replace(/[+#?!]/g, '').replace(/0/g, 'O').toLowerCase();
const defaults = ['Summarize this game', 'What was the biggest mistake?', 'What should I practice?'];

// Resolve only registered move references, after personality wording/numbering.
// Public text stays ordinary SAN; the view gets exact spans with each mover's color.
function finishAnswer(answer, notation) {
  if (!answer) return answer;
  const resolved = { ...answer, ...notation.resolve(answer.text) };
  if (typeof answer.heading === 'string') {
    const heading = notation.resolve(answer.heading);
    resolved.heading = heading.text; resolved.headingNotation = heading.notation;
  }
  if (typeof answer.suggestion === 'string') {
    const suggestion = notation.resolve(answer.suggestion);
    resolved.suggestion = suggestion.text; resolved.suggestionNotation = suggestion.notation;
  }
  if (Array.isArray(answer.suggestions)) {
    const suggestions = answer.suggestions.map(value => notation.resolve(value));
    resolved.suggestions = suggestions.map(value => value.text);
    resolved.suggestionsNotation = suggestions.map(value => value.notation);
  }
  const resolveAction = item => {
    const label = notation.resolve(item.label);
    return { ...item, label: label.text, notation: label.notation };
  };
  if (Array.isArray(answer.moves)) resolved.moves = answer.moves.map(resolveAction);
  if (answer.nextMoment) resolved.nextMoment = resolveAction(answer.nextMoment);
  return resolved;
}

function response(text, { moves = [], suggestions = defaults, subjectPly, label, labels, counts, matchCount, coach = 'meowl', kind = '' } = {}) {
  return {
    text: coachResponseText(text, { coach, kind, ply: subjectPly, label }), moves: moves.slice(0, 4), suggestions: suggestions.slice(0, 3),
    ...(Number.isInteger(subjectPly) ? { subjectPly, ...(LABELS.has(label) ? { label } : {}) } : {}),
    ...(Array.isArray(labels) ? { labels: labels.filter(value => LABELS.has(value)) } : {}),
    ...(counts ? { counts } : {}), ...(Number.isInteger(matchCount) ? { matchCount } : {}),
  };
}

// Work only from a full, legal completed review. Never interpret question text as PGN or commands.
function contextFor(result, game) {
  if (!RESULTS.has(result?.game?.headers?.Result) || !Array.isArray(result.moves) || !result.moves.length || result.moves.length > 1000
    || !Array.isArray(result.positions) || result.positions.length !== result.moves.length + 1
    || !Array.isArray(result.game.positions) || result.game.positions.length !== result.positions.length) return null;
  try {
    const replay = new Chess(result.game.positions[0]);
    replay.setHeader('Result', result.game.headers.Result);
    for (let i = 0; i < result.moves.length; i++) {
      const move = result.moves[i], evaluation = result.positions[i];
      if (move?.ply !== i + 1 || !LABELS.has(move.label) || !Number.isFinite(move.probabilityLoss) || move.probabilityLoss < 0 || move.probabilityLoss > 1
        || move.before !== replay.fen() || move.before !== result.game.positions[i] || !Number.isFinite(evaluation?.cp)) return null;
      const actual = replay.move({ from: move.from, to: move.to, promotion: move.promotion });
      if (actual.color !== move.color || actual.san !== move.san || move.after !== replay.fen() || move.after !== result.game.positions[i + 1]) return null;
    }
    if (!Number.isFinite(result.positions.at(-1)?.cp)) return null;
    let pgn = replay.pgn();
    if (typeof game?.pgn === 'string') {
      const supplied = parseCompletedPgn(game.pgn);
      if (supplied.result !== result.game.headers.Result || supplied.parsed.positions.some((fen, i) => result.game.positions[i] !== fen)
        || supplied.parsed.positions.length !== result.game.positions.length) return null;
      pgn = supplied.pgn;
    }
    return { result, game, pgn, replay };
  } catch { return null; }
}

const personalQuestion = question => /\b(my|mine|i)\b/i.test(question);
const opponentQuestion = question => /\b(opponent|their)\b/i.test(question);

function selectedSide(question, perspective, playerSide) {
  const white = /\bwhite\b/i.test(question), black = /\bblack\b/i.test(question);
  if (white !== black) return white ? 'w' : 'b';
  if (white && black) return 'both';
  if (/\b(both|each player|both players)\b/i.test(question)) return 'both';
  if (playerSide !== undefined) {
    if (opponentQuestion(question)) return ['w', 'b'].includes(playerSide) ? playerSide === 'w' ? 'b' : 'w' : null;
    if (personalQuestion(question)) return ['w', 'b'].includes(playerSide) ? playerSide : null;
  } else if (opponentQuestion(question) && ['w', 'b'].includes(perspective)) return perspective === 'w' ? 'b' : 'w';
  if (perspective === null) return null;
  return ['w', 'b'].includes(perspective) ? perspective : 'both';
}

function locateMove(question, context, ply, previousPly, perspective) {
  const moves = context.result.moves;
  // A number is a move reference only after "move" or alongside chess move punctuation.
  const reference = /\bmove\s+(\d{1,4})(\.{1,3}|…)?\s*|\b(\d{1,4})(\.{1,3}|…)\s*/i.exec(question);
  let candidates = moves, explicit = false;
  let tail = question;
  if (reference) {
    explicit = true;
    const number = Number(reference[1] || reference[3]), dots = reference[2] || reference[4] || '';
    candidates = moves.filter(move => Number(move.before.split(' ')[5]) === number);
    if (dots === '...' || dots === '…') candidates = candidates.filter(move => move.color === 'b');
    else if (dots === '.') candidates = candidates.filter(move => move.color === 'w');
    tail = question.slice(reference.index + reference[0].length);
  }
  // SAN is bounded to an entire word; ordinary prose must not accidentally select a move.
  const san = /(?:^|\s)([KQRBN][a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?[+#]?|[a-h](?:x[a-h])?[1-8](?:=[QRBN])?[+#]?|[O0]-[O0](?:-[O0])?)(?=$|\s|[?!,;.])/gi.exec(tail);
  if (san) { explicit = true; candidates = candidates.filter(move => cleanSan(move.san) === cleanSan(san[1])); }
  const namedSide = /\bwhite\b/i.test(question) !== /\bblack\b/i.test(question) ? /\bwhite\b/i.test(question) ? 'w' : 'b' : null;
  if (explicit && namedSide) candidates = candidates.filter(move => move.color === namedSide);
  if (explicit && candidates.length > 1 && ['w', 'b'].includes(perspective)) candidates = candidates.filter(move => move.color === perspective);
  if (explicit) {
    if (candidates.length === 1) return { move: candidates[0], explicit: true };
    return { error: candidates.length ? 'That move reference matches more than one position. Choose a move below, or include its number and side, such as “12...Nf6”.' : 'I could not find that move in this reviewed game. Use the move number and side shown in its move list.', moves: candidates.slice(0, 4).map(move => action(context, move)) };
  }
  const followup = /\b(that|it|instead|there)\b/i.test(question) && Number.isInteger(previousPly) && previousPly > 0 && previousPly <= moves.length;
  const selected = followup ? previousPly : ply;
  return { move: moves[selected - 1] || null, explicit: false };
}

function evidenceFor(context, move) {
  const evaluation = context.result.positions[move.ply];
  try {
    const pv = Array.isArray(evaluation?.pv) ? evaluation.pv.slice(0, 24) : [];
    const line = context.lineAt ? context.lineAt(move.ply, pv) : createStudyLine(context.pgn, move.ply, pv);
    line.goTo?.(line.moves.length);
    if (line.terminal && line.terminalReason !== 'Checkmate') {
      return `${line.moves.length ? 'In the shown continuation, the position is drawn' : 'This position is drawn'} by ${line.terminalReason.toLowerCase()}.`;
    }
    const evidence = explainConsequence(move, { ...evaluation, pv: line.moves.map(item => item.uci) }, {
      formatMove: item => context.notation.move(item.san, item.color),
    });
    if (evidence.type === 'unavailable') return 'There is no verified continuation to explain the consequence yet. A deeper review may help.';
    if (context.brief && evidence.type === 'material') {
      const amount = Number.isInteger(evidence.materialLoss) ? evidence.materialLoss : evidence.materialLoss.toFixed(1);
      return `In the saved line, ${sideName(move.color)} loses about ${amount} pawn${evidence.materialLoss === 1 ? '' : 's'} of net material from the position after this move.`;
    }
    if (context.brief && evidence.type === 'line') {
      return `Saved reply: ${context.notation.move(line.moves[0].san, line.moves[0].color)}. No lasting material gain or forced mate is verified in this line.`;
    }
    return evidence.text;
  } catch { return 'There is no verified continuation to explain the consequence yet.'; }
}

function legalSuggestion(context, basePly) {
  const evaluation = context.result.positions[basePly];
  if (!UCI.test(evaluation?.bestMove || '')) return null;
  try {
    const pv = Array.isArray(evaluation.pv) && evaluation.pv[0] === evaluation.bestMove ? evaluation.pv.slice(0, 8) : [evaluation.bestMove];
    const line = context.lineAt ? context.lineAt(basePly, pv) : createStudyLine(context.pgn, basePly, pv);
    if (!line.moves.length || line.moves[0].uci !== evaluation.bestMove) return null;
    // Brief excerpts end at a complete legal move. Never slice notation or evidence text.
    const moves = context.brief ? line.moves.slice(0, 2) : line.moves;
    return { san: context.notation.move(moves[0].san, moves[0].color), uci: evaluation.bestMove, moveCount: moves.length, line: moves.map((move, i) => `${move.color === 'w' || !i ? `${move.before.split(' ')[5]}${move.color === 'w' ? '.' : '...'} ` : ''}${context.notation.move(move.san, move.color)}`).join(' '), truncated: line.truncated };
  } catch { return null; }
}

function moveVoiceDetails(context, move, suggestion) {
  return {
    ply: move.ply, label: move.label,
    ending: move.ply === context.result.moves.length || move.san.endsWith('#'),
    inCheck: move.san.endsWith('+'), promotion: !!move.promotion, capture: !!move.captured, castle: /^O-O/.test(move.san),
    hasLine: !!suggestion, hasReply: suggestion?.moveCount > 1,
    alternative: !!suggestion && suggestion.uci !== `${move.from}${move.to}${move.promotion || ''}`,
  };
}

function moveAnswer(context, move, coach, better = false) {
  const suggestion = legalSuggestion(context, move.ply - 1);
  const same = suggestion?.uci === `${move.from}${move.to}${move.promotion || ''}`;
  const grade = `${moveLabel(context, move)} is rated ${move.label} in this review.`;
  const loss = move.label === 'Book' ? 'It follows the local opening reference; Book moves are excluded from the study score.'
    : move.probabilityLoss >= 0.01 ? `The estimated expected-score loss is about ${Math.round(move.probabilityLoss * 100)} percentage points.`
    : 'The recorded loss of estimated chances is less than one percentage point.';
  let text = context.brief ? `${grade} ${loss}` : `${grade} ${LABEL_DEFINITIONS[move.label]} ${loss}`;
  if (suggestion) text += `\n\n${same ? 'The engine preferred the move played' : `The engine preferred ${suggestion.san}`} at this search time. ${context.brief ? 'Line starts' : 'Suggested line'}: ${suggestion.line}.${suggestion.truncated ? ' Only the legal part of the line is shown.' : ''}`;
  else text += '\n\nNo legal preferred move is available in the saved analysis. Try a deeper review.';
  if (!better || !same) text += `\n\nAfter the played move: ${evidenceFor(context, move)}`;
  if (!context.brief) text += `\n\n${coachMoveTask(coach, moveVoiceDetails(context, move, suggestion))}`;
  return response(text, { coach, kind: 'move', moves: [action(context, move)], subjectPly: move.ply, label: move.label, suggestions: [`Why was ${moveLabel(context, move)} rated ${move.label}?`, 'What should I practice?', 'Summarize this game'] });
}

const LABEL_ALIASES = [
  ['Brilliant', /\bbrilliants?\b/i], ['Great', /\bgreats?\b/i], ['Best', /\bbests?\b/i],
  ['Excellent', /\bexcellents?\b/i], ['Good', /\bgoods?\b/i], ['Book', /\bbooks?\b/i],
  ['Inaccuracy', /\binaccurac(?:y|ies)\b/i], ['Mistake', /\bmistakes?\b/i], ['Blunder', /\bblunders?\b/i],
];
const LABEL_DEFINITIONS = Object.freeze({
  Brilliant: 'A sound sacrifice identified in the saved engine line.',
  Great: 'A critical choice or a tactical opportunity confirmed by the engine.',
  Best: 'The engine’s first choice at the saved search time.',
  Excellent: 'A move with almost no estimated loss of chances.',
  Good: 'A reasonable move with a small estimated loss of chances.',
  Book: 'A move in the local opening reference without a detected tactical error; excluded from the study score.',
  Inaccuracy: 'A small missed opportunity in the saved analysis.',
  Mistake: 'A significant estimated loss of chances.',
  Blunder: 'A large estimated loss of chances.',
});
const HIGHLIGHT_ORDER = ['Brilliant', 'Great', 'Best', 'Excellent', 'Good'];

function highlights(context, side, starsOnly = false) {
  return context.result.moves.filter(move => (side === 'both' || side === move.color)
    && (starsOnly ? ['Brilliant', 'Great'].includes(move.label) : HIGHLIGHT_ORDER.includes(move.label)))
    .sort((a, b) => HIGHLIGHT_ORDER.indexOf(a.label) - HIGHLIGHT_ORDER.indexOf(b.label)
      || a.probabilityLoss - b.probabilityLoss || a.ply - b.ply);
}

/** Search actual saved categories separately from explaining the current position. */
function categoryAnswer(context, question, side, coach, found, ply) {
  let labels = LABEL_ALIASES.filter(([, pattern]) => pattern.test(question)).map(([label]) => label);
  const current = found.explicit || /\b(?:this|that)\b(?!\s+(?:game|review)\b)|\b(?:it|here|instead|current|selected)\b|\bwhy\b/i.test(question);
  if (current) return null;
  const countRequest = /\b(?:how many|count|counts|number of|total)\b/i.test(question);
  const allCategories = (countRequest && /\b(?:each|all|ratings?|labels?|categories|move types?)\b/i.test(question))
    || /\b(?:rating|label|move)\s+breakdown\b/i.test(question)
    || /\b(?:show|list)\b.*\ball (?:move )?(?:ratings?|labels?|categories)\b/i.test(question);
  const definitions = /\b(?:meaning|means?|define|definition|difference|counts? as)\b/i.test(question)
    || (!/\b(?:my|mine|white|black|opponent)\b/i.test(question) && /^(?:what (?:is|are)|what's|explain)\s+(?:a |an )?(?:brilliants?|greats?|excellents?|goods?|books?|inaccurac(?:y|ies)|mistakes?|blunders?)(?:\s+(?:moves?|ratings?|labels?))?[?!.]*$/i.test(question))
    || /\bexplain\b.*\b(?:rating|label|category)\b/i.test(question);
  if (definitions && (labels.length || /\b(?:ratings|labels|categories)\b/i.test(question))) {
    if (!labels.length) labels = [...LABELS];
    return response(`${labels.map(label => `${label}: ${LABEL_DEFINITIONS[label]}`).join('\n')}\n\nThese are MeowlChess’s review labels. A deeper search can change them.`, { coach, kind: 'catalog', labels, suggestions: ['Show Brilliant moves', 'Show Great moves', 'How many of each rating?'] });
  }
  const bareLabels = labels.length && LABEL_ALIASES.reduce((text, [, pattern]) => text.replace(new RegExp(pattern.source, 'gi'), ''), question)
    .replace(/\b(?:moves?|and|or)\b/gi, '').replace(/[\s?!.,/]+/g, '') === '';
  const exactBest = labels.includes('Best') && (countRequest || bareLabels
    || /\b(?:rated|labeled|labelled|classified|category|rating)\b.*\bbest\b|\bbest\b.*\b(?:label|rating|category)\b/i.test(question));
  const genericHighlights = /\b(?:highlights?|strongest|standouts?)\b/i.test(question)
    || (labels.includes('Best') && !exactBest && /\bbest moves?\b/i.test(question));
  if (genericHighlights) {
    const matches = highlights(context, side);
    if (!matches.length) return response(`There are no moves rated Brilliant, Great, Best, Excellent, or Good${side === 'both' ? '' : ` for ${sideName(side)}`} in this review.`, { coach, kind: 'catalog', matchCount: 0, labels: HIGHLIGHT_ORDER });
    const singular = /\b(?:best|strongest) move\b/i.test(question) && !/\bmoves\b/i.test(question);
    const shown = matches.slice(0, singular ? 1 : 4), first = shown[0];
    return response(`Strong reviewed ${singular ? 'moment' : 'moments'}${side === 'both' ? '' : ` for ${sideName(side)}`}: ${shown.map(move => `${moveLabel(context, move)} (${move.label})`).join(', ')}.\n\nBrilliant and Great are shown before other strong grades. This selection uses the saved labels; it does not establish a uniquely decisive move.`, {
      coach, kind: 'catalog', moves: shown.map(move => action(context, move)), subjectPly: first.ply, label: first.label, labels: [...new Set(shown.map(move => move.label))], matchCount: matches.length,
      suggestions: [`Why was ${moveLabel(context, first)} rated ${first.label}?`, 'Show moves rated Best', 'Show Brilliant moves'],
    });
  }
  if (allCategories) labels = [...LABELS];
  if (!labels.length || (!allCategories && !bareLabels && !/\b(?:show|list|find|which|where|how many|count|counts|any|have|had|made|played|did|were|got|get|next|previous|first|last)\b/i.test(question))) return null;
  const matches = context.result.moves.filter(move => (side === 'both' || side === move.color) && labels.includes(move.label));
  const counts = Object.fromEntries(labels.map(label => [label, matches.filter(move => move.label === label).length]));
  const scope = side === 'both' ? 'Both players together' : sideName(side);
  const heading = labels.length === 1 ? `${scope} ${side === 'both' ? 'have' : 'has'} ${matches.length} ${matches.length === 1 ? 'move' : 'moves'} rated ${labels[0]} in this review.`
    : `Move ratings for ${side === 'both' ? 'both players' : sideName(side)} in this review:\n${labels.map(label => `${label}: ${counts[label]}`).join('\n')}`;
  let selected = matches;
  const direction = /\b(next|previous|first|last)\b/i.exec(question)?.[1]?.toLowerCase();
  if (direction === 'next') selected = matches.filter(move => move.ply > ply).slice(0, 1);
  else if (direction === 'previous') selected = matches.filter(move => move.ply < ply).slice(-1);
  else if (direction === 'last') selected = matches.slice(-1);
  else if (direction === 'first') selected = matches.slice(0, 1);
  const shown = selected.slice(0, 4), first = shown[0];
  const listing = shown.length ? `\n\n${shown.map(move => `${moveLabel(context, move)} (${sideName(move.color)} · ${move.label})`).join(', ')}.${selected.length > 4 ? ` Showing the first 4 of ${selected.length} matches.` : ''}`
    : direction && matches.length ? `\n\nThere is no ${direction === 'next' ? 'later' : 'earlier'} matching move from the current position.` : '\n\nNo matching moves were recorded. A deeper review can change the labels.';
  return response(heading + listing, {
    coach, kind: 'catalog', labels, counts, matchCount: matches.length, moves: shown.map(move => action(context, move)),
    ...(first ? { subjectPly: first.ply, label: first.label } : {}),
    suggestions: first ? [`Why was ${moveLabel(context, first)} rated ${first.label}?`, 'How many of each rating?', 'Show highlights'] : ['How many of each rating?', 'Show highlights', 'Summarize this game'],
  });
}

function worstMoves(context, side) {
  return context.result.moves.filter(move => (side === 'both' || move.color === side) && ERRORS.has(move.label))
    .sort((a, b) => b.probabilityLoss - a.probabilityLoss || b.loss - a.loss || a.ply - b.ply);
}

function endingText(context) {
  const board = context.replay, result = context.result.game.headers.Result;
  const outcome = result === '1/2-1/2' ? 'The recorded result is a draw.' : `${result === '1-0' ? 'White' : 'Black'} won the recorded game.`;
  if (board.isCheckmate()) return `${outcome} ${moveLabel(context, context.result.moves.at(-1))} delivers checkmate.`;
  if (board.isStalemate()) return `${outcome} The final position is stalemate.`;
  if (board.isThreefoldRepetition()) return `${outcome} The game history reaches threefold repetition.`;
  if (board.isInsufficientMaterial()) return `${outcome} The final position has insufficient material for checkmate.`;
  if (board.isDrawByFiftyMoves()) return `${outcome} The history reaches the fifty-move rule.`;
  return `${outcome} The moves do not establish the exact ending reason, such as resignation, agreement, or timeout.`;
}

function summaryAnswer(context, side, coach) {
  const paragraphs = [endingText(context)];
  for (const color of side === 'both' ? ['w', 'b'] : [side]) {
    const moves = context.result.moves.filter(move => move.color === color);
    const errors = worstMoves(context, color);
    const score = context.result.summary?.[color]?.accuracy;
    const stars = highlights(context, color, true);
    paragraphs.push(context.brief
      ? `${sideName(color)}${Number.isFinite(score) ? `: study score ${score.toFixed(1)}` : ''}. ${errors.length ? `Largest estimated loss: ${moveLabel(context, errors[0])} (${errors[0].label}).` : 'No Inaccuracies, Mistakes, or Blunders recorded.'}${stars.length ? ` Standout: ${moveLabel(context, stars[0])} (${stars[0].label}).` : ''}`
      : `${sideName(color)} played ${moves.length} moves${Number.isFinite(score) ? ` with a study score of ${score.toFixed(1)}` : ''}. ${errors.length ? `${errors.length} were rated Inaccuracy, Mistake, or Blunder; the largest estimated loss was ${moveLabel(context, errors[0])}.` : 'No moves were rated Inaccuracy, Mistake, or Blunder.'}${stars.length ? ` Highlights: ${stars.slice(0, 2).map(move => `${moveLabel(context, move)} (${move.label})`).join(', ')}.` : ''}`);
  }
  const worst = worstMoves(context, side);
  if (!context.brief) paragraphs.push(coachStudyStep(coach, worst.length ? moveLabel(context, worst[0]) : '', !!worst.length));
  const linked = [...highlights(context, side, true).slice(0, 2), ...worst.slice(0, 3)];
  return response(paragraphs.join('\n\n'), { coach, kind: 'summary', moves: [...new Map(linked.map(move => [move.ply, action(context, move)])).values()] });
}

function phaseAnswer(context, side, question, coach) {
  const requested = /\bend\s*game\b/i.test(question) ? 'endgame' : /\bmid(?:dle)?\s*game\b/i.test(question) ? 'middlegame' : /\b(early|opening)\b/i.test(question) ? 'opening' : null;
  const phases = getPhasePerformance(context.result).filter(phase => !requested || phase.id === requested);
  const lines = phases.map(phase => `${phase.name}: ${[...(side === 'both' ? ['w', 'b'] : [side])].map(color => `${sideName(color)} ${phase[color].label ? `${phase[color].label} across ${phase[color].total} ${phase[color].total === 1 ? 'move' : 'moves'}` : 'has no moves in this phase'}`).join('; ')}.`);
  lines.push(context.brief ? 'These are estimates across each phase; one strong move does not erase its errors.' : 'These phase labels summarize the reviewed moves. They are estimates, and one strong move does not erase errors elsewhere in the phase.');
  if (!context.brief) lines.push(coachTopicStep(coach, 'phases'));
  return response(lines.join('\n\n'), { coach, kind: 'facts', moves: phases.filter(phase => phase.firstPly).map(phase => action(context, context.result.moves[phase.firstPly - 1])) });
}

function materialAnswer(context, ply, coach) {
  const board = new Chess(context.result.game.positions[ply]);
  const values = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
  let balance = 0;
  for (const piece of board.board().flat()) if (piece) balance += values[piece.type] * (piece.color === 'w' ? 1 : -1);
  const prefix = ply ? `After ${moveLabel(context, context.result.moves[ply - 1])}` : 'In the starting position';
  return response(`${prefix}, ${balance ? `${sideName(balance > 0 ? 'w' : 'b')} has a material advantage of ${Math.abs(balance)} pawn-equivalents` : 'material is equal'}.${context.brief ? '' : ' This counts pawns as 1, knights and bishops as 3, rooks as 5, and queens as 9.'} Material alone does not determine who is winning.${context.brief ? '' : `\n\n${coachTopicStep(coach, 'material')}`}`, { coach, kind: 'facts', ...(ply ? { moves: [action(context, context.result.moves[ply - 1])], subjectPly: ply, label: context.result.moves[ply - 1].label } : {}) });
}

function keyMoments(context, side) {
  return context.result.moves.filter(move => (side === 'both' || side === move.color)
    && (ERRORS.has(move.label) || move.label === 'Brilliant' || move.label === 'Great'));
}

function nextMomentAnswer(context, ply, side, coach) {
  const moments = keyMoments(context, side);
  const next = moments.find(move => move.ply > ply);
  if (!next) {
    return response(moments.length
      ? `You’ve reached the last recorded key moment${side === 'both' ? '' : ` for ${sideName(side)}`}. Revisit the first one below, or look over the game summary.`
      : `There are no moves rated Brilliant, Great, Inaccuracy, Mistake, or Blunder${side === 'both' ? '' : ` for ${sideName(side)}`} in this review. Choose a close decision in the move list to explore.`, {
      coach, kind: 'moment', moves: moments.length ? [action(context, moments[0])] : [], suggestions: ['Summarize this game', 'Explain this position', 'Show highlights'],
    });
  }
  return response(`Next up: ${moveLabel(context, next)} (${sideName(next.color)} · ${next.label}). ${ERRORS.has(next.label) ? 'Pause before this move. ' : ''}${coachMoveTask(coach, moveVoiceDetails(context, next, legalSuggestion(context, next.ply - 1)))}`, {
    coach, kind: 'moment', moves: [action(context, next)], subjectPly: next.ply, label: next.label,
    suggestions: [`Why was ${moveLabel(context, next)} rated ${next.label}?`, `What was better than ${moveLabel(context, next)}?`, 'Next key moment'],
  });
}

function positionAnswer(context, ply, coach) {
  const board = new Chess(context.result.game.positions[ply]);
  const base = ply ? `After ${moveLabel(context, context.result.moves[ply - 1])}` : 'At the starting position';
  // Replay history preserves repetition and the fifty-move rule in addition to FEN facts.
  const line = createStudyLine(context.pgn, ply, []);
  const evaluation = context.result.positions[ply];
  const parts = line.terminal
    ? [`${base}, the position is ${line.terminalReason === 'Checkmate' ? 'checkmate' : `drawn by ${line.terminalReason.toLowerCase()}`}.`]
    : [`${base}, ${sideName(board.turn())} is to move${board.isCheck() ? ' and is in check' : ''}.`];
  if (!line.terminal) {
    if (evaluation.mate != null && evaluation.mate !== 0) {
      parts.push(`The saved search reports mate for ${sideName(evaluation.cp > 0 ? 'w' : 'b')} in ${Math.abs(evaluation.mate)} moves.`);
    } else {
      parts.push(`The saved evaluation is ${evaluation.cp >= 0 ? '+' : ''}${(evaluation.cp / 100).toFixed(2)} from White’s perspective${Math.abs(evaluation.cp) < 20 ? ' — close to equal' : `, favoring ${sideName(evaluation.cp > 0 ? 'w' : 'b')}`}.`);
    }
    const suggestion = legalSuggestion(context, ply);
    parts.push(suggestion ? context.brief ? `Saved line starts: ${suggestion.line}.${suggestion.truncated ? ' Only its legal continuation is shown.' : ''}` : `Explore ${suggestion.san} first. Saved line: ${suggestion.line}.${suggestion.truncated ? ' Only its legal continuation is shown.' : ''}`
      : 'There is no legal continuation in the saved analysis here. A deeper search may help.');
    if (!context.brief) parts.push(coachMoveTask(coach, { ply, inCheck: board.isCheck(), hasLine: !!suggestion, hasReply: suggestion?.moveCount > 1 }));
  } else if (!context.brief) parts.push(coachTopicStep(coach, 'ending'));
  return response(parts.join('\n\n'), {
    coach, kind: line.terminal ? 'facts' : 'position', ...(ply ? { subjectPly: ply, label: context.result.moves[ply - 1].label, moves: [action(context, context.result.moves[ply - 1])] } : {}),
    suggestions: line.terminal ? ['How did this game end?', 'Summarize this game', 'Show highlights']
      : ['What is the material?', 'Next key moment', ...(ply ? ['Why was this move rated this way?'] : ['Summarize this game'])],
  });
}

/** A local question router over reviewed facts, not an open-ended language model. */
export function answerCoach(options = {}) {
  const notation = createCoachText();
  return finishAnswer(answerCoachResponse(options, notation), notation);
}

function answerCoachResponse({ question, result, game, ply = 0, perspective = 'both', playerSide, coach = 'meowl', previousPly = null, explanationLength = 'detailed' } = {}, notation) {
  coach = COACHES.some(item => item.id === coach) ? coach : 'meowl';
  if (typeof question !== 'string' || !question.trim()) return response('Ask about this game, choose a suggested question, or select a move to discuss it.', { coach });
  if (question.length > MAX_QUESTION) return response(`Please keep your question under ${MAX_QUESTION} characters and focus on one game question.`, { coach });
  question = question.trim().replace(/[’‘]/g, "'");
  const context = contextFor(result, game);
  if (!context) return response('Finish reviewing a completed game first. Then I can explain its moves and saved engine analysis.', { coach, suggestions: [] });
  context.notation = notation;
  context.brief = explanationLength === 'brief';
  ply = Number.isInteger(ply) && ply >= 0 && ply <= result.moves.length ? ply : 0;
  perspective = resolveCoachFocus(normalizeCoachPerspective(perspective), playerSide);
  const side = selectedSide(question, perspective, playerSide);
  if (side === null) {
    return response('I couldn’t identify your side in this game. Check the saved username for this website, or include White or Black in your question.', { coach, suggestions: ["What was White's biggest mistake?", "What was Black's biggest mistake?", 'Summarize both players'] });
  }
  const legacyPersonal = /\b(my|mine)\b|\bi\b.*\b(play(?:ed)?|do|did|improve|lose|lost|win|won|practi[cs]e|have|had|make|made|get|got|find|found)\b/i.test(question);
  if (playerSide === undefined && legacyPersonal && perspective === 'both' && !/\b(white|black|opening)\b/i.test(question)) {
    return response('Choose White or Black in the coach’s player selector so I know which side is yours. You can also include the side in your question.', { coach, suggestions: ["What was White's biggest mistake?", "What was Black's biggest mistake?", 'Summarize both players'] });
  }
  const found = locateMove(question, context, ply, previousPly, side);
  if (found.error) return response(found.error, { coach, moves: found.moves });
  const move = found.move;
  if (!found.explicit && (/\bnext\s+(?:key|important|critical|learning)\s+(?:moment|position|move)\b/i.test(question)
    || /\b(?:look at|focus on|review|study)\s+next\b/i.test(question))) return nextMomentAnswer(context, ply, side, coach);
  if (/\b(?:explain|describe|understand|assess)\b.*\b(?:this|that|current|selected|the)\s+position\b|\bwhat(?:'s| is)\s+(?:happening|going on)\b.*\b(?:here|position)\b/i.test(question)) {
    return positionAnswer(context, found.explicit || /\bthat position\b/i.test(question) && move ? move.ply : ply, coach);
  }
  if (/\bwhy\b.*\b(lose|lost|won|win)\b/i.test(question) && !found.explicit) {
    const answer = summaryAnswer(context, side, coach);
    answer.text += '\n\nThese are recorded study moments, not proof that a single move caused the final result.';
    return answer;
  }
  if (/\b(biggest|worst|largest|critical|turning point)\b/i.test(question) || /\b(?:what|where)\b.*\bwrong\b/i.test(question)) {
    const worst = worstMoves(context, side);
    if (!worst.length) return response(`${side === 'both' ? 'Neither player has' : `${sideName(side)} has`} a move rated Inaccuracy, Mistake, or Blunder in this review. A longer search can change these estimates.`, { coach });
    const top = worst[0];
    return response(`${moveLabel(context, top)} (${sideName(top.color)}) is rated ${top.label}, with about ${Math.round(top.probabilityLoss * 100)} percentage points of estimated expected-score loss.\n\n${evidenceFor(context, top)}\n\nThis is the largest recorded move loss${side === 'both' ? '' : ` for ${sideName(side)}`}, not proof that this move alone decided the game.`, { coach, kind: 'mistake', moves: worst.slice(0, 3).map(move => action(context, move)), subjectPly: top.ply, label: top.label, suggestions: [`What was better than ${moveLabel(context, top)}?`, `Why was ${moveLabel(context, top)} rated ${top.label}?`, 'What should I practice?'] });
  }
  if (/\b(practi[cs]e|improve|training|lesson|learn|work on|study next)\b/i.test(question)) {
    const worst = worstMoves(context, side).slice(0, 3);
    const text = worst.length ? `Revisit ${worst.map(move => moveLabel(context, move)).join(', ')}. These are the largest recorded losses${side === 'both' ? '' : ` for ${sideName(side)}`} in this game.\n\nOpen a linked move and choose Try again.${context.brief ? ' Pick a candidate, then compare the saved line.' : ` ${coachStudyStep(coach, moveLabel(context, worst[0]))}`}` : `No moves were rated Inaccuracy, Mistake, or Blunder for the selected side. A deeper review may find other learning moments.${context.brief ? ' Practice one close decision from the move list.' : `\n\n${coachStudyStep(coach, '', false)}`}`;
    return response(text, { coach, kind: 'practice', moves: worst.map(move => action(context, move)) });
  }
  const category = categoryAnswer(context, question, side, coach, found, ply);
  if (category) return category;
  if (/\b(summary|summarize|overview|whole game|how did (?:i|we|white|black|both|each player) (?:do|play))\b/i.test(question)) return summaryAnswer(context, side, coach);
  if (/\b(phase|phases|middlegame|middle game|midgame|mid game|endgame|end game|early game)\b/i.test(question) || /\bopening\b.*\b(performance|grade|rating)\b/i.test(question) || /\bhow\b.*\bopening\b/i.test(question)) return phaseAnswer(context, side, question, coach);
  if (/\b(opening|book|theory|eco)\b/i.test(question) && !found.explicit && !/\b(this move|that move)\b|\bwhy\b.*\bbook\b/i.test(question)) {
    const opening = context.result.opening || recognizeOpening(context.result.game);
    if (!opening?.name) return response('The local opening reference does not identify a named opening for this game. Custom starting positions are not matched, and an unrecognized line is not necessarily a mistake.', { coach });
    const departure = context.result.moves[opening.departurePly - 1];
    return response(`The local reference identifies ${opening.name}${opening.eco ? ` (${opening.eco})` : ''}.${departure ? ` The first move outside the matched line is ${moveLabel(context, departure)}.` : 'The supplied game stays within a matched line.'}\n\nLeaving the reference is not automatically an error.${context.brief ? '' : ` The engine’s move rating is a separate assessment.\n\n${coachTopicStep(coach, 'opening')}`}`, { coach, kind: 'facts', moves: departure ? [action(context, departure)] : [] });
  }
  if (/\b(material|captured|pieces (?:up|down)|pawn equivalents?)\b/i.test(question)) return materialAnswer(context, found.explicit ? move.ply : ply, coach);
  if (/\b(advantage|winning|ahead|evaluation|eval|better position)\b/i.test(question) && !/\bwhy\b/i.test(question)) {
    const index = found.explicit ? move.ply : ply, evaluation = result.positions[index];
    const prefix = index ? `After ${moveLabel(context, result.moves[index - 1])}` : 'At the starting position';
    const text = evaluation.mate != null ? evaluation.mate === 0 ? `${prefix}, the position is checkmate.` : `${prefix}, the engine reports mate for ${sideName(evaluation.cp > 0 ? 'w' : 'b')} in ${Math.abs(evaluation.mate)} moves at this search depth.`
      : `${prefix}, the saved evaluation is ${evaluation.cp >= 0 ? '+' : ''}${(evaluation.cp / 100).toFixed(2)} from White’s perspective. ${Math.abs(evaluation.cp) < 20 ? 'The engine evaluates the position as close to equal.' : `${sideName(evaluation.cp > 0 ? 'w' : 'b')} has the engine advantage.`} This is an estimate at the saved search depth, not the game result.`;
    return response(text, { coach, kind: 'facts', ...(index ? { moves: [action(context, result.moves[index - 1])], subjectPly: index, label: result.moves[index - 1].label } : {}) });
  }
  if (/\b(end|ending|ended|finish|finished|result|won|winner|checkmate|mate|stalemate|repetition|resign|timeout|time out|draw)\b/i.test(question)
    && !/\b(this move|that move|better)\b/i.test(question) && (!/\bwhy\b/i.test(question) || !found.explicit)) {
    return response(`${endingText(context)}${context.brief ? '' : `\n\n${coachTopicStep(coach, 'ending')}`}`, { coach, kind: 'facts', moves: [action(context, result.moves.at(-1))], subjectPly: result.moves.length, label: result.moves.at(-1).label });
  }
  if (/\b(plan|next move|continue|continuation|what next)\b/i.test(question)) {
    const index = found.explicit ? move.ply : ply, suggestion = legalSuggestion(context, index);
    return response(suggestion ? `From ${index ? `the position after ${moveLabel(context, result.moves[index - 1])}` : 'the starting position'}, the saved engine line ${context.brief ? 'starts with' : 'is'} ${suggestion.line}.\n\n${context.brief ? '' : 'This is a concrete continuation at the saved search time. '}I cannot verify a broader strategic plan from that line alone.` : 'There is no legal next-move suggestion in the saved analysis for this position. It may be terminal; otherwise, analyze it more deeply.', { coach, kind: 'facts', ...(index ? { moves: [action(context, result.moves[index - 1])], subjectPly: index, label: result.moves[index - 1].label } : {}) });
  }
  if (found.explicit || /\b(move|moves|grade|rated|rating|label|brilliant|great|best|excellent|good|mistake|blunder|inaccuracy|better|instead)\b/i.test(question)
    || /^(?:why|explain (?:this|that|it))[?!.]*$/i.test(question)) {
    if (!move) return response('Select a move in the game, or include its number and side in your question, such as “Why was 2...Nc6 good?”', { coach, moves: result.moves.slice(0, 2).map(move => action(context, move)) });
    return moveAnswer(context, move, coach, /\b(better|instead|best)\b/i.test(question));
  }
  return response('I’m a local game coach, not an open-ended AI chat. I can answer common questions about this review’s moves, engine suggestions, mistakes, opening, phases, material, and practice. Try one of the questions below.', { coach });
}

/** A short, evidence-based comment for the exact selected move of a completed review. */
export function describeCoachMove({ result, game, ply, perspective = 'both', playerSide, coach = 'meowl', explanationLength = 'detailed' } = {}) {
  const context = contextFor(result, game), notation = createCoachText();
  return finishAnswer(describeMoveInContext(context ? { ...context, notation } : null, { ply, perspective, playerSide, coach, explanationLength }), notation);
}

function describeMoveInContext(context, { ply, perspective = 'both', playerSide, coach = 'meowl', explanationLength = 'detailed' } = {}) {
  if (!context || !Number.isInteger(ply) || ply < 1 || ply > context.result.moves.length) return null;
  perspective = resolveCoachFocus(perspective, playerSide);
  if (perspective === null) return null;
  const move = context.result.moves[ply - 1];
  if (['w', 'b'].includes(perspective) && move.color !== perspective) return null;
  context.brief = explanationLength === 'brief';
  coach = COACHES.some(item => item.id === coach) ? coach : 'meowl';
  const parts = [coachMoveLead(coach, move.label, ply)];
  const suggestion = legalSuggestion(context, ply - 1);
  const played = `${move.from}${move.to}${move.promotion || ''}`;
  if (suggestion && suggestion.uci !== played && move.label !== 'Book') {
    parts.push(`The ${context.brief ? 'saved ' : ''}engine preferred ${suggestion.san}.`);
  }
  if (ERRORS.has(move.label) || ['Brilliant', 'Great'].includes(move.label) || /[+#]/.test(move.san)) {
    parts.push(evidenceFor(context, move));
  } else if (move.label === 'Book') {
    parts.push('Book moves are excluded from the study score.');
  } else if (suggestion?.uci === played && move.label !== 'Best') {
    parts.push('The engine also preferred the move played.');
  } else if (move.label === 'Best' && coach !== 'owl' && suggestion?.uci === played) {
    parts.push('The engine also chose this move.');
  }
  if (!context.brief || parts.length === 1) parts.push(coachMoveTask(coach, moveVoiceDetails(context, move, suggestion)));
  const next = keyMoments(context, ['w', 'b'].includes(perspective) ? perspective : 'both').find(item => item.ply > ply);
  return {
    subjectPly: ply, label: move.label, heading: `${moveLabel(context, move)} · ${move.label}`, text: parts.join(' '),
    suggestion: suggestion && suggestion.uci !== played && move.label !== 'Book'
      ? `What was better than ${moveLabel(context, move)}?` : `Why was ${moveLabel(context, move)} rated ${move.label}?`,
    nextMoment: next ? { ...action(context, next), rating: next.label } : null,
  };
}


/** Validate one private review snapshot, then keep its legal game history for navigation. */
export function createCoachWalkthrough({ result, game } = {}) {
  let context;
  try {
    // The caller can replace or mutate its objects without changing this validated snapshot.
    const snapshot = structuredClone({ result, game });
    context = contextFor(snapshot.result, snapshot.game);
  } catch { context = null; }
  if (!context) return { describe: () => null };
  const board = context.replay;
  let cursor = context.result.moves.length;
  const terminalReason = () => board.isCheckmate() ? 'Checkmate' : board.isStalemate() ? 'Stalemate'
    : board.isThreefoldRepetition() ? 'Threefold repetition' : board.isDrawByFiftyMoves() ? 'Fifty-move rule'
    : board.isInsufficientMaterial() ? 'Insufficient material' : null;
  context.lineAt = (basePly, input) => {
    while (cursor > basePly) { board.undo(); cursor--; }
    while (cursor < basePly) {
      const move = context.result.moves[cursor];
      board.move({ from: move.from, to: move.to, promotion: move.promotion }); cursor++;
    }
    const moves = [];
    let branchLength = 0, truncated = input.length > 24;
    try {
      for (const uci of input.slice(0, 24)) {
        if (board.isGameOver() || !UCI.test(uci || '')) { truncated = true; break; }
        try {
          const move = board.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
          branchLength++; moves.push({ ...move, uci });
        } catch { truncated = true; break; }
      }
      const reason = terminalReason();
      return { moves, truncated, terminal: !!reason, terminalReason: reason };
    } finally {
      while (branchLength > 0) { board.undo(); branchLength--; }
    }
  };
  return { describe: options => {
    const notation = createCoachText();
    return finishAnswer(describeMoveInContext({ ...context, notation }, options), notation);
  } };
}
