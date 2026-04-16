import "./ChevronMorphLiquid.css";

export default function ChevronMorphLiquid({ className = "" }) {
  return (
    <span className={`chevron-liquid ${className}`} aria-hidden="true">
      <span className="chevron-liquid__line chevron-liquid__line--top" />
      <span className="chevron-liquid__line chevron-liquid__line--bottom" />
    </span>
  );
}