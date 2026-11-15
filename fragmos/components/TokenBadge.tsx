export function TokenBadge({
  token,
  active = false,
  className = "",
}: {
  token: string;
  active?: boolean;
  className?: string;
}) {
  return (
    <span
      className={`inline-block rounded-[3px] bg-token px-1.5 py-px font-mono text-[0.78em] font-medium leading-snug text-token-ink ring-1 transition-shadow duration-200 ${
        active ? "ring-forest" : "ring-transparent"
      } ${className}`}
    >
      {token}
    </span>
  );
}
