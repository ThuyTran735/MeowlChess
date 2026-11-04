const PORTRAITS = Object.freeze({
  meowl: new URL('../icons/coaches/MeowlChess-coach-meowl.svg', import.meta.url).href,
  owl: new URL('../icons/coaches/MeowlChess-coach-owl.svg', import.meta.url).href,
  paws: new URL('../icons/coaches/MeowlChess-coach-paws.svg', import.meta.url).href,
  mellow: new URL('../icons/coaches/MeowlChess-coach-mellow.svg', import.meta.url).href,
  scout: new URL('../icons/coaches/MeowlChess-coach-scout.svg', import.meta.url).href,
  evil: new URL('../icons/coaches/MeowlChess-coach-evil.svg', import.meta.url).href,
});

// Keep stored IDs stable. Every coach now has a distinct, locally bundled outfit.
const ARTWORK = Object.freeze({ meowl: 'meowl', owl: 'owl', paws: 'paws', mellow: 'mellow', scout: 'scout', evil: 'evil' });
export function coachArtworkId(id) {
  return typeof id === 'string' && Object.hasOwn(ARTWORK, id) ? ARTWORK[id] : 'meowl';
}

export function coachPortraitUrl(id) {
  return PORTRAITS[coachArtworkId(id)];
}

export function coachPuppetUrl(id) {
  return new URL(`../icons/coaches/MeowlChess-coach-${coachArtworkId(id)}-base.svg`, import.meta.url).href;
}
