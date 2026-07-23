// Server-side source of truth for the platform badge — never trust a
// client-supplied platform value, always derive it from the URL itself.
export const detectMeetingPlatform = (url) => {
    let hostname;
    try {
        hostname = new URL(url).hostname.toLowerCase();
    }
    catch {
        return 'OTHER';
    }
    if (hostname === 'zoom.us' || hostname.endsWith('.zoom.us'))
        return 'ZOOM';
    if (hostname === 'meet.google.com')
        return 'GOOGLE_MEET';
    if (hostname === 'teams.microsoft.com' || hostname === 'teams.live.com')
        return 'TEAMS';
    if (hostname === 'webex.com' || hostname.endsWith('.webex.com'))
        return 'WEBEX';
    return 'OTHER';
};
//# sourceMappingURL=meetingLink.js.map