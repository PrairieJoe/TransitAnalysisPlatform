export function paginateItems<T>(items: T[], page: number, pageSize: number): { items: T[]; pageCount: number } {
  if (!Number.isInteger(pageSize) || pageSize <= 0) throw new Error('pageSize must be a positive integer');
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const safePage = Math.min(Math.max(0, Math.trunc(page)), pageCount - 1);
  return { items: items.slice(safePage * pageSize, (safePage + 1) * pageSize), pageCount };
}
