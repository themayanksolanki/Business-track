import { Readable } from 'stream';
import AppError from './AppError.js';

// Angular fetches these files as a credentialed (withCredentials) CORS blob
// request. A 302 redirect straight to Cloudinary crosses origins mid-request,
// which per the Fetch spec forces the browser to null out the Origin header
// on the redirected request — Cloudinary's `Access-Control-Allow-Origin: *`
// response is then invalid for a credentialed request and gets blocked
// client-side (even though the request succeeds and Postman shows it fine).
// Proxying the bytes keeps the response same-origin so no CORS check applies.
const streamRemoteFile = async (res, { url, mimeType, fileName }, next) => {
  try {
    const upstream = await fetch(url);
    if (!upstream.ok || !upstream.body) {
      return next(new AppError('Failed to fetch file', 502));
    }

    res.setHeader('Content-Type', mimeType || upstream.headers.get('content-type') || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(fileName)}"`);

    Readable.fromWeb(upstream.body).pipe(res);
  } catch (err) {
    next(err);
  }
};

export default streamRemoteFile;
