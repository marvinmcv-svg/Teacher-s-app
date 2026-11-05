import { cn } from "@/lib/utils";

/** Wordmark: serif "Tinta" with a red-pen tick. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-baseline gap-1 font-serif text-2xl leading-none text-ink", className)}>
      Tinta
      <svg
        aria-hidden
        viewBox="0 0 20 14"
        className="h-3 w-4 text-pen-red"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M2 7.5 7 12 18 2" />
      </svg>
    </span>
  );
}
