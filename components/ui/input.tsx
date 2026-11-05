import * as React from "react";
import { cn } from "@/lib/utils";

const field =
  "w-full rounded-xl border border-rule bg-card px-3 text-base text-ink placeholder:text-ink-muted/80 transition-colors focus-visible:border-pen-blue aria-invalid:border-pen-red";

export function Input({ className, ...props }: React.ComponentProps<"input">) {
  return <input className={cn(field, "min-h-11", className)} {...props} />;
}

export function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return <textarea className={cn(field, "min-h-32 py-2 leading-relaxed", className)} {...props} />;
}

export function Select({ className, ...props }: React.ComponentProps<"select">) {
  return <select className={cn(field, "min-h-11", className)} {...props} />;
}

export function Label({ className, ...props }: React.ComponentProps<"label">) {
  return <label className={cn("text-sm font-medium text-ink", className)} {...props} />;
}

export function FieldHint({ className, ...props }: React.ComponentProps<"p">) {
  return <p className={cn("text-sm text-ink-muted", className)} {...props} />;
}

export function FieldError({ className, ...props }: React.ComponentProps<"p">) {
  return <p role="alert" className={cn("text-sm text-pen-red", className)} {...props} />;
}
