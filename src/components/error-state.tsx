import { OctagonXIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

type ErrorStateProps = {
  title?: React.ReactNode;
  /** Say what happened and what the person can do next. */
  description: React.ReactNode;
  /** Recovery control, e.g. a "Try again" button. */
  action?: React.ReactNode;
  className?: string;
};

export function ErrorState({
  title = "Something went wrong",
  description,
  action,
  className,
}: ErrorStateProps) {
  return (
    <Alert variant="destructive" className={className}>
      <OctagonXIcon aria-hidden="true" />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{description}</AlertDescription>
      {action ? <div className="col-start-2 mt-2">{action}</div> : null}
    </Alert>
  );
}
