/**
 * Transient spawn/despawn ground effects drawn beneath a worker sprite. Both are
 * driven by a 0→1 progress value owned by the caller (summon progress derived from
 * `createdAt`; despawn progress from the fade timer).
 */

export function drawSummonEffect(
  context: CanvasRenderingContext2D,
  centerX: number,
  groundY: number,
  scale: number,
  progress: number
): void {
  const alpha = (1 - progress) * 0.85;
  if (alpha <= 0.01) {
    return;
  }

  const ringRadius = (8 + (1 - progress) * 10) * scale;
  const ringY = groundY + 1.5 * scale;

  context.save();
  context.strokeStyle = `rgba(172, 242, 216, ${alpha})`;
  context.lineWidth = Math.max(1.2, 2 * scale);
  context.beginPath();
  context.arc(centerX, ringY, ringRadius, 0, Math.PI * 2);
  context.stroke();

  context.strokeStyle = `rgba(207, 255, 235, ${alpha * 0.75})`;
  context.lineWidth = Math.max(0.8, 1.2 * scale);
  for (let i = 0; i < 4; i += 1) {
    const angle = progress * Math.PI * 2 + (Math.PI / 2) * i;
    const dx = Math.cos(angle) * ringRadius * 0.65;
    const dy = Math.sin(angle) * ringRadius * 0.35;
    context.beginPath();
    context.arc(centerX + dx, ringY + dy, 2.2 * scale, 0, Math.PI * 2);
    context.stroke();
  }
  context.restore();
}

export function drawDespawnEffect(
  context: CanvasRenderingContext2D,
  centerX: number,
  groundY: number,
  scale: number,
  progress: number,
  alpha: number
): void {
  const ringRadius = (9 + progress * 12) * scale;
  const ringY = groundY + 1.5 * scale;
  const ringAlpha = alpha * 0.55;
  if (ringAlpha <= 0.01) {
    return;
  }

  context.save();
  context.strokeStyle = `rgba(139, 194, 255, ${ringAlpha})`;
  context.lineWidth = Math.max(1, 1.8 * scale);
  context.beginPath();
  context.arc(centerX, ringY, ringRadius, 0, Math.PI * 2);
  context.stroke();
  context.restore();
}
