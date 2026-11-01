/** Format recorded analysis time, never infer it for older saved reviews. */
export function formatReviewDuration(durationMs) {
  if (!Number.isSafeInteger(durationMs) || durationMs < 0) return '';
  if (durationMs < 1000) return 'under 1 sec';
  const seconds = Math.round(durationMs / 1000);
  if (seconds < 60) return `${seconds} sec`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min${seconds % 60 ? ` ${seconds % 60} sec` : ''}`;
  return `${Math.floor(minutes / 60)} hr${minutes % 60 ? ` ${minutes % 60} min` : ''}`;
}
