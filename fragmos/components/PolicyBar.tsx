import { POLICIES, type PolicyId } from "@/lib/policies";

interface Props {
  active: PolicyId[];
  onToggle: (id: PolicyId) => void;
  customTerms: string[];
  onRemoveTerm: (term: string) => void;
}

export function PolicyBar({ active, onToggle, customTerms, onRemoveTerm }: Props) {
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <span className="text-[12.5px] text-taupe">Also mask</span>
        {POLICIES.map((p) => {
          const on = active.indexOf(p.id) !== -1;
          return (
            <button
              key={p.id}
              type="button"
              role="switch"
              aria-checked={on}
              title={p.description}
              onClick={() => onToggle(p.id)}
              className={`flex items-center gap-2 text-[12.5px] transition-colors duration-300 ease-ios ${
                on ? "text-ink" : "text-taupe/70 hover:text-ink"
              }`}
            >
              <span
                className={`flex h-3.5 w-3.5 items-center justify-center rounded-[4px] border transition-colors duration-300 ease-ios ${
                  on ? "border-forest bg-forest" : "border-taupe/40 bg-transparent"
                }`}
              >
                <svg
                  viewBox="0 0 12 12"
                  className={`h-2.5 w-2.5 text-white transition-opacity duration-300 ease-ios ${on ? "opacity-100" : "opacity-0"}`}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="m2.5 6.5 2.5 2.5 4.5-5.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
              {p.label}
            </button>
          );
        })}
      </div>

      {customTerms.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {customTerms.map((term) => (
            <span
              key={term}
              className="flex animate-pop items-center gap-1.5 rounded-[4px] bg-risk px-2 py-0.5 text-[12px] text-terracotta"
            >
              {term}
              <button
                type="button"
                aria-label={"Stop masking " + term}
                onClick={() => onRemoveTerm(term)}
                className="text-[14px] leading-none text-risk-line transition-colors hover:text-terracotta"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
