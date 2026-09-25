/**
 * Masks `user:pass@` credentials embedded in a URL (e.g. an RTSP camera URL) so they
 * never end up in logs, error messages, or ffmpeg command dumps.
 */
export function redactCredentials(text: string): string {
  return text.replace(/:\/\/[^/\s@]+@/g, '://***:***@');
}
