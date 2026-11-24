import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

/**
 * Editing an Eventsli library map in the Venue Builder (2026-11-24): the map
 * loads into the editor's draft and saves back into the library — the room
 * only, its colour groups kept, nothing of an event's.
 */
const api = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(async () => ({})) }));
vi.mock('../src/app/utils/apiClient', () => api);

import { useMapDraft } from '../src/app/organizer/events/[id]/map/useMapDraft';
import { useStudioDraft } from '../src/app/organizer/events/[id]/map/studio/useStudioDraft';
import { useTemplatePersistence } from '../src/app/organizer/events/[id]/map/useTemplatePersistence';

const template = {
  id: 'tpl-1',
  name: 'Golden Tree Banquet',
  data: {
    version: 1,
    layout: {
      world: { width: 1000, height: 700 },
      zones: [{ id: 'z1', kind: 'stage', x: 40, y: 5, w: 200, h: 40, rotation: 0 }],
      tableStyles: { t1: { fill: '#d4a017' } },
    },
    groups: [{ key: 'g1', name: 'VIP', color: '#d4a017' }],
    tables: [
      { label: 'T1', seatCount: 10, shape: 'round', position: { x: 20, y: 40, rotation: 0 }, groupKey: 'g1' },
      { label: 'T2', seatCount: 8, shape: 'round', position: { x: 60, y: 40, rotation: 0 } },
    ],
  },
};

function useHarness() {
  const draft = useMapDraft();
  const studioDraft = useStudioDraft();
  const io = useTemplatePersistence({ templateId: 'tpl-1', draft, studioDraft, onFrame: () => {} });
  return { draft, io };
}

beforeEach(() => { api.get.mockReset(); api.put.mockClear(); api.get.mockResolvedValue(template); });

describe('a library map in the Venue Builder', () => {
  it('loads the room into the draft, groups as the categories', async () => {
    const { result } = renderHook(() => useHarness());
    await waitFor(() => expect(result.current.io.loading).toBe(false));
    expect(result.current.draft.tables.map((t) => t.label)).toEqual(['T1', 'T2']);
    expect(result.current.draft.tables[0].categoryId).toBe('g1');
    expect(result.current.draft.tables[0].style).toEqual({ fill: '#d4a017' });
    expect(result.current.io.categories).toEqual([{ id: 'g1', name: 'VIP', color: '#d4a017' }]);
    expect(result.current.io.tiers).toEqual([]);
    expect(result.current.io.eventTitle).toBe('Golden Tree Banquet');
  });

  it('saves the edited room back into the library, as library data', async () => {
    const { result } = renderHook(() => useHarness());
    await waitFor(() => expect(result.current.io.loading).toBe(false));
    const key = result.current.draft.tables[1].localKey;
    act(() => { result.current.draft.updateTable(key, { seatCount: 12, position: { x: 70, y: 50, rotation: 90 } }); });
    await act(async () => { await result.current.io.save(); });

    expect(api.put).toHaveBeenCalledTimes(1);
    const [url, body] = api.put.mock.calls[0];
    expect(url).toBe('/admin/venue-maps/tpl-1/map');
    expect(body.edited).toBe(true);
    expect(body.data.tables).toEqual([
      { label: 'T1', seatCount: 10, shape: 'round', position: { x: 20, y: 40, rotation: 0 }, groupKey: 'g1' },
      { label: 'T2', seatCount: 12, shape: 'round', position: { x: 70, y: 50, rotation: 90 } },
    ]);
    expect(body.data.groups).toEqual([{ key: 'g1', name: 'VIP', color: '#d4a017' }]);
    expect(body.data.layout.zones).toHaveLength(1);
    expect(body.data.layout.tableStyles.t1).toEqual({ fill: '#d4a017' });
    // Nothing of an event's travels: no prices, ticket types or passwords.
    expect(JSON.stringify(body.data)).not.toMatch(/price|tierId|password/i);
  });
});
