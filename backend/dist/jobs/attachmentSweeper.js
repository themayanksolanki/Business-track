import { purgeExpiredAttachments } from '../services/attachment.service.js';
// No job queue exists in this codebase (no Bull/Agenda/cron), and the 10s
// pending-delete window is short enough that a plain interval is sufficient —
// this only needs to catch attachments whose countdown expired while no
// request happened to sweep them (see purgeExpiredForTask), not drive the
// countdown itself. Runs on every instance; permanentlyDeleteAttachment's
// delete-first-then-act ordering makes concurrent sweeps across instances safe.
const SWEEP_INTERVAL_MS = 2_000;
export const startAttachmentSweeper = () => {
    const tick = () => {
        purgeExpiredAttachments().catch((err) => {
            console.error('Attachment sweep failed:', err.message);
        });
    };
    tick();
    return setInterval(tick, SWEEP_INTERVAL_MS);
};
//# sourceMappingURL=attachmentSweeper.js.map