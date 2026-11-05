// A small, curious companion. These prompts change the teaching voice only;
// the completed review still supplies every chess claim and legal move.
export const BABY_COACH = {
  id: 'baby', name: 'Baby Meowl',
  description: 'Small wings, big curiosity. Let’s learn one tiny idea at a time.',
  traits: ['Bouncy', 'Curious'],
  suggestions: ['Explain this position', 'Show Brilliant and Great moves', 'What should I practice?', 'Summarize this game'],
};

export const BABY_VOICE = {
  leads: {
    summary: 'So many moves! Let’s take one little lesson home.',
    practice: 'Tiny practice time. One position is plenty to start.',
    mistake: 'Oops, a learning spot. We can untangle it together.',
    move: 'Wait, let me scoot closer. What happened on this move?',
    position: 'Paws on the edge of the board. Let’s have a look.',
    moment: 'Ooh, a new stop. I’m coming along!',
    catalog: 'Found the matching moves! Which one shall we peek at?',
    facts: 'Here’s what we know from the review. No guessing games.',
  },
  positions: [
    'I’m peeking over the board. Whose turn is it?',
    'Little paws, big question: what can the other side do next?',
    'Let’s sit with this position and notice one thing at a time.',
  ],
  positionStep: 'Try the first move, then stop for the reply. Small steps help us see the idea.',
  moveTasks: {
    ending: 'We reached the last move. Hop back once and see what changed at the end.',
    check: 'Ears up, a check! Find one legal reply before we look any farther.',
    promotion: 'The little pawn has a new job! Look at the promoted piece, then test the reply.',
    capture: 'Before we collect the piece, peek at the legal recaptures. What can be taken back?',
    castle: 'The king and rook have new places to sit. What changed around the king?',
    book: 'A familiar opening path! Find one useful job this move does before learning its name.',
    sacrifice: 'That offer makes me curious. Follow the saved line to see what happens to the material.',
    alternative: 'Try the other idea one move at a time. Which reply makes the difference?',
    missing: 'We need a deeper look with a legal continuation. I’ll save my guess until then.',
    short: 'We have one recorded candidate. Try a legal reply before taking another little step.',
  },
  ordinaryTasks: [
    'Can we spot one thing this move changed? I’ll start with the piece that moved.',
    'Pause for a tiny guess: what would the other side try next?',
    'Pick one legal reply before peeking at the line. Then let’s compare.',
    'Tell the move’s idea in one sentence. Little explanations count too.',
    'Let’s check the reply before we hop to the next move.',
  ],
  topics: {
    material: 'Count the pieces with me, then peek at king safety. The biggest pile is only part of the picture.',
    opening: 'One opening idea for our little collection: choose a move and explain its job.',
    phases: 'Opening, middle, or end? Pick one little patch of the game and look at its moves.',
    ending: 'That’s the end of the game. We can bring one useful idea along for next time.',
  },
  reactions: {
    Brilliant: [
      'Ooh, a Brilliant to peek at!', 'Tiny wings up for this sacrifice.',
      'A shiny moment in the saved review.', 'This material offer has my full attention.',
      'A Brilliant joins our little collection of ideas.',
    ],
    Great: [
      'A Great find in the review!', 'This important move gets a happy little hop.',
      'Something worth noticing happened here.', 'A standout choice to look at together.',
      'Let’s put a tiny bookmark on this Great move.',
    ],
    Best: [
      'This matches the engine’s first choice.', 'A strong move for our little collection.',
      'Best in the saved review. Let’s see the idea.', 'A neat choice to learn from.',
      'The top recorded candidate is right here.',
    ],
    Excellent: [
      'An excellent little step.', 'Very little was lost here.',
      'A careful choice worth remembering.', 'This stays close to the preferred move.',
      'A nicely played moment to look at.',
    ],
    Good: [
      'A reasonable step forward.', 'This choice gives us something to explore.',
      'Good in the saved review. What comes next?', 'A steady move to follow.',
      'Let’s see the reply to this sensible choice.',
    ],
    Book: [
      'We found a familiar opening path.', 'This move lives in the opening reference.',
      'A known opening move to learn about.', 'One little opening idea for today.',
      'The local opening book recognizes this move.',
    ],
    Inaccuracy: [
      'A tiny chance to improve the idea.', 'Something small slipped by here.',
      'Let’s peek at the alternative.', 'A second look could help with this choice.',
      'There was a little more to find in this position.',
    ],
    Mistake: [
      'Oops, let’s pause and look together.', 'A useful learning spot is right here.',
      'This reply deserves a closer peek.', 'One small step through the line can help.',
      'Let’s give this position another try.',
    ],
    Blunder: [
      'A difficult moment. We can take it slowly.', 'One move does not tell the whole story.',
      'Let’s start with the reply and work it out.', 'This is a good place for a patient retry.',
      'A big change in the review, and one little lesson to find.',
    ],
  },
};
