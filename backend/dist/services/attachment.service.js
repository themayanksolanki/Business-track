import prisma from '../lib/prisma.js';
import AppError from '../utils/AppError.js';
import { destroyBlob, cloudinaryDownloadUrl } from '../utils/blobStorage.js';
import { getS3DownloadUrl } from '../lib/s3.js';
import { ACCESS_INCLUDE_WITH_ROLE, loadProjectOrFail, loadItemOrFail } from './projectAccess.service.js';
import { getTaskAccessLevel } from '../utils/access.js';
export const PENDING_DELETE_MS = 10_000;
export const UPLOADED_BY_SELECT = { id: true, username: true, email: true, role: true };
const LINK_EXTENSION_MIME_TYPES = {
    pdf: 'application/pdf',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    mp4: 'video/mp4',
    webm: 'video/webm',
    mov: 'video/quicktime',
    mkv: 'video/x-matroska',
};
// Guessing from the extension lets a pasted PDF/image/video link reuse the
// exact same preview branch (image/video/pdf) that an uploaded file gets in
// the attachment viewer, instead of a link needing its own bespoke UI. A
// generic page link (no recognized extension) falls back to 'text/html',
// which the viewer treats as a best-effort iframe embed.
const guessMimeTypeFromUrl = (url) => {
    try {
        const pathname = new URL(url).pathname;
        const ext = pathname.split('.').pop()?.toLowerCase();
        return (ext && LINK_EXTENSION_MIME_TYPES[ext]) || 'text/html';
    }
    catch {
        return 'text/html';
    }
};
// Relaying the file through this server (fetch from the provider, then
// re-stream to the client) was timing out on real-world PDFs — a slow
// connection or an intermediary (Cloudflare/Render) killing a long-lived
// proxied transfer mid-stream. Handing back a URL the browser fetches
// directly (a presigned S3 URL, or Cloudinary's already-public one) means
// this server only ever serves a small JSON response, never the file bytes.
//
// Preview (`viewUrl`) and forced download (`downloadUrl`) need different
// Content-Disposition, so both are returned rather than toggling one URL —
// presigning twice is cheap (local HMAC, no extra AWS round-trip). The view
// URL gets a longer expiry since it's now embedded directly as an <img>/
// <video>/<iframe> src and may stay in active use well past 5 minutes
// (video seeking, a long-open PDF); the download URL is consumed immediately
// via a single navigation, so it stays short-lived.
export const getAttachmentDownloadInfo = async (attachment) => {
    // A pasted link has nothing to sign or proxy — it already points at
    // wherever the user's browser can reach it, so view/download are the
    // same URL untouched.
    if (attachment.kind === 'link') {
        return {
            viewUrl: attachment.url,
            downloadUrl: attachment.url,
            mimeType: attachment.mimeType,
            fileName: attachment.fileName,
        };
    }
    if (attachment.storage === 's3') {
        const [viewUrl, downloadUrl] = await Promise.all([
            getS3DownloadUrl({
                key: attachment.publicId,
                mimeType: attachment.mimeType,
                fileName: attachment.fileName,
                disposition: 'inline',
                expiresIn: 3600,
            }),
            getS3DownloadUrl({
                key: attachment.publicId,
                mimeType: attachment.mimeType,
                fileName: attachment.fileName,
                disposition: 'attachment',
                expiresIn: 300,
            }),
        ]);
        return { viewUrl, downloadUrl, mimeType: attachment.mimeType, fileName: attachment.fileName };
    }
    return {
        viewUrl: attachment.url,
        downloadUrl: cloudinaryDownloadUrl(attachment.url),
        mimeType: attachment.mimeType,
        fileName: attachment.fileName,
    };
};
// Delete is the concurrency guard: whichever caller (the interval sweep, or a
// request-triggered sweep) wins the race actually removes the row and gets to
// destroy the blob and decrement the count; the loser's delete throws P2025
// (already gone) and just returns, so a task's attachmentCount never gets
// double-decremented for the same attachment.
export const permanentlyDeleteAttachment = async (attachment) => {
    try {
        await prisma.attachment.delete({ where: { id: attachment.id } });
    }
    catch (err) {
        if (err.code === 'P2025')
            return;
        throw err;
    }
    await destroyBlob(attachment);
    if (attachment.taskId) {
        await prisma.task
            .update({ where: { id: attachment.taskId }, data: { attachmentCount: { decrement: 1 } } })
            .catch(() => { });
    }
    else if (attachment.projectItemId) {
        await prisma.projectItem
            .update({ where: { id: attachment.projectItemId }, data: { attachmentCount: { decrement: 1 } } })
            .catch(() => { });
    }
};
export const purgeExpiredAttachments = async () => {
    const expired = await prisma.attachment.findMany({ where: { pendingDeleteAt: { lte: new Date() } } });
    for (const attachment of expired) {
        await permanentlyDeleteAttachment(attachment);
    }
};
// Catches up any attachment whose countdown expired while nobody was looking
// (page closed, sweep hasn't ticked yet) before a list endpoint returns.
// Project-level attachments have no pending-delete window (see
// deleteProjectAttachment) so there's no `{ projectId }` variant.
export const purgeExpiredFor = async (where) => {
    const expired = await prisma.attachment.findMany({ where: { ...where, pendingDeleteAt: { lte: new Date() } } });
    for (const attachment of expired) {
        await permanentlyDeleteAttachment(attachment);
    }
};
export const listAttachments = (where) => prisma.attachment.findMany({
    where,
    include: { uploadedBy: { select: UPLOADED_BY_SELECT } },
    orderBy: { createdAt: 'desc' },
});
export async function loadAttachmentOrFail(where) {
    const attachment = await prisma.attachment.findFirst({ where });
    if (!attachment)
        throw new AppError('Attachment not found', 404);
    return attachment;
}
// Task attachments have always required edit-level task access (not just
// view) — this mirrors that pre-existing behavior exactly, just centralized.
export async function loadTaskForAttachments(taskId, user) {
    const task = await prisma.task.findUnique({ where: { id: taskId } });
    if (!task)
        throw new AppError('Task not found', 404);
    if ((await getTaskAccessLevel(task, user)) !== 'edit')
        throw new AppError('Access denied', 403);
    return task;
}
// requireEdit defaults to false to preserve getProjectAttachments/
// downloadProjectAttachment's existing view-level behavior; upload/delete
// call sites pass requireEdit: true — this is also the fix for a prior bug
// where project-level upload/delete only checked canAccessProject and let a
// view-only member upload/delete project attachments (item-level attachments
// always required edit access; project-level had silently drifted from that).
export async function loadProjectForAttachments(projectId, user, opts) {
    return loadProjectOrFail(projectId, user, {
        require: opts?.requireEdit ? 'edit' : 'access',
        include: ACCESS_INCLUDE_WITH_ROLE,
    });
}
export async function loadItemForAttachments(projectId, itemId) {
    const item = await loadItemOrFail(projectId, itemId);
    if (item.type === 'group')
        throw new AppError('Groups do not support attachments', 400);
    return item;
}
export async function createFileAttachment(opts) {
    return prisma.$transaction(async (tx) => {
        const created = await tx.attachment.create({
            data: {
                taskId: opts.taskId,
                projectItemId: opts.projectItemId,
                projectId: opts.projectId,
                fileName: opts.file.originalname,
                url: opts.file.path,
                publicId: opts.file.filename, // S3 object key
                storage: 's3',
                mimeType: opts.file.mimetype,
                size: opts.file.size,
                uploadedById: opts.uploadedById,
            },
            include: { uploadedBy: { select: UPLOADED_BY_SELECT } },
        });
        if (opts.taskId)
            await tx.task.update({ where: { id: opts.taskId }, data: { attachmentCount: { increment: 1 } } });
        if (opts.projectItemId)
            await tx.projectItem.update({ where: { id: opts.projectItemId }, data: { attachmentCount: { increment: 1 } } });
        return created;
    });
}
// Pasted links only exist at the project-item level today.
export async function createLinkAttachment(opts) {
    return prisma.$transaction(async (tx) => {
        const created = await tx.attachment.create({
            data: {
                projectItemId: opts.projectItemId,
                fileName: opts.fileName,
                url: opts.url,
                publicId: null,
                storage: 's3',
                kind: 'link',
                mimeType: guessMimeTypeFromUrl(opts.url),
                size: 0,
                uploadedById: opts.uploadedById,
            },
            include: { uploadedBy: { select: UPLOADED_BY_SELECT } },
        });
        await tx.projectItem.update({ where: { id: opts.projectItemId }, data: { attachmentCount: { increment: 1 } } });
        return created;
    });
}
// Shared by task- and item-level delete/undo (project-level attachments
// delete immediately — see hardDeleteAttachmentNow — so they don't use these).
export async function scheduleAttachmentDelete(attachment) {
    // Already counting down — return its current state rather than resetting
    // the clock, so a double-click doesn't grant extra time.
    if (attachment.pendingDeleteAt && attachment.pendingDeleteAt > new Date()) {
        return { attachment, alreadyPending: true };
    }
    const updated = await prisma.attachment.update({
        where: { id: attachment.id },
        data: { pendingDeleteAt: new Date(Date.now() + PENDING_DELETE_MS) },
        include: { uploadedBy: { select: UPLOADED_BY_SELECT } },
    });
    return { attachment: updated, alreadyPending: false };
}
export async function undoAttachmentDelete(attachment) {
    if (!attachment.pendingDeleteAt || attachment.pendingDeleteAt <= new Date())
        throw new AppError('Attachment is not pending deletion', 400);
    return prisma.attachment.update({
        where: { id: attachment.id },
        data: { pendingDeleteAt: null },
        include: { uploadedBy: { select: UPLOADED_BY_SELECT } },
    });
}
// Project-level attachments have no pending-delete/undo window — deleting
// removes the blob and row immediately, same as the pre-existing behavior.
export async function hardDeleteAttachmentNow(attachment) {
    await destroyBlob(attachment);
    await prisma.attachment.delete({ where: { id: attachment.id } });
}
//# sourceMappingURL=attachment.service.js.map