import { Skeleton } from "@/components/ui/skeleton";

/** Placeholder while a form that needs the session is loading. */
export function FormSkeleton({
  fields = 2,
  label = "Loading",
}: {
  fields?: number;
  label?: string;
}) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={label}
      className="space-y-5"
    >
      {Array.from({ length: fields }, (_, index) => (
        <div key={index} className="space-y-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-10 w-full" />
        </div>
      ))}
      <Skeleton className="h-10 w-28" />
    </div>
  );
}
