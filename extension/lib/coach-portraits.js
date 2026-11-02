const PORTRAITS = Object.freeze({
  meowl: new URL('../icons/coaches/MeowlChess-coach-meowl.png', import.meta.url).href,
  owl: new URL('../icons/coaches/MeowlChess-coach-owl.png', import.meta.url).href,
  paws: new URL('../icons/coaches/MeowlChess-coach-paws.png', import.meta.url).href,
});

// New personalities share the approved Meowl artwork; stored "owl" IDs remain compatible.
const ARTWORK = Object.freeze({ meowl: 'meowl', owl: 'owl', paws: 'paws', mellow: 'meowl', scout: 'paws' });
export function coachArtworkId(id) {
  return typeof id === 'string' && Object.hasOwn(ARTWORK, id) ? ARTWORK[id] : 'meowl';
}

export function coachPortraitUrl(id) {
  return PORTRAITS[coachArtworkId(id)];
}
