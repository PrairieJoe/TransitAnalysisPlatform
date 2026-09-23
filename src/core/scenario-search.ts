export interface ScenarioSearchOptionLike {
  value: string;
  label: string;
  meta?: string;
  searchText?: string;
}

function normalizeSearch(value: string): string {
  return value.trim().normalize('NFKC').toLocaleLowerCase('ko');
}

function editDistance(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    let diagonal = previous[0];
    previous[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const nextDiagonal = previous[rightIndex];
      previous[rightIndex] = Math.min(
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + 1,
        diagonal + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1)
      );
      diagonal = nextDiagonal;
    }
  }
  return previous[right.length];
}

function fuzzyDistance(query: string, value: string): number | undefined {
  if (query.length < 3 || !value) return undefined;
  const maxDistance = Math.max(1, Math.floor(query.length / 3));
  const lengths = [Math.max(1, query.length - 1), query.length, query.length + 1];
  let best = Number.POSITIVE_INFINITY;
  for (const length of lengths) {
    for (let index = 0; index + length <= value.length; index += 1) best = Math.min(best, editDistance(query, value.slice(index, index + length)));
  }
  return best <= maxDistance ? best : undefined;
}

export function rankScenarioSearchOptions<T extends ScenarioSearchOptionLike>(options: T[], query: string): T[] {
  const normalizedQuery = normalizeSearch(query);
  if (!normalizedQuery) return options;
  return options
    .map((option, index) => {
      const value = normalizeSearch(option.value);
      const label = normalizeSearch(option.label);
      const fields = [value, label, normalizeSearch(option.meta ?? ''), normalizeSearch(option.searchText ?? '')];
      let rank: [number, number, number] | undefined;
      if (value === normalizedQuery) rank = [0, 0, 0];
      else if (label === normalizedQuery) rank = [1, 0, 0];
      else if (value.startsWith(normalizedQuery)) rank = [2, 0, value.length];
      else if (label.startsWith(normalizedQuery)) rank = [3, 0, label.length];
      else {
        const contains = fields
          .map((field, fieldIndex) => ({ fieldIndex, position: field.indexOf(normalizedQuery) }))
          .filter((candidate) => candidate.position >= 0)
          .sort((left, right) => left.fieldIndex - right.fieldIndex || left.position - right.position)[0];
        if (contains) rank = [4, contains.fieldIndex, contains.position];
        else {
          const fuzzy = [label]
            .map((field) => ({ distance: fuzzyDistance(normalizedQuery, field), fieldIndex: 1 }))
            .filter((candidate): candidate is { distance: number; fieldIndex: number } => candidate.distance !== undefined)
            .sort((left, right) => left.distance - right.distance || left.fieldIndex - right.fieldIndex)[0];
          if (fuzzy) rank = [5, fuzzy.distance, fuzzy.fieldIndex];
        }
      }
      return rank ? { option, index, rank } : undefined;
    })
    .filter((candidate): candidate is { option: T; index: number; rank: [number, number, number] } => Boolean(candidate))
    .sort((left, right) => left.rank[0] - right.rank[0] || left.rank[1] - right.rank[1] || left.rank[2] - right.rank[2] || left.index - right.index)
    .map(({ option }) => option);
}
