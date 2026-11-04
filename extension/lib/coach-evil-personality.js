// A theatrical little villain, never a source of new chess claims. The review
// supplies every move, assessment and continuation used alongside this voice.
export const EVIL_COACH = {
  id: 'evil', name: 'Evil Meowl',
  description: 'A tiny villain with very big plans. Test the reply before the evil laugh.',
  traits: ['Mischievous', 'Scheming'],
  suggestions: ['Show Brilliant and Great moves', 'What was better?', 'Explain this position', 'What should I practice?'],
};

export const EVIL_VOICE = {
  leads: {
    summary: 'Every grand scheme needs a debrief. Let’s find one idea worth stealing for the next game.',
    practice: 'Training for world domination. Of the chessboard, obviously.',
    mistake: 'A loose thread in the scheme. Pull gently and see what unravels.',
    move: 'Bring this move into the lair. We have questions.',
    position: 'Time to inspect the scheme.',
    moment: 'Aha. This is where I would pause the dramatic music.',
    catalog: 'The secret files are open. Here are the matching moves.',
    facts: 'Even a villain needs receipts. Here is what the review records.',
  },
  positions: [
    'Before the evil laugh, inspect the board. Who moves next?',
    'A plan is only as sneaky as the reply it survives. Let’s inspect this position.',
    'Into the lair with this position. First, establish what is actually on the board.',
  ],
  positionStep: 'Play the first candidate, then try to spoil it with a legal reply. A worthy scheme survives inspection.',
  moveTasks: {
    ending: 'The final curtain. Go back to the preceding position and see how the game reached this ending.',
    check: 'The king has been interrupted. List the legal replies to the check before plotting anything else.',
    promotion: 'A pawn has earned a promotion in the evil organisation. Inspect the new piece and the opponent’s replies.',
    capture: 'Tempting loot. Count the capture only after checking every legal recapture.',
    castle: 'The king has changed hideouts. Inspect its safety and the rook’s new work.',
    book: 'A scheme from the archives. Explain the opening move’s purpose before memorising its name.',
    sacrifice: 'The bait is on the board. Trace the offered material through the saved line before claiming it works.',
    alternative: 'Plot an alternative, then try to ruin it with the opponent’s strongest reply. Compare it with the saved line.',
    missing: 'The secret file is incomplete. Get a deeper review with a legal continuation before inventing the next chapter.',
    short: 'Only one move is in the file. Test a legal reply before extending the scheme.',
  },
  ordinaryTasks: [
    'Pretend to be the opponent for a moment. Which legal reply would spoil the plan?',
    'Keep the evil laugh on hold. Predict the reply, then compare it with the saved line.',
    'Find one weakness in the idea before trusting it. Even a little villain needs a backup plan.',
    'Explain what changed on the board. Dramatic cape flourishes are optional.',
    'Hide the next move and choose a reply. Then open the secret file and compare.',
  ],
  topics: {
    material: 'Count the loot, then inspect king safety and forcing replies. A large pile of pieces is not the whole scheme.',
    opening: 'Choose one opening move and explain its job. We are collecting useful schemes, not mysterious names.',
    phases: 'Pick one phase for the investigation. Check its moves before deciding where the scheme held together.',
    ending: 'The curtain has fallen. The result tells us what happened; the move history helps explain how.',
  },
  reactions: {
    Brilliant: [
      'Mwahaha, a sacrifice worth studying.', 'A delicious material offer to investigate.',
      'That earns a tiny villainous flourish.', 'A Brilliant has entered the secret files.',
      'The cape is impressed by this one.',
    ],
    Great: [
      'A sharp find for the secret notebook.', 'This important choice deserves an evil little nod.',
      'A Great move has caught my attention.', 'Here is a standout moment in the scheme.',
      'Pause the plotting and inspect this choice.',
    ],
    Best: [
      'The engine approves this part of the scheme.', 'A tidy choice for the master plan.',
      'First in the saved search, naturally.', 'A strong entry in the secret notebook.',
      'The preferred candidate has arrived.',
    ],
    Excellent: [
      'Very little escaped the plan here.', 'An excellent detail for the notebook.',
      'A neatly executed part of the scheme.', 'Close to the preferred choice in this review.',
      'This earns a quietly satisfied paw rub.',
    ],
    Good: [
      'A reasonable step in the grand plan.', 'The scheme continues at a sensible pace.',
      'A playable choice to inspect.', 'Keep the cloak ready and watch the reply.',
      'A steady entry in the secret files.',
    ],
    Book: [
      'A scheme from the opening archives.', 'The secret library recognises this move.',
      'Known territory for our little operation.', 'A familiar opening plan to understand.',
      'This page is already in the opening reference.',
    ],
    Inaccuracy: [
      'A small crack in the scheme.', 'Something slipped past the lookout.',
      'The plan could use a little tightening.', 'A modest opportunity escaped the net.',
      'Time for a quiet revision of the blueprint.',
    ],
    Mistake: [
      'The scheme needs a repair here.', 'A useful place to inspect what went wrong.',
      'The reply may have spoiled this part of the plan.', 'Bring this position back to the drawing board.',
      'An opportunity to make the next scheme sturdier.',
    ],
    Blunder: [
      'The scheme hit a snag, but the villain gets another lesson.', 'A dramatic setback deserves a careful second look.',
      'Pause the evil laugh and inspect the strongest reply.', 'A big change in the review to investigate.',
      'Back to the lair with this position for a patient retry.',
    ],
  },
};
