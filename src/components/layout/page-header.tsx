import { cn } from "cn";

type PageHeaderProps = {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Primary page actions; wrap below the title on small screens. */
  actions?: React.ReactNode;
  className?: string;
};

export function PageHeader({
  title,
  description,
  actions,
  className,
}: PageHeaderProps) {
  return (
    <header
      className={cn(
        "flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between",
        className,
      )}
    >
      <div className="min-w-0 space-y-1">
        <h1 className="type-page-title">{title}</h1>
        {description ? (
          <p className="max-w-prose-narrow type-secondary">{description}</p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>
      ) : null}
    </header>
  );
}
