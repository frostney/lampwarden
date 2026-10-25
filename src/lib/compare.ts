// Comparators for sort() and toSorted(). compareCodeUnits orders strings as sort() does without one (by UTF-16 code
// unit, not by locale), so a sort that feeds a hash, a cache key or a replay keeps the order it had.

export function compareCodeUnits(left: string, right: string): number {
  return Number(left > right) - Number(left < right);
}

export function compareNumbers(left: number, right: number): number {
  return left - right;
}
