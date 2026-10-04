// Fixed card geometry makes the rendered window independent of library size.
export function virtualWindow(count, width, height, scrollTop) {
  const gap = 16,
    cardHeight = 280,
    rowHeight = cardHeight + gap;
  const columns = Math.max(1, Math.floor((width + gap) / 196));
  const totalRows = Math.ceil(count / columns),
    totalHeight = Math.max(0, totalRows * rowHeight - gap);
  const top = Math.min(
    Math.max(0, scrollTop),
    Math.max(0, totalHeight - height),
  );
  const firstRow = Math.max(0, Math.floor(top / rowHeight) - 2);
  const lastRow = Math.min(
    totalRows,
    Math.ceil((top + height) / rowHeight) + 2,
  );
  return {
    columns,
    rowHeight,
    cardHeight,
    gap,
    top,
    totalHeight,
    start: firstRow * columns,
    end: Math.min(count, lastRow * columns),
    cardWidth: Math.max(0, (width - (columns - 1) * gap) / columns),
  };
}
