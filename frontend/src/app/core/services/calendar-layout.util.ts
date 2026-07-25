import { parseISO, isSameDay, startOfDay, endOfDay, differenceInCalendarDays } from 'date-fns';
import { CalendarOccurrence } from '../../models/event.model';

const DEFAULT_EVENT_COLOR = '#3b82f6';

export function resolveEventColor(event: CalendarOccurrence): string {
  return event.color || event.category?.color || event.calendar?.color || DEFAULT_EVENT_COLOR;
}

export function isAllDayOrMultiDay(event: CalendarOccurrence): boolean {
  return event.allDay || !isSameDay(parseISO(event.start), parseISO(event.end));
}

export function overlapsRange(event: CalendarOccurrence, rangeStart: Date, rangeEnd: Date): boolean {
  return parseISO(event.start) <= rangeEnd && parseISO(event.end) >= rangeStart;
}

// Splits a flat list of contiguous days (e.g. eachDayOfInterval's output for
// a 6-week month grid) into 7-day rows for the month grid.
export function chunkIntoWeeks(days: Date[]): Date[][] {
  const weeks: Date[][] = [];
  for (let i = 0; i < days.length; i += 7) {
    weeks.push(days.slice(i, i + 7));
  }
  return weeks;
}

export interface StrapPlacement {
  event: CalendarOccurrence;
  lane: number;
  startCol: number;
  span: number;
}

export interface RowLayout {
  visibleLanes: number;
  placements: StrapPlacement[];
  // Same length as `days` — count of events touching that day that didn't
  // make it into a visible lane, for a per-day "+N more" chip.
  hiddenCountByDay: number[];
  hasOverflow: boolean;
}

interface Candidate {
  event: CalendarOccurrence;
  startCol: number;
  endCol: number;
}

// Lays out `events` overlapping `days` into horizontal lanes (greedy
// interval-graph coloring, re-run independently per row — a multi-day event
// spanning a week boundary gets a fresh lane assignment in each week's row,
// matching how Google Calendar/Teamup-style month grids behave), capping at
// `maxVisibleLanes` and collapsing the rest into per-day hidden counts.
export function layoutRow(days: Date[], events: CalendarOccurrence[], maxVisibleLanes: number): RowLayout {
  if (days.length === 0) {
    return { visibleLanes: 0, placements: [], hiddenCountByDay: [], hasOverflow: false };
  }

  const rangeStart = startOfDay(days[0]);
  const rangeEnd = endOfDay(days[days.length - 1]);
  const lastCol = days.length - 1;

  const candidates: Candidate[] = events
    .filter((e) => overlapsRange(e, rangeStart, rangeEnd))
    .map((e) => ({
      event: e,
      startCol: Math.max(0, differenceInCalendarDays(parseISO(e.start), rangeStart)),
      endCol: Math.min(lastCol, differenceInCalendarDays(parseISO(e.end), rangeStart)),
    }));

  // Earlier-starting, then longer-spanning, events claim lower lane numbers
  // first so multi-day bars aren't needlessly fragmented across lanes.
  candidates.sort((a, b) => {
    if (a.startCol !== b.startCol) return a.startCol - b.startCol;
    const spanA = a.endCol - a.startCol;
    const spanB = b.endCol - b.startCol;
    if (spanA !== spanB) return spanB - spanA;
    return a.event.title.localeCompare(b.event.title);
  });

  const laneEnds: number[] = [];
  const laneOf = new Map<Candidate, number>();

  for (const c of candidates) {
    let lane = laneEnds.findIndex((endCol) => endCol < c.startCol);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(c.endCol);
    } else {
      laneEnds[lane] = c.endCol;
    }
    laneOf.set(c, lane);
  }

  const actualLaneCount = laneEnds.length;
  const hasOverflow = actualLaneCount > maxVisibleLanes;
  // One visible slot is given up to the "+more" chip once there's overflow.
  const visibleLanes = hasOverflow ? Math.max(0, maxVisibleLanes - 1) : actualLaneCount;

  const placements: StrapPlacement[] = [];
  const hiddenCountByDay = new Array(days.length).fill(0);

  for (const c of candidates) {
    const lane = laneOf.get(c)!;
    if (lane < visibleLanes) {
      placements.push({ event: c.event, lane, startCol: c.startCol, span: c.endCol - c.startCol + 1 });
    } else {
      for (let day = c.startCol; day <= c.endCol; day++) {
        hiddenCountByDay[day]++;
      }
    }
  }

  return { visibleLanes, placements, hiddenCountByDay, hasOverflow };
}

export function formatStrapLabel(occurrence: CalendarOccurrence): string {
  return occurrence.title;
}
