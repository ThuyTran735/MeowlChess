/** Exhaust each coach's idle repertoire before reshuffling; never repeat at the join. */
export function createCoachIdleCycle(random = Math.random) {
  const bags = new Map();
  const roll = () => {
    const value = Number(random());
    return Number.isFinite(value) ? Math.max(0, Math.min(1 - Number.EPSILON, value)) : 0;
  };
  return {
    next(coachId, count) {
      count = Number.isInteger(count) && count > 0 ? count : 1;
      let state = bags.get(coachId);
      if (!state || state.count !== count) {
        state = { count, remaining: [], last: -1 };
        bags.set(coachId, state);
      }
      if (!state.remaining.length) {
        state.remaining = Array.from({ length: count }, (_, index) => index);
        for (let index = count - 1; index > 0; index--) {
          const other = Math.floor(roll() * (index + 1));
          [state.remaining[index], state.remaining[other]] = [state.remaining[other], state.remaining[index]];
        }
        if (count > 1 && state.remaining.at(-1) === state.last) {
          [state.remaining[0], state.remaining[count - 1]] = [state.remaining[count - 1], state.remaining[0]];
        }
      }
      state.last = state.remaining.pop();
      return state.last;
    },
    clear() { bags.clear(); },
  };
}
