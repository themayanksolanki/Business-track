# Plan: stop fetching attachments/plan as blobs — use direct URLs instead

## Why
Attachment/plan preview and download currently work by having the browser
fetch the file via XHR (`HttpClient.get(url, {responseType:'blob'})`), first
hitting our `/download` endpoint for a presigned S3 URL (or the Cloudinary
URL), then a second XHR straight to that URL to pull the bytes into a Blob.

Confirmed on 2026-07-19: an ad-blocker/privacy extension in the user's normal
Chrome profile was silently dropping that second XHR (request just sits
"pending" forever) because it targets `*.amazonaws.com` URLs carrying
`X-Amz-*` signature query params — a pattern those extensions commonly
flag as tracking-like. Confirmed working in Incognito (extensions off).

Since this is app-wide behavior, any user with a similar extension will hit
the same silent failure. The fix: stop fetching bytes via XHR for
preview — point `<img>`/`<video>`/`<iframe>` `src` directly at the
presigned/Cloudinary URL instead. Resource-load requests like these are far
less likely to be pattern-matched than a programmatic XHR/fetch call, and
it's also more efficient (native streaming instead of buffering full blobs
into memory).

Downloads need a bit more care — cross-origin `<a download>` is ignored by
browsers, so a forced "Save As" still needs the server to set
`Content-Disposition: attachment` (as opposed to `inline` for preview), not
a client-side blob trick.

## Current architecture (as of this session)
- Backend: `backend/lib/s3.js`'s `getS3DownloadUrl({key, mimeType, fileName})`
  returns a presigned GET URL with `ResponseContentDisposition: inline`,
  5 min expiry (`expiresIn: 300`).
- `backend/controllers/attachmentController.js`'s `getAttachmentDownloadInfo`
  and `backend/controllers/projectController.js`'s `downloadProjectPlan`
  return `{ url, mimeType, fileName }` JSON — `url` is the presigned S3 URL
  for `storage: 's3'` rows, or the plain Cloudinary URL for legacy
  `storage: 'cloudinary'` rows.
- Frontend `project.service.ts` / `attachment.service.ts` have a `fetchFile()`
  helper: `GET` the JSON info, then `switchMap` into a second
  `GET(info.url, {responseType:'blob'})` — this second call is the one being
  silently blocked.
- `shared/attachment-viewer/attachment-viewer.component.ts` takes
  `@Input loadBlob: (attachment) => Observable<Blob>`, calls it in
  `loadEntry()`, does `URL.createObjectURL(blob)` for the `<img>`/`<video>`
  src and a sanitized version for the PDF `<iframe>`. Revokes object URLs in
  `ngOnDestroy`/`onMediaLoadError`.
- Consumers currently passing `[loadBlob]` and handling `(download)` by
  blob-fetching + `<a download>` click (need to verify exact current code for
  each before editing — didn't get to run the survey subagent):
  - `shared/attachment-panel/attachment-panel.component.ts`
  - `shared/project-attachments-card/project-attachments-card.component.ts`
  - `shared/project-plan-card/project-plan-card.component.ts`
  - `pages/project-detail/project-detail.component.ts` (`loadPlanBlob`,
    `planViewerOpen`, `downloadPlan`)
  - `pages/task-list/task-list.component.ts`
  - `shared/kanban-board/kanban-board.component.ts` — also uses a blob fetch
    for the card **cover image** thumbnail (separate from the viewer), should
    switch to a direct `<img src>` too
  - `shared/project-item-detail/project-item-detail.component.ts` — check
    whether it touches attachments/blob at all

## Steps

1. **Backend: support both `inline` and `attachment` disposition.**
   - `lib/s3.js`: add a `disposition` param to `getS3DownloadUrl`
     (`'inline' | 'attachment'`), used in `ResponseContentDisposition`.
   - `attachmentController.js`'s `getAttachmentDownloadInfo` and
     `projectController.js`'s `downloadProjectPlan`: return **both**
     `viewUrl` (inline) and `downloadUrl` (attachment) in one JSON response
     — presigning twice is cheap (local HMAC, no extra AWS round-trip), so no
     need for a second network hit or a query-param toggle.
   - For legacy `storage: 'cloudinary'` rows: `viewUrl` = existing
     `attachment.url` as-is; `downloadUrl` = same URL with Cloudinary's
     `fl_attachment` transformation flag inserted after `/upload/` (forces
     `Content-Disposition: attachment` from Cloudinary's side).

2. **Frontend services** (`project.service.ts`, `attachment.service.ts`):
   replace the blob-fetching `fetchFile()` two-step with a method that just
   returns the JSON `Observable<{ viewUrl, downloadUrl, mimeType, fileName }>`
   — no second HTTP call, no blob.

3. **Rewrite `attachment-viewer.component.ts`:**
   - `@Input loadBlob` → `@Input getFileInfo: (attachment) => Observable<{viewUrl, downloadUrl, mimeType, fileName}>`.
   - `loadEntry()`: subscribe to `getFileInfo(a)`; on success store
     `entry = { status: 'loaded', url: info.viewUrl }` directly — no
     `URL.createObjectURL`. For the PDF case also set
     `entry.safeUrl = sanitizer.bypassSecurityTrustResourceUrl(info.viewUrl)`.
   - Remove now-unnecessary `URL.revokeObjectURL` calls in `ngOnDestroy` and
     `onMediaLoadError` (nothing to revoke once we're not creating object
     URLs for preview).
   - `downloadCurrent()` keeps emitting `(download)` with the current
     attachment — but each **consumer's** handler should now navigate to
     `info.downloadUrl` (e.g. `window.open(downloadUrl, '_blank')`) instead
     of blob-fetch + `<a download>` click. Since the server sets
     `Content-Disposition: attachment` on that URL, the browser forces a
     save dialog regardless of cross-origin `download`-attribute
     restrictions — no blob needed here either.

4. **Update every consumer** listed above to match the new contract: pass
   `[getFileInfo]` instead of `[loadBlob]`, and change `download()` handlers
   to navigate to a `downloadUrl` rather than fetch+blob+anchor-click.
   Kanban card cover images should switch from blob-fetched `<img>` to a
   direct `viewUrl` src too.

5. **Test thoroughly, with an ad-blocker enabled** (the whole point of this
   change): confirm PDF/image/video preview loads via direct `src` (check
   Network tab shows it as a `<iframe>`/`<img>`/`<video>`-initiated request,
   not `xhr`/`fetch`), confirm Download still saves with the correct
   filename, test both S3-backed and any remaining Cloudinary-backed
   attachments, test locally and against production (Vercel + Render).

6. **Clean up dead code** once everything's switched over — old `fetchFile()`
   helpers, unused `switchMap` imports, anything left referencing blob-based
   loading that's no longer called.
