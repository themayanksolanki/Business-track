// Only 'daily' is implemented — the other branches exist so the storage/API
// layer (metricTrackingController.ts) doesn't need reshaping when weekly/
// monthly/quarterly/yearly tracking is actually built, not because they work
// yet. Each would need its own period-key scheme (ISO week number, month
// number, quarter number, or a single "period" for a whole year).
export function periodCount(frequency, year, month) {
    if (frequency === 'daily') {
        if (!month)
            throw new Error('periodCount: month is required for daily frequency');
        // Day 0 of the next month == the last day of `month`.
        return new Date(year, month, 0).getDate();
    }
    throw new Error(`periodCount: frequency '${frequency}' is not implemented yet`);
}
//# sourceMappingURL=metricPeriods.js.map