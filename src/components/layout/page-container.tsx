import { cn } from "cn";

/** Centred page width with the standard responsive gutters (16 / 24 / 32px). */
export function PageContainer({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "mx-auto w-full max-w-page px-4 py-6 sm:px-6 sm:py-8 lg:px-8",
        className,
      )}
      {...props}
    />
  );
}
