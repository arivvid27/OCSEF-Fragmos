"use client";

import { useId } from "react";
import type { ProviderId } from "@/lib/providers";

const PETAL_LENGTHS = [10, 7, 9, 6.5, 10, 7, 9, 6.5, 10, 7, 9, 6.5];

function GeminiMark({ selected, replay }: { selected: boolean; replay: number }) {
  const gradient = "gem" + useId().replace(/[^a-zA-Z0-9]/g, "");
  return (
    <span
      key={"g" + selected + replay}
      className={`inline-flex ${selected ? "animate-turn" : "transition-transform duration-700 ease-ios group-hover:rotate-45"}`}
    >
      <svg viewBox="0 0 24 24" className="h-7 w-7" aria-hidden>
        <defs>
          <linearGradient id={gradient} x1="3" y1="21" x2="21" y2="3" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#4285f4" />
            <stop offset="0.55" stopColor="#9b72cb" />
            <stop offset="1" stopColor="#d96570" />
          </linearGradient>
        </defs>
        <path
          fill={"url(#" + gradient + ")"}
          d="M12 1.5c.4 5.6 4.9 10.1 10.5 10.5-5.6.4-10.1 4.9-10.5 10.5C11.6 16.9 7.1 12.4 1.5 12 7.1 11.6 11.6 7.1 12 1.5Z"
        />
      </svg>
    </span>
  );
}

function ClaudeMark({ selected, replay }: { selected: boolean; replay: number }) {
  return (
    <span key={"c" + selected + replay} className="inline-flex">
      <svg viewBox="0 0 24 24" className="h-7 w-7" aria-hidden>
        <g className={selected ? "" : "origin-center transition-transform duration-700 ease-ios group-hover:rotate-[30deg]"} style={{ transformOrigin: "12px 12px" }}>
          {PETAL_LENGTHS.map((length, i) => {
            const angle = (i * Math.PI * 2) / PETAL_LENGTHS.length;
            return (
              <line
                key={i}
                x1={12 + Math.cos(angle) * 3.4}
                y1={12 + Math.sin(angle) * 3.4}
                x2={12 + Math.cos(angle) * length}
                y2={12 + Math.sin(angle) * length}
                stroke="#d97757"
                strokeWidth="2.3"
                strokeLinecap="round"
                className={selected ? "animate-bloom" : ""}
                style={{ transformOrigin: "12px 12px", animationDelay: selected ? i * 35 + "ms" : undefined }}
              />
            );
          })}
        </g>
      </svg>
    </span>
  );
}

function OpenAIMark({ selected, replay }: { selected: boolean; replay: number }) {
  return (
    <span
      key={"o" + selected + replay}
      className={`inline-flex text-ink ${selected ? "animate-knot" : "transition-transform duration-700 ease-ios group-hover:rotate-[60deg]"}`}
    >
      <svg viewBox="0 0 24 24" className="h-7 w-7" fill="currentColor" aria-hidden>
        <path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654 2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z" />
      </svg>
    </span>
  );
}

export function ProviderIcon({ id, selected, replay }: { id: ProviderId; selected: boolean; replay: number }) {
  if (id === "claude") {
    return <ClaudeMark selected={selected} replay={replay} />;
  }
  if (id === "gpt") {
    return <OpenAIMark selected={selected} replay={replay} />;
  }
  return <GeminiMark selected={selected} replay={replay} />;
}

export function GearIcon({ className = "h-[18px] w-[18px]" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className={className} aria-hidden>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z"
      />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
    </svg>
  );
}
