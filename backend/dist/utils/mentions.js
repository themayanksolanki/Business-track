// Validates + dedupes client-submitted mentions against the project's actual
// member list (never trust client-supplied user ids), keeping the first-seen
// entry per userId so mentioning the same person twice collapses to one.
export const filterValidMentions = (mentions, memberIds) => {
    if (!Array.isArray(mentions))
        return [];
    const seen = new Set();
    const valid = [];
    for (const m of mentions) {
        const userId = Number(m?.userId);
        if (!userId || !memberIds.has(userId) || seen.has(userId))
            continue;
        seen.add(userId);
        valid.push({ userId, username: String(m.username ?? '') });
    }
    return valid;
};
//# sourceMappingURL=mentions.js.map