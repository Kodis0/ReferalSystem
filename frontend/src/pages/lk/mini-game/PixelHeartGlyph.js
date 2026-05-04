/** Сетка 10×6 для пиксельного сердца (viewBox), симметричный контур. */
export const PIXEL_HEART_PATTERN = [
  "0011001100",
  "0111111110",
  "0111111110",
  "0011111100",
  "0001111000",
  "0000110000",
];

export default function PixelHeartGlyph() {
  const rects = [];
  for (let r = 0; r < PIXEL_HEART_PATTERN.length; r++) {
    const row = PIXEL_HEART_PATTERN[r];
    for (let c = 0; c < row.length; c++) {
      if (row[c] === "1") {
        rects.push(<rect key={`${r}-${c}`} x={c} y={r} width={1} height={1} />);
      }
    }
  }
  return (
    <svg
      className="block-blast-game__pixel-heart-svg"
      viewBox="0 0 10 6"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
    >
      {rects}
    </svg>
  );
}
