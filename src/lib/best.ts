/** The index of the item `score` rates highest, the first of them on a tie; 0 for no items. */
export function bestIndexBy<T>(items: readonly T[], score: (item: T) => number): number {
  let bestIndex = 0;
  let bestScore = items[0] === undefined ? 0 : score(items[0]);
  for (const [index, item] of items.entries()) {
    const itemScore = score(item);
    if (itemScore > bestScore) {
      bestIndex = index;
      bestScore = itemScore;
    }
  }
  return bestIndex;
}
