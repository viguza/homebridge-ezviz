/**
 * Masks `user:pass@` credentials embedded in a URL (e.g. an RTSP camera URL) so they
 * never end up in logs, error messages, or ffmpeg command dumps.
 */
export function redactCredentials(text: string): string {
  // Greedy up to the last '@' in the whitespace-delimited token, so a password that
  // itself contains '@' or '/' is still fully masked; over-masking is the safe failure.
  return text.replace(/:\/\/\S*@/g, '://***:***@');
}
