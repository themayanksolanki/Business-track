// This package ships no types of its own and there's no @types package for
// it — a thin shim covering just the constructor shape this codebase uses,
// rather than fully modeling Cloudinary's upload-params object.
declare module 'multer-storage-cloudinary' {
  import type { StorageEngine } from 'multer';

  interface CloudinaryStorageOptions {
    cloudinary: any;
    params?: Record<string, any> | ((req: any, file: any) => any);
  }

  export class CloudinaryStorage implements StorageEngine {
    constructor(options: CloudinaryStorageOptions);
    _handleFile(...args: any[]): void;
    _removeFile(...args: any[]): void;
  }
}
