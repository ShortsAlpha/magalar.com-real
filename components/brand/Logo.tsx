type MarkProps = { size?: number; className?: string; title?: string };

/** The Magalar mark: two arches with a dot — drawn in currentColor so it inherits text color. */
export function LogoMark({ size = 24, className, title }: MarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      className={className}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <path
        d="M12 50V30a10 10 0 0 1 20 0v20M32 50V30a10 10 0 0 1 20 0v20"
        stroke="currentColor"
        strokeWidth={5.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="32" cy="14" r="3.5" fill="currentColor" />
    </svg>
  );
}

/** Mark + wordmark. */
export function Logo({ size = 22, className }: { size?: number; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className ?? ''}`}>
      <LogoMark size={size} />
      <span style={{ fontWeight: 600, letterSpacing: '-0.04em', fontSize: size * 0.86 }}>Magalar</span>
    </span>
  );
}
