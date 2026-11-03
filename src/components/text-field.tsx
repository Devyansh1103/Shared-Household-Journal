import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";

type TextFieldProps = Omit<React.ComponentProps<typeof Input>, "id"> & {
  id: string;
  label: React.ReactNode;
  description?: React.ReactNode;
  error?: string;
};

/** Labelled input with help text and an error linked by `aria-describedby`. */
export function TextField({
  id,
  label,
  description,
  error,
  ...inputProps
}: TextFieldProps) {
  const describedBy =
    [description ? `${id}-help` : null, error ? `${id}-error` : null]
      .filter(Boolean)
      .join(" ") || undefined;

  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        {...inputProps}
      />
      {description ? (
        <FieldDescription id={`${id}-help`}>{description}</FieldDescription>
      ) : null}
      <FieldError id={`${id}-error`}>{error}</FieldError>
    </Field>
  );
}
