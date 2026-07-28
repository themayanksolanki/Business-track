import { addDays } from 'date-fns';
import { CalendarOccurrence } from '../../models/event.model';
import { chunkIntoWeeks, isAllDayOrMultiDay, layoutRow, resolveEventColor } from './calendar-layout.util';

function mockEvent(overrides: Partial<CalendarOccurrence> & { title: string; start: string; end: string }): CalendarOccurrence {
  return {
    id: 1,
    description: '',
    location: null,
    allDay: false,
    color: null,
    category: null,
    owner: {} as CalendarOccurrence['owner'],
    calendar: { id: 1, name: 'Default', color: '#3b82f6' },
    meetingLinkUrl: null,
    meetingLinkTitle: null,
    meetingLinkPlatform: null,
    visibility: 'standard',
    busyStatus: 'busy',
    guests: [],
    isRecurring: false,
    originalStart: overrides.start,
    isException: false,
    ...overrides,
  } as CalendarOccurrence;
}

// A Monday-start week: 2026-06-01 .. 2026-06-07
const WEEK1 = Array.from({ length: 7 }, (_, i) => addDays(new Date(2026, 5, 1), i));
const WEEK2 = Array.from({ length: 7 }, (_, i) => addDays(new Date(2026, 5, 8), i));

describe('resolveEventColor', () => {
  it('prefers the event color over category/calendar', () => {
    const e = mockEvent({
      title: 'A',
      start: '2026-06-01T09:00:00.000Z',
      end: '2026-06-01T10:00:00.000Z',
      color: '#ff0000',
      category: { id: 1, name: 'Cat', color: '#00ff00' },
    });
    expect(resolveEventColor(e)).toBe('#ff0000');
  });

  it('falls back to category, then calendar, then default', () => {
    const noColor = mockEvent({ title: 'A', start: '2026-06-01T09:00:00.000Z', end: '2026-06-01T10:00:00.000Z' });
    expect(resolveEventColor(noColor)).toBe('#3b82f6');

    const withCategory = mockEvent({
      title: 'A',
      start: '2026-06-01T09:00:00.000Z',
      end: '2026-06-01T10:00:00.000Z',
      category: { id: 1, name: 'Cat', color: '#00ff00' },
    });
    expect(resolveEventColor(withCategory)).toBe('#00ff00');
  });
});

describe('isAllDayOrMultiDay', () => {
  it('is true for allDay events even if start/end are the same day', () => {
    const e = mockEvent({ title: 'A', start: '2026-06-01T00:00:00.000Z', end: '2026-06-01T23:59:00.000Z', allDay: true });
    expect(isAllDayOrMultiDay(e)).toBe(true);
  });

  it('is true for a timed event spanning two calendar days', () => {
    // A gap wider than 24h between two fixed instants must cross a local
    // midnight in any single timezone, so this assertion holds regardless
    // of the machine's local timezone running the test.
    const e = mockEvent({ title: 'A', start: '2026-06-01T22:00:00.000Z', end: '2026-06-03T02:00:00.000Z' });
    expect(isAllDayOrMultiDay(e)).toBe(true);
  });

  it('is false for a same-day timed event', () => {
    const e = mockEvent({ title: 'A', start: '2026-06-01T09:00:00.000Z', end: '2026-06-01T10:00:00.000Z' });
    expect(isAllDayOrMultiDay(e)).toBe(false);
  });
});

describe('chunkIntoWeeks', () => {
  it('splits a flat day list into groups of 7', () => {
    const days = [...WEEK1, ...WEEK2];
    const weeks = chunkIntoWeeks(days);
    expect(weeks.length).toBe(2);
    expect(weeks[0].length).toBe(7);
    expect(weeks[1].length).toBe(7);
  });
});

describe('layoutRow', () => {
  it('places a single-day event as a one-column-span bar', () => {
    const e = mockEvent({ title: 'Single', start: '2026-06-02T09:00:00.000Z', end: '2026-06-02T10:00:00.000Z' });
    const layout = layoutRow(WEEK1, [e], 3);
    expect(layout.placements.length).toBe(1);
    expect(layout.placements[0].startCol).toBe(1);
    expect(layout.placements[0].span).toBe(1);
    expect(layout.hasOverflow).toBe(false);
  });

  it('spans a multi-day event across its full column range', () => {
    const e = mockEvent({ title: 'Multi', start: '2026-06-02T09:00:00.000Z', end: '2026-06-04T17:00:00.000Z' });
    const layout = layoutRow(WEEK1, [e], 3);
    expect(layout.placements.length).toBe(1);
    expect(layout.placements[0].startCol).toBe(1);
    expect(layout.placements[0].span).toBe(3);
  });

  it('assigns overlapping events to separate lanes', () => {
    const a = mockEvent({ title: 'A', start: '2026-06-01T09:00:00.000Z', end: '2026-06-03T09:00:00.000Z' });
    const b = mockEvent({ title: 'B', start: '2026-06-02T09:00:00.000Z', end: '2026-06-02T17:00:00.000Z' });
    const layout = layoutRow(WEEK1, [a, b], 3);
    const laneA = layout.placements.find((p) => p.event === a)!.lane;
    const laneB = layout.placements.find((p) => p.event === b)!.lane;
    expect(laneA).not.toBe(laneB);
  });

  it('reuses a lane once its prior event has ended', () => {
    const a = mockEvent({ title: 'A', start: '2026-06-01T09:00:00.000Z', end: '2026-06-01T17:00:00.000Z' });
    const b = mockEvent({ title: 'B', start: '2026-06-02T09:00:00.000Z', end: '2026-06-02T17:00:00.000Z' });
    const layout = layoutRow(WEEK1, [a, b], 3);
    const laneA = layout.placements.find((p) => p.event === a)!.lane;
    const laneB = layout.placements.find((p) => p.event === b)!.lane;
    expect(laneA).toBe(laneB);
  });

  it('collapses events beyond maxVisibleLanes into hiddenCountByDay and reserves one lane for the +more chip', () => {
    const events = Array.from({ length: 4 }, (_, i) =>
      mockEvent({ title: `E${i}`, start: '2026-06-01T09:00:00.000Z', end: '2026-06-01T10:00:00.000Z' })
    );
    const layout = layoutRow(WEEK1, events, 3);
    expect(layout.hasOverflow).toBe(true);
    expect(layout.visibleLanes).toBe(2);
    expect(layout.placements.length).toBe(2);
    expect(layout.hiddenCountByDay[0]).toBe(2);
    expect(layout.hiddenCountByDay[1]).toBe(0);
  });

  it('lays out each week row independently, so a week-spanning event gets a fresh lane in the next row', () => {
    // Wed of WEEK1 through Mon of WEEK2.
    const e = mockEvent({ title: 'Spanning', start: '2026-06-03T09:00:00.000Z', end: '2026-06-08T17:00:00.000Z' });
    const otherInWeek2 = mockEvent({ title: 'Other', start: '2026-06-08T09:00:00.000Z', end: '2026-06-08T17:00:00.000Z' });

    const week1Layout = layoutRow(WEEK1, [e], 3);
    expect(week1Layout.placements[0].startCol).toBe(2);
    expect(week1Layout.placements[0].span).toBe(5); // Wed..Sun, clamped to WEEK1's last column

    const week2Layout = layoutRow(WEEK2, [e, otherInWeek2], 3);
    const spanningPlacement = week2Layout.placements.find((p) => p.event === e)!;
    expect(spanningPlacement.startCol).toBe(0);
    expect(spanningPlacement.span).toBe(1); // only Monday falls inside WEEK2
    // The two events overlap on Monday, so they must land in different lanes
    // even though `e` was in lane 0 in WEEK1 — layout is independent per row.
    const otherPlacement = week2Layout.placements.find((p) => p.event === otherInWeek2)!;
    expect(otherPlacement.lane).not.toBe(spanningPlacement.lane);
  });
});
