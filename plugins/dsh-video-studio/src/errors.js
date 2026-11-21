export class VideoStudioError extends Error {
  constructor(message, code = 'VIDEO_STUDIO_ERROR', options = {}) {
    super(message, options);
    this.name = 'VideoStudioError';
    this.code = code;
  }
}

export function fail(message, code) {
  throw new VideoStudioError(message, code);
}
