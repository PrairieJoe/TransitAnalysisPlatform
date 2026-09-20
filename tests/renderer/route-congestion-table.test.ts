import { describe, expect, it } from 'vitest';
import { paginateItems } from '../../src/renderer/route-congestion-table';

describe('route congestion table pagination', () => {
  it('bounds one rendered page while preserving the full result count', () => {
    const items = Array.from({ length: 251 }, (_, index) => index);

    expect(paginateItems(items, 0, 250)).toEqual({ items: items.slice(0, 250), pageCount: 2 });
    expect(paginateItems(items, 1, 250)).toEqual({ items: [250], pageCount: 2 });
  });
});
