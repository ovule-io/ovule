const EDGE_HOT_ZONE_PX = 10;

type Bounds = { left: number; top: number; width: number; height: number };

export function remotePointFromClient(
  clientX: number,
  clientY: number,
  bounds: Bounds,
  sourceWidth: number,
  sourceHeight: number,
): { x: number; y: number } {
  const { x, y } = remotePointerFromClient(clientX, clientY, bounds, sourceWidth, sourceHeight);
  return { x, y };
}

export function remotePointerFromClient(
  clientX: number,
  clientY: number,
  bounds: Bounds,
  sourceWidth: number,
  sourceHeight: number,
): { x: number; y: number; fractionalX: number; fractionalY: number } {
  const safeWidth = Math.max(1, sourceWidth);
  const safeHeight = Math.max(1, sourceHeight);
  const scale = Math.min(bounds.width / safeWidth, bounds.height / safeHeight) || 1;
  const renderedWidth = safeWidth * scale;
  const renderedHeight = safeHeight * scale;
  const left = bounds.left + (bounds.width - renderedWidth) / 2;
  const top = bounds.top + (bounds.height - renderedHeight) / 2;
  const fractionalX = mapAxis(clientX, left, renderedWidth);
  const fractionalY = mapAxis(clientY, top, renderedHeight);
  return {
    x: Math.min(safeWidth - 1, Math.round(fractionalX * safeWidth)),
    y: Math.min(safeHeight - 1, Math.round(fractionalY * safeHeight)),
    fractionalX,
    fractionalY,
  };
}

function mapAxis(position: number, start: number, renderedSize: number): number {
  const relative = position - start;
  if (relative <= EDGE_HOT_ZONE_PX) return 0;
  if (relative >= renderedSize - EDGE_HOT_ZONE_PX) return 1;
  return Math.max(0, Math.min(1, relative / renderedSize));
}
