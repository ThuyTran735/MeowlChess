import { EVIL_COACH, EVIL_VOICE } from './coach-evil-personality.js';
import { BABY_COACH, BABY_VOICE } from './coach-baby-personality.js';

const profile = (value) => Object.freeze({ ...value, traits: Object.freeze(value.traits), suggestions: Object.freeze(value.suggestions) });

export const COACHES = Object.freeze([
  profile({ id: 'meowl', name: 'Meowl', description: 'A curious study buddy with a playful streak. Let’s find the idea together.', traits: ['Curious', 'Playful'], suggestions: ['Summarize this game', 'Show Brilliant and Great moves', 'What should I practice?', 'Explain this position'] }),
  profile(BABY_COACH),
  profile({ id: 'owl', name: 'Professor Meowl', description: 'Evidence first, then a clear lesson to take away.', traits: ['Analytical', 'Methodical'], suggestions: ['Explain this position', 'What was the biggest mistake?', 'How were the phases?', 'Summarize this game'] }),
  profile({ id: 'paws', name: 'Captain Paws', description: 'An upbeat captain who turns review into small challenges.', traits: ['Energetic', 'Playful'], suggestions: ['Next key moment', 'What should I practice?', 'Show Brilliant and Great moves', 'Summarize this game'] }),
  profile({ id: 'mellow', name: 'Mellow Meowl', description: 'A patient companion. No rush, no scolding.', traits: ['Patient', 'Reassuring'], suggestions: ['Summarize this game', 'Explain this position', 'What opening is this?', 'What should I practice?'] }),
  profile({ id: 'scout', name: 'Scout Meowl', description: 'A curious detective: checks, captures, and the next clue.', traits: ['Curious', 'Tactical'], suggestions: ['Explain this position', 'Next key moment', 'What is the material?', 'Show Brilliant and Great moves'] }),
  profile(EVIL_COACH),
]);

export function coachId(value) { return COACHES.some(item => item.id === value) ? value : 'meowl'; }

const EXTRA_VOICES = { evil: EVIL_VOICE, baby: BABY_VOICE };

const LEADS = {
  summary: { meowl: 'Let’s find one useful thing to take into the next game.', owl: 'Review notes', paws: 'Captain’s log. Let’s pick the next training stop.', mellow: 'There’s no need to fix everything at once.', scout: 'Let’s follow the important clues in this game.' },
  practice: { meowl: 'A little practice goes a long way.', owl: 'Practice task', paws: 'A small mission for the next session:', mellow: 'Take one position. There is no timer here.', scout: 'Investigation: compare the candidates before checking the line.' },
  mistake: { meowl: 'Something slipped past our whiskers here. Let’s take a closer look.', owl: 'Largest recorded loss', paws: 'Let’s chart one useful improvement.', mellow: 'We can look at this gently. The goal is to understand the choice.', scout: 'Here is the position with the largest recorded loss. What changed?' },
  move: { meowl: 'Let’s work through it together.', owl: 'Move assessment', paws: 'All right, let’s put this move through its paces.', mellow: 'One move, one explanation. Take your time with the line.', scout: 'Let’s separate the clue from the conclusion.' },
  position: { meowl: 'Here’s where we are on the board.', owl: 'Position notes', paws: 'Board check. What should we inspect first?', mellow: 'Let’s get comfortable with this position first.', scout: 'Position check: whose turn, what is threatened, and which replies are legal?' },
  moment: { meowl: 'Here’s our next stop.', owl: 'Next study position', paws: 'Next checkpoint!', mellow: 'We can pause here for a moment.', scout: 'The next clue is here.' },
  catalog: { meowl: 'Let’s find those moves.', owl: 'Recorded move labels', paws: 'Here are the stops on that route.', mellow: 'Here they are. We can explore them one at a time.', scout: 'Here are the matching moves in the review.' },
  facts: { meowl: 'Here’s what the review tells us.', owl: 'Review evidence', paws: 'A quick look at the board notes.', mellow: 'Let’s keep this to what we can see.', scout: 'Here is the evidence we have.' },
};

const POSITION_LEADS = {
  meowl: ['This position has my attention. Let’s have a little look.', 'Before we pounce on a move, let’s see what the board is saying.', 'I’m curious about the reply. Let’s start there.'],
  owl: ['Position notes: establish the facts before choosing a move.', 'First, identify the side to move. Then inspect the evidence.', 'A position is a question. The continuation should support the answer.'],
  paws: ['Board check. Pick a candidate and put it to the test.', 'Next checkpoint: choose a move before checking the line.', 'A short challenge: work out the reply before moving ahead.'],
  mellow: ['Settle into this position. We only need one idea to begin.', 'There’s no hurry. Start with whose turn it is.', 'We can take this one small step at a time.'],
  scout: ['Start with the clues: whose turn, what changed, and what can be forced?', 'Inspect the board before forming a theory.', 'Let’s trace the replies and see which clues hold up.'],
};
const pick = (choices, ply = 0) => choices[(Number.isInteger(ply) && ply > 0 ? ply - 1 : 0) % choices.length];

/** Presentation only: facts, ratings and move references are built by the validated review. */
export function coachResponseText(text, { coach = 'meowl', kind = '', ply = 0, label } = {}) {
  coach = coachId(coach);
  const voice = EXTRA_VOICES[coach];
  const lead = kind === 'move' && label ? coachMoveLead(coach, label, ply)
    : kind === 'position' ? pick(voice ? voice.positions : POSITION_LEADS[coach], ply)
    : voice ? voice.leads[kind] : LEADS[kind]?.[coach];
  if (!lead) return text;
  const paragraphs = text.split('\n\n');
  // Professor keeps a compact note structure; the other coaches speak conversationally.
  const body = coach === 'owl' && paragraphs.length > 1
    ? paragraphs.map((part, index) => `${index + 1}. ${part}`).join('\n\n') : text;
  return `${lead}\n\n${body}`;
}

export function coachStudyStep(coach, target = '', hasErrors = true) {
  const place = target ? `the position before ${target}` : 'one close decision in the move list';
  if (coachId(coach) === 'evil') return `Take ${place} back to the lair. Choose a candidate, try to spoil it with a legal reply, then compare the saved line. The evil laugh comes after the evidence.`;
  if (coachId(coach) === 'baby') return `Hop back to ${place}. Pick one candidate, try a legal reply, then compare the saved line. That’s one little lesson for our collection.`;
  return {
    meowl: `Start with ${place}. Try a candidate, then compare it with the engine suggestion. One useful idea is enough for today.`,
    owl: `Study ${place}. Record a candidate and its strongest reply, then compare both with the saved line.`,
    paws: `Mini-mission: open ${place}${hasErrors ? ' and choose Try again' : ''}. Pick a candidate before revealing the engine line, then play through the reply.`,
    mellow: `Spend a quiet minute with ${place}. It is fine to try more than one idea before looking at the engine suggestion.`,
    scout: `Investigate ${place}: list the checks, captures, and threats for both sides, then compare a candidate with the saved line.`,
  }[coachId(coach)];
}

export function coachPositionStep(coach) {
  const voice = EXTRA_VOICES[coachId(coach)];
  if (voice) return voice.positionStep;
  return {
    meowl: 'Try the first move on the board and see how the reply fits.',
    owl: 'Compare the first candidate with the strongest legal reply before drawing a conclusion.',
    paws: 'Quick challenge: cover the line, pick a candidate, then see whether it survives the reply.',
    mellow: 'Take the line one move at a time; there is no need to memorize it.',
    scout: 'Before following the line, check for forcing moves on both sides: checks, captures, and threats.',
  }[coachId(coach)];
}

// These are observation tasks, not generated chess claims. Their inputs come
// from the replayed move and a legal saved line; no new move is proposed here.
const MOVE_TASKS = {
  ending: {
    meowl: 'That’s the end of this game’s trail. Hop back one move and see what changed.',
    owl: 'Return to the preceding position and explain how it led to this final recorded move.',
    paws: 'Final checkpoint: go back one move and explain the choice before revealing it.',
    mellow: 'This is the last recorded move. We can revisit the preceding position at an easy pace.',
    scout: 'The record ends here. Compare the last two positions and identify what changed.',
  },
  check: {
    meowl: 'That check has my ears up. Which legal replies answer it?',
    owl: 'List the legal replies to the check before judging the continuation.',
    paws: 'Quick challenge: find the legal replies to the check before opening the line.',
    mellow: 'Start with one legal answer to the check. We can compare the others afterward.',
    scout: 'Check is the first clue. Inspect king moves, captures, and blocks where legal.',
  },
  promotion: {
    meowl: 'A pawn gets a new job. What can the promoted piece do, and what can answer it?',
    owl: 'Compare the new piece’s legal moves with the opponent’s immediate replies.',
    paws: 'Promotion checkpoint: name one job for the new piece, then check the reply.',
    mellow: 'Look at the promoted piece first. One legal move or reply is enough to start.',
    scout: 'Follow the promoted piece: check its attacks, then inspect forcing replies.',
  },
  capture: {
    meowl: 'A capture is tempting. Let’s peek at the reply before counting the prize.',
    owl: 'Count what was captured, then test legal recaptures before evaluating the exchange.',
    paws: 'Challenge: count the exchange only after checking the legal recaptures.',
    mellow: 'First notice which piece was taken. Then look at one possible reply.',
    scout: 'A piece left the board. Look for legal recaptures and newly opened lines.',
  },
  castle: {
    meowl: 'The king has a new perch. What changed around it?',
    owl: 'Compare king safety and rook activity before and after castling.',
    paws: 'Castling checkpoint: inspect the king’s new square and the rook’s next job.',
    mellow: 'Notice where the king and rook moved. Explore one consequence at a time.',
    scout: 'Two pieces moved. Check the new king position and the lines available to the rook.',
  },
  book: {
    meowl: 'I’d rather know what a move does than memorize its name. What changed on the board?',
    owl: 'Explain the purpose of this opening move before trying to memorize the sequence.',
    paws: 'Opening challenge: describe the move’s purpose in one sentence.',
    mellow: 'Choose one thing the opening move changes. The full line can wait.',
    scout: 'Compare the two positions: development, central squares, and king safety are useful clues.',
  },
  sacrifice: {
    meowl: 'I’d be tempted by that offer too. Follow the saved line and see what it answers.',
    owl: 'Identify the offered material, then trace the saved continuation before explaining the compensation.',
    paws: 'Challenge: explain the material offer using the saved line, one reply at a time.',
    mellow: 'Start with the offered material. Then follow just the first reply in the saved line.',
    scout: 'The material offer is the clue; the saved continuation is the evidence to investigate.',
  },
  alternative: {
    meowl: 'Try a different idea before peeking. I’m curious which reply changes the comparison.',
    owl: 'Compare the played move with the legal engine candidate and identify the first different reply.',
    paws: 'Mini-challenge: choose a candidate, test its reply, then compare it with the engine line.',
    mellow: 'Replay just the first move of the alternative. See what changes before going farther.',
    scout: 'Compare the two candidates and inspect the first reply where their consequences differ.',
  },
  missing: {
    meowl: 'I’d mark this for a deeper look before guessing what comes next.',
    owl: 'Keep the explanation provisional until a deeper review supplies a legal continuation.',
    paws: 'Mark this checkpoint for a deeper review, then return to the drill.',
    mellow: 'It is fine to leave one question open. We can return after a deeper review.',
    scout: 'Collect a legal continuation before following the next clue.',
  },
  short: {
    meowl: 'We have one recorded candidate. Try a legal reply before we peek any farther.',
    owl: 'Only one move is shown in the line. Test a legal reply before extending the explanation.',
    paws: 'One-move challenge: test a legal reply to this candidate before continuing.',
    mellow: 'The saved line is brief. Try one legal reply at an easy pace.',
    scout: 'The line stops at one candidate. Investigate a legal reply; do not assume what follows.',
  },
};
const ORDINARY_TASKS = {
  meowl: ['Before clicking Next, try guessing the reply. I’ll wait here with my paws to myself.', 'What would the other side try? Let’s peek one move farther.', 'Find one thing this move changed. Tiny discoveries count.', 'Try explaining the idea out loud before following the line.', 'I’m curious: which reply would be easiest to overlook?'],
  owl: ['State the move’s purpose, then test it against the strongest legal reply.', 'Separate the observation from the conclusion: what does the saved line actually establish?', 'Compare the before and after positions, and name one consequence supported by the line.', 'Predict the next reply, then check it against the saved continuation.', 'Explain why the first reply matters before continuing through the line.'],
  paws: ['Quick challenge: choose the reply before revealing the next move.', 'One checkpoint at a time: name the idea, then test the reply.', 'Try this drill: hide the line, pick a reply, and compare.', 'Keep the next challenge small: explain this move in one sentence.', 'Before moving on, test one candidate from the other side.'],
  mellow: ['Choose one reply to look at. The rest of the line can wait.', 'Take a quiet moment to compare the two positions.', 'Follow only the first two moves for now. We can go farther when they make sense.', 'Name one thing that changed. That is enough for this step.', 'Try a candidate at an easy pace, then look at the saved reply.'],
  scout: ['Check the opponent’s forcing replies: checks, captures, and threats.', 'Look for a changed line or an undefended piece, then test the idea legally.', 'Follow the next reply and ask which squares or pieces it affects.', 'Before following the line, list the forcing candidates for the side to move.', 'Inspect both sides of the position; a tempting first move is only the first clue.'],
};

export function coachMoveTask(coach, { ply = 0, label, ending = false, inCheck = false, promotion = false, capture = false, castle = false, hasLine = false, hasReply = false, alternative = false } = {}) {
  coach = coachId(coach);
  const situation = ending ? 'ending' : inCheck ? 'check' : promotion ? 'promotion' : capture ? 'capture' : castle ? 'castle'
    : label === 'Book' ? 'book' : !hasLine ? 'missing' : !hasReply ? 'short' : label === 'Brilliant' ? 'sacrifice' : alternative ? 'alternative' : '';
  const voice = EXTRA_VOICES[coach];
  if (voice) return situation ? voice.moveTasks[situation] : pick(voice.ordinaryTasks, ply);
  return situation ? MOVE_TASKS[situation][coach] : pick(ORDINARY_TASKS[coach], ply);
}

const TOPIC_TASKS = {
  material: {
    meowl: 'I like counting pieces, but I’d peek at the checks before getting comfortable.',
    owl: 'Keep the material count separate from the evaluation; inspect king safety and legal threats too.',
    paws: 'Board challenge: compare the material count with the evaluation, then inspect the forcing replies.',
    mellow: 'Start with the count. Then look at one factor it leaves out, such as king safety.',
    scout: 'Material is one clue. Look for checks and captures before concluding who stands better.',
  },
  opening: {
    meowl: 'No need to recite the whole opening. Let’s find one move whose purpose is interesting.',
    owl: 'Choose one opening move and explain its purpose before memorizing the sequence.',
    paws: 'Opening mission: explain one move’s purpose, then try recalling its reply.',
    mellow: 'Learn one useful opening idea today. The name and longer variations can wait.',
    scout: 'Trace the first departure from the reference, if there is one, and inspect the position it creates.',
  },
  phases: {
    meowl: 'Let’s pick one phase to explore. We don’t need to chase every move at once.',
    owl: 'Choose a phase and inspect its individual moves before explaining the overall label.',
    paws: 'Pick one phase for the next drill and mark a single position to revisit.',
    mellow: 'Choose the phase that feels most useful. One position is a good start.',
    scout: 'Use the phase label to choose where to investigate, then examine the moves behind it.',
  },
  ending: {
    meowl: 'That closes this game’s trail. Want to go back to one interesting moment?',
    owl: 'Keep the recorded result separate from what the moves prove about the ending.',
    paws: 'Game logged. Pick one checkpoint to carry into the next training session.',
    mellow: 'We can stop here or revisit one moment. There is no need to review everything at once.',
    scout: 'The result records what happened; use the move history to investigate how it happened.',
  },
};
export function coachTopicStep(coach, topic) {
  const voice = EXTRA_VOICES[coachId(coach)];
  return (voice ? voice.topics[topic] : TOPIC_TASKS[topic]?.[coachId(coach)]) || '';
}

// Familiar grade wording combines with two more character-specific leads below.
const REACTIONS = {
  meowl: {
    Brilliant: ['Oh, that’s a lovely sacrifice to study.', 'A brilliant moment. Let’s see how the offer works.', 'This one deserves a closer look!'],
    Great: ['A great move to stop and study.', 'Nice find in this review. What made it important?', 'There’s a useful idea tucked into this move.'],
    Best: ['That’s a strong choice.', 'Nicely done. This agrees with the saved search.', 'A good moment to remember.'],
    Excellent: ['Nicely played.', 'Very little was given away here.', 'A solid choice to build on.'],
    Good: ['A reasonable choice.', 'This keeps things moving.', 'A steady step.'],
    Book: ['Familiar opening territory.', 'A move from a known opening.', 'This follows the local opening reference.'],
    Inaccuracy: ['There was a little more to find here.', 'A small opportunity slipped by.', 'This is worth a second look.'],
    Mistake: ['Let’s work this one out together.', 'A useful place to pause and learn.', 'This move gave away chances. We can study the alternative.'],
    Blunder: ['A tough moment, but a useful lesson.', 'Let’s slow down and look at the reply.', 'There’s something concrete to learn here.'],
  },
  owl: {
    Brilliant: ['The review identifies a sound sacrifice.', 'Examine the offered material and the verified continuation.', 'Brilliant in the saved review. The continuation is the evidence.'],
    Great: ['A critical choice in the saved review.', 'An important opportunity confirmed by the engine.', 'Great: study the alternative as well as the played move.'],
    Best: ['The saved search ranks this move first.', 'Best in this review, at its recorded search depth.', 'This matches the top recorded candidate.'],
    Excellent: ['Very little estimated loss here.', 'Excellent: the recorded loss is small.', 'The assessment stays close to the engine’s preferred choice.'],
    Good: ['A playable move in this review.', 'Good: a reasonable move with a small estimated loss.', 'The saved assessment considers this a reasonable choice.'],
    Book: ['This matches the local opening reference.', 'A recorded opening move.', 'Book: the move appears in the opening reference.'],
    Inaccuracy: ['A small missed opportunity.', 'The review records a modest loss of chances.', 'Compare the played move with the preferred candidate.'],
    Mistake: ['A significant estimated loss of chances.', 'The consequence is worth checking move by move.', 'Mistake in the saved review. Start with the strongest reply.'],
    Blunder: ['A large estimated loss of chances.', 'This is a priority position for review.', 'Blunder: verify where the recorded continuation changes the assessment.'],
  },
  paws: {
    Brilliant: ['That earns a wing salute!', 'Now that’s a move to bring back to training.', 'A brilliant stop on the route. Let’s inspect it.'],
    Great: ['A sharp find. Mark this checkpoint.', 'Great move! Time for a closer inspection.', 'A strong checkpoint in this review.'],
    Best: ['Right on course.', 'A neat piece of work.', 'This matches the engine’s first choice.'],
    Excellent: ['Looking sharp.', 'Steady hands on this one.', 'Excellent. Keep this idea in the training log.'],
    Good: ['Steady progress.', 'A reasonable step on the route.', 'Good. Let’s keep watching the replies.'],
    Book: ['Familiar waters in the opening.', 'This route is in the opening reference.', 'An opening checkpoint we already know.'],
    Inaccuracy: ['A small detour. Let’s check the better route.', 'A training opportunity spotted.', 'A little course correction would help here.'],
    Mistake: ['Training stop! Inspect the reply before moving on.', 'This is a good one for a rematch with the position.', 'A detour worth investigating.'],
    Blunder: ['Drop anchor here. This position deserves a retry.', 'A big training moment, not the end of the voyage.', 'Mini-mission: understand what the reply changes.'],
  },
  mellow: {
    Brilliant: ['A lovely moment to pause and appreciate.', 'There is a beautiful idea to explore here.', 'Brilliant in this review. Take time with the continuation.'],
    Great: ['An important move, worth a quiet look.', 'A thoughtful moment to study at our own pace.', 'Let’s pause and see why this stood out.'],
    Best: ['A solid step.', 'This choice agrees with the engine review.', 'A calm moment to take in.'],
    Excellent: ['A nicely played move.', 'Very little was lost here.', 'This is a solid choice.'],
    Good: ['A steady, reasonable move.', 'There is room to explore, and this is a playable choice.', 'One steady step at a time.'],
    Book: ['A familiar opening move.', 'This is part of the local opening reference.', 'Known opening territory; no need to memorize everything today.'],
    Inaccuracy: ['There is a small opportunity to explore.', 'We can revisit this without rushing.', 'A second look may make the alternative clearer.'],
    Mistake: ['We can learn something from this choice.', 'Take a breath. Let’s look at the reply together.', 'Start with the first reply; the rest can wait.'],
    Blunder: ['One difficult move does not define a player.', 'We can take this learning moment slowly.', 'Let’s be patient and work through the alternative.'],
  },
  scout: {
    Brilliant: ['An offered piece is our first clue.', 'A sacrifice worth investigating. What does the reply allow?', 'Brilliant in the review. Follow the material offer.'],
    Great: ['An important clue in the saved review.', 'Why did this choice stand out? Let’s trace it.', 'A critical moment. Check the replies, not just the first move.'],
    Best: ['This candidate leads the saved search.', 'The first clue matches the engine’s choice.', 'A strong candidate. What does its reply reveal?'],
    Excellent: ['Very little lost opportunity in the review.', 'A sound candidate to compare with the preferred line.', 'Excellent in the saved review. Look at what follows.'],
    Good: ['A reasonable candidate.', 'This keeps reasonable chances in the review.', 'Good. Keep the opponent’s forcing replies in view.'],
    Book: ['This clue matches the opening reference.', 'A known move in the local opening line.', 'The opening reference recognizes this position’s move.'],
    Inaccuracy: ['There is a missed clue here.', 'Look for the opportunity in the saved line.', 'A small gap to investigate.'],
    Mistake: ['Start with the opponent’s strongest reply.', 'Something changed here. Follow the recorded continuation.', 'Let’s trace the consequence instead of guessing.'],
    Blunder: ['A major clue: the review records a large loss.', 'Check the forcing replies before making a theory.', 'This is where careful move-by-move investigation helps.'],
  },
};

const EXTRA_REACTIONS = {
  meowl: {
    Brilliant: ['That material offer caught my eye.', 'Ooh, a Brilliant to take apart together.'],
    Great: ['There’s something interesting to untangle here.', 'This one gets a curious head tilt.'],
    Best: ['A tidy choice for our little collection.', 'This is worth keeping in mind.'],
    Excellent: ['That’s a neat bit of play.', 'A little precision goes a long way.'],
    Good: ['A sensible idea to inspect.', 'Let’s see what this choice gives the other side.'],
    Book: ['We’ve found a familiar path.', 'An opening move with a story to learn.'],
    Inaccuracy: ['Something small slipped past the whiskers.', 'There’s another idea to sniff out here.'],
    Mistake: ['I’d pause here before chasing the next move.', 'Let’s untangle the reply together.'],
    Blunder: ['This is a good place for a patient second look.', 'One move at a time. Let’s see what changed.'],
  },
  owl: {
    Brilliant: ['The label is Brilliant; the task is to explain its evidence.', 'A material offer that warrants a precise explanation.'],
    Great: ['Identify what distinguishes this choice from the alternatives.', 'An important decision in the saved assessment.'],
    Best: ['Best in the recorded assessment.', 'The review places this candidate first.'],
    Excellent: ['The saved comparison records almost no loss.', 'A close match to the preferred choice.'],
    Good: ['A reasonable choice in the saved assessment.', 'Inspect the continuation before adding a strategic explanation.'],
    Book: ['Opening recognition and evaluation are separate questions.', 'First understand the opening move’s purpose.'],
    Inaccuracy: ['Locate the first meaningful difference in the alternatives.', 'A modest loss recorded at this search depth.'],
    Mistake: ['Focus on the consequence, then compare the alternative.', 'A useful exercise in checking the opponent’s reply.'],
    Blunder: ['Work backward from the consequence to the decision.', 'This position merits a careful comparison of candidates.'],
  },
  paws: {
    Brilliant: ['A highlight for the captain’s log.', 'That deserves a closer inspection.'],
    Great: ['Mark this as a useful checkpoint.', 'A standout move for the next training round.'],
    Best: ['A strong checkpoint.', 'This choice stays on course.'],
    Excellent: ['Good work in the saved review.', 'An idea worth carrying into training.'],
    Good: ['A steady choice. Keep an eye on the reply.', 'A useful checkpoint for a quick drill.'],
    Book: ['An opening route we can learn from.', 'A familiar checkpoint in the opening.'],
    Inaccuracy: ['Time to check the route once more.', 'A small course correction to study.'],
    Mistake: ['Mark this position for another attempt.', 'A clear target for the next practice round.'],
    Blunder: ['Pause the voyage for one useful lesson.', 'Here’s a position worth returning to.'],
  },
  mellow: {
    Brilliant: ['A special moment to explore at an easy pace.', 'Let’s appreciate the idea, then understand it.'],
    Great: ['A useful moment to linger over.', 'We can give this important choice a little time.'],
    Best: ['A reassuring choice in the saved review.', 'Let’s notice what worked here.'],
    Excellent: ['A careful choice to remember.', 'Something useful to build on.'],
    Good: ['A reasonable step in this position.', 'There is no need to rush past this choice.'],
    Book: ['A familiar beginning to explore gently.', 'One opening idea is enough for now.'],
    Inaccuracy: ['A small adjustment may become clearer on another look.', 'There is room to learn here without rushing.'],
    Mistake: ['One reply can help this make sense.', 'We can turn this into one manageable practice task.'],
    Blunder: ['Start with one detail; the whole line can wait.', 'We can work through this patiently.'],
  },
  scout: {
    Brilliant: ['Trace the offered material and inspect the response.', 'The sacrifice is a clue to investigate carefully.'],
    Great: ['A standout clue. Inspect the reply that supports it.', 'Compare the candidates before explaining the label.'],
    Best: ['The evidence points to this recorded candidate.', 'Follow the first candidate and inspect the response.'],
    Excellent: ['Look at the reply that supports this assessment.', 'A close comparison worth examining.'],
    Good: ['A reasonable candidate; keep investigating the replies.', 'Check what changed before drawing a conclusion.'],
    Book: ['The opening reference supplies the first clue.', 'Known territory, but the position still deserves inspection.'],
    Inaccuracy: ['Look for a clue in the alternative.', 'Inspect what the reply changes.'],
    Mistake: ['Trace the first consequence of this choice.', 'Check both sides before settling on an explanation.'],
    Blunder: ['Follow the forcing replies carefully here.', 'A significant change to investigate move by move.'],
  },
};

export function coachMoveLead(coach, label, ply) {
  coach = coachId(coach);
  const voice = EXTRA_VOICES[coach];
  if (voice) return voice.reactions[label] ? pick(voice.reactions[label], ply) : '';
  const choices = REACTIONS[coach][label];
  if (!choices) return '';
  return pick([...choices, ...EXTRA_REACTIONS[coach][label]], ply);
}
