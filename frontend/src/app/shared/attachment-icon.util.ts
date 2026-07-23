// Single source of truth for attachment icon/type logic — previously
// duplicated (and drifted, e.g. a missing video/ branch) across
// attachment-panel, project-item-detail, project-attachments-card and
// task-attachments-modal.
export function isImageAttachment(mimeType: string): boolean {
  return mimeType.startsWith('image/');
}

export function attachmentFileIcon(mimeType: string): string {
  if (mimeType.startsWith('image/')) return 'bi-file-earmark-image';
  if (mimeType.startsWith('video/')) return 'bi-file-earmark-play';
  if (mimeType === 'application/pdf') return 'bi-file-earmark-pdf';
  if (mimeType.includes('zip')) return 'bi-file-earmark-zip';
  if (mimeType.includes('word')) return 'bi-file-earmark-word';
  if (mimeType.includes('sheet') || mimeType.includes('excel')) return 'bi-file-earmark-spreadsheet';
  if (mimeType.includes('presentation') || mimeType.includes('powerpoint')) return 'bi-file-earmark-slides';
  if (mimeType.startsWith('text/')) return 'bi-file-earmark-text';
  return 'bi-file-earmark';
}

export function attachmentExt(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  if (dot < 0 || dot === fileName.length - 1) return '';
  return fileName.slice(dot + 1).slice(0, 4);
}
