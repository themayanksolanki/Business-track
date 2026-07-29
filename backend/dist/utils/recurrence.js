import { addDays, addMonths, addYears, startOfWeek } from 'date-fns';
// Defensive backstop independent of count/until, so a malformed rule can't
// hang a request — 1000 candidate dates comfortably outlasts any realistic
// calendar view (e.g. ~19 years of weekly-single-weekday occurrences).
const MAX_ITERATIONS = 1000;
// Yields candidate occurrence start dates in strictly increasing order,
// starting from eventStart, ignoring count/until/range (those are applied by
// the caller). Weekly is the tricky case: "every 2 weeks on Mon/Wed" steps in
// whole-week blocks of size `interval` measured from the week containing
// eventStart, emitting every matching weekday within each included week —
// walking forward by `interval` weeks and expanding weekdays naively would
// misalign whenever eventStart isn't itself the first byWeekday day of its
// week.
function* candidateDates(rule, eventStart) {
    const interval = Math.max(1, rule.interval || 1);
    if (rule.frequency === 'weekly') {
        const weekStart = startOfWeek(eventStart); // Sunday = 0, matches byWeekday's convention
        const weekdays = Array.from(new Set(rule.byWeekday.length ? rule.byWeekday : [eventStart.getDay()])).sort((a, b) => a - b);
        for (let weekIndex = 0;; weekIndex++) {
            if (weekIndex % interval !== 0)
                continue;
            const weekBase = addDays(weekStart, weekIndex * 7);
            for (const d of weekdays) {
                const occ = addDays(weekBase, d);
                // Week 0 may contain byWeekday entries earlier in the week than
                // eventStart itself — those slots are before the series started.
                if (occ.getTime() < eventStart.getTime())
                    continue;
                yield occ;
            }
        }
    }
    else {
        for (let i = 0;; i++) {
            const step = i * interval;
            yield rule.frequency === 'daily'
                ? addDays(eventStart, step)
                : rule.frequency === 'monthly'
                    ? addMonths(eventStart, step) // date-fns clamps month-end overflow (Jan 31 -> Feb 28/29), not skip
                    : addYears(eventStart, step);
        }
    }
}
export function generateOccurrences(rule, eventStart, eventEnd, rangeStart, rangeEnd) {
    const duration = eventEnd.getTime() - eventStart.getTime();
    const maxCount = rule.count ?? Infinity;
    const until = rule.until;
    const results = [];
    const iter = candidateDates(rule, eventStart);
    let emitted = 0;
    for (let guard = 0; guard < MAX_ITERATIONS; guard++) {
        const next = iter.next();
        if (next.done)
            break;
        const occStart = next.value;
        if (until && occStart.getTime() > until.getTime())
            break;
        emitted++;
        if (emitted > maxCount)
            break;
        // Candidates are strictly increasing, so once one is past rangeEnd no
        // later candidate can be in range either.
        if (occStart.getTime() > rangeEnd.getTime())
            break;
        const occEnd = new Date(occStart.getTime() + duration);
        if (occEnd.getTime() >= rangeStart.getTime()) {
            results.push({ originalStart: occStart, start: occStart, end: occEnd });
        }
    }
    return results;
}
// Used to validate that a client-supplied originalStart actually corresponds
// to a real generated slot before creating an exception for it — otherwise
// the occurrence routes become a way to create exceptions for timestamps
// that were never a real occurrence.
export function isGeneratedOccurrence(rule, eventStart, eventEnd, originalStart) {
    const probe = generateOccurrences(rule, eventStart, eventEnd, new Date(originalStart.getTime() - 1), new Date(originalStart.getTime() + 1));
    return probe.some((o) => o.originalStart.getTime() === originalStart.getTime());
}
//# sourceMappingURL=recurrence.js.map