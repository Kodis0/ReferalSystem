import { memo, useId } from "react";

function FlagInnerRU({ maskId }) {
  return (
    <g mask={`url(#${maskId})`}>
      <path fill="#fff" d="M0 0h32v10.44H0V0Z" />
      <path fill="#0052B4" d="m0 10.44 15.86-1.21L32 10.43v11.13l-15.93 2.02L0 21.56V10.44Z" />
      <path fill="#D80027" d="M0 21.56h32V32H0V21.56Z" />
    </g>
  );
}

function FlagInnerDE({ maskId }) {
  return (
    <g mask={`url(#${maskId})`}>
      <path fill="#000" d="M0 0h32v10.67H0z" />
      <path fill="#D00" d="M0 10.67h32v10.66H0z" />
      <path fill="#FFCE00" d="M0 21.33h32V32H0z" />
    </g>
  );
}

function FlagInnerFR({ maskId }) {
  return (
    <g mask={`url(#${maskId})`}>
      <path fill="#0055A4" d="M0 0h10.67v32H0z" />
      <path fill="#fff" d="M10.67 0h10.66v32H10.67z" />
      <path fill="#EF4135" d="M21.33 0H32v32H21.33z" />
    </g>
  );
}

function FlagInnerUA({ maskId }) {
  return (
    <g mask={`url(#${maskId})`}>
      <path fill="#005BBB" d="M0 0h32v16H0z" />
      <path fill="#FFD500" d="M0 16h32v16H0z" />
    </g>
  );
}

function FlagInnerPL({ maskId }) {
  return (
    <g mask={`url(#${maskId})`}>
      <path fill="#fff" d="M0 0h32v16H0z" />
      <path fill="#DC143C" d="M0 16h32v16H0z" />
    </g>
  );
}

function FlagInnerIT({ maskId }) {
  return (
    <g mask={`url(#${maskId})`}>
      <path fill="#009246" d="M0 0h10.67v32H0z" />
      <path fill="#fff" d="M10.67 0h10.66v32H10.67z" />
      <path fill="#CE2B37" d="M21.33 0H32v32H21.33z" />
    </g>
  );
}

function FlagInnerES({ maskId }) {
  return (
    <g mask={`url(#${maskId})`}>
      <path fill="#AA151B" d="M0 0h32v8H0z" />
      <path fill="#F1BF00" d="M0 8h32v16H0z" />
      <path fill="#AA151B" d="M0 24h32v8H0z" />
    </g>
  );
}

function FlagInnerNL({ maskId }) {
  return (
    <g mask={`url(#${maskId})`}>
      <path fill="#AE1C28" d="M0 0h32v10.67H0z" />
      <path fill="#fff" d="M0 10.67h32v10.66H0z" />
      <path fill="#21468B" d="M0 21.33h32V32H0z" />
    </g>
  );
}

function FlagInnerBE({ maskId }) {
  return (
    <g mask={`url(#${maskId})`}>
      <path fill="#000" d="M0 0h10.67v32H0z" />
      <path fill="#FDDA24" d="M10.67 0h10.66v32H10.67z" />
      <path fill="#EF3340" d="M21.33 0H32v32H21.33z" />
    </g>
  );
}

function FlagInnerAT({ maskId }) {
  return (
    <g mask={`url(#${maskId})`}>
      <path fill="#ED2939" d="M0 0h32v10.67H0z" />
      <path fill="#fff" d="M0 10.67h32v10.66H0z" />
      <path fill="#ED2939" d="M0 21.33h32V32H0z" />
    </g>
  );
}

function FlagInnerUS({ maskId }) {
  const rows = 13;
  const h = 32 / rows;
  const stripes = Array.from({ length: rows }, (_, i) => (
    <rect key={i} x="0" y={i * h} width="32" height={h + 0.02} fill={i % 2 === 0 ? "#B22234" : "#fff"} />
  ));
  return (
    <g mask={`url(#${maskId})`}>
      {stripes}
      <rect x="0" y="0" width="13.7" height="14.85" fill="#3C3B6E" />
    </g>
  );
}

const FLAG_INNER_BY_CODE = {
  RU: FlagInnerRU,
  DE: FlagInnerDE,
  FR: FlagInnerFR,
  UA: FlagInnerUA,
  PL: FlagInnerPL,
  IT: FlagInnerIT,
  ES: FlagInnerES,
  NL: FlagInnerNL,
  BE: FlagInnerBE,
  AT: FlagInnerAT,
  US: FlagInnerUS,
};

export const SUPPORTED_DOMAIN_FLAG_SVG_CODES = new Set(Object.keys(FLAG_INNER_BY_CODE));

export const DomainCountryFlagSvg = memo(function DomainCountryFlagSvg({ countryCode }) {
  const rawId = useId().replace(/:/g, "");
  const maskId = `dcf-m-${rawId}`;
  const upper = String(countryCode || "").trim().toUpperCase();
  const Inner = FLAG_INNER_BY_CODE[upper];
  if (!Inner) return null;
  return (
    <svg
      className="owner-programs__service-card-flag-svg"
      viewBox="0 0 32 32"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <defs>
        <mask id={maskId} maskUnits="userSpaceOnUse">
          <circle cx="16" cy="16" r="16" fill="#fff" />
        </mask>
      </defs>
      <Inner maskId={maskId} />
    </svg>
  );
});
