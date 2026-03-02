export function hasActiveWorkActivityText(activityText: string | undefined): boolean {
  if (!activityText) {
    return false;
  }

  const normalized = activityText.trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  return /^(reading|editing|writing|running:?|searching|searched|subtask:|using|fetching|planning|responding|let me|fixing)/.test(normalized);
}

export function hasWaitingActivityText(activityText: string | undefined): boolean {
  if (!activityText) {
    return false;
  }

  const normalized = activityText.trim().toLowerCase();
  return normalized.includes("waiting for your answer") || normalized.includes("waiting for approval");
}
