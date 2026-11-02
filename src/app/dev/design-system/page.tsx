import type { Metadata } from "next";
import {
  EllipsisVerticalIcon,
  PencilIcon,
  ReceiptTextIcon,
  RefreshCwIcon,
  Trash2Icon,
} from "lucide-react";
import { Amount } from "@/components/amount";
import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/layout/page-header";
import { Section } from "@/components/layout/section";
import { StatusBadge } from "@/components/status-badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatDate, formatDateTime } from "@/lib/format";
import { FormDemo, ToastDemo } from "./interactive-demos";

export const metadata: Metadata = { title: "Design system" };

const swatches = [
  {
    name: "brand-primary",
    hex: "#4F7CAC",
    use: "Icons, illustration, focus ring",
  },
  { name: "brand-secondary", hex: "#7FB069", use: "Supportive fills, charts" },
  { name: "brand-accent", hex: "#F4A259", use: "Highlights, charts" },
  { name: "primary", hex: "#3F6A99", use: "Buttons, links (text-safe)" },
  { name: "background", hex: "#FAF8F5", use: "Page background" },
  { name: "card", hex: "#FFFFFF", use: "Cards, panels, inputs" },
  { name: "foreground", hex: "#2D3748", use: "Main text" },
  { name: "muted-foreground", hex: "#5B6474", use: "Secondary text" },
  { name: "success", hex: "#15803D", use: "Success text and icons" },
  { name: "warning", hex: "#B45309", use: "Warning text and icons" },
  { name: "destructive", hex: "#C53030", use: "Errors, destructive actions" },
  { name: "border", hex: "#E6E1D9", use: "Dividers, card edges" },
  { name: "input", hex: "#857F76", use: "Form control borders" },
];

// Clearly labelled sample content — not household data.
const SAMPLE_LONG_NAME =
  "Flat 4B, Sunrise Apartments — Koramangala 5th Block Roommates";

export default function DesignSystemPage() {
  return (
    <main>
      <PageContainer className="space-y-10">
        <PageHeader
          title="Design system"
          description="Tokens, typography and shared components for Shared Household Journal. Development only — every name and amount on this page is sample content, not real household data."
          actions={<Badge variant="outline">Phase 2 · dev only</Badge>}
        />

        <Section
          title="Colour"
          description="Brand colours are for fills and icons; text uses the darker, contrast-checked tokens."
        >
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {swatches.map((swatch) => (
              <li
                key={swatch.name}
                className="flex items-center gap-3 rounded-lg border bg-card p-3"
              >
                <span
                  className="size-10 shrink-0 rounded-md ring-1 ring-foreground/10"
                  style={{ backgroundColor: swatch.hex }}
                  aria-hidden="true"
                />
                <div className="min-w-0">
                  <p className="type-label">
                    {swatch.name}{" "}
                    <span className="type-help font-normal">{swatch.hex}</span>
                  </p>
                  <p className="type-help">{swatch.use}</p>
                </div>
              </li>
            ))}
          </ul>
        </Section>

        <Section
          title="Typography"
          description="Plus Jakarta Sans for everything; roles are applied with type-* utilities."
        >
          <Card>
            <CardContent className="space-y-4">
              <p className="type-page-title">Page title — Household overview</p>
              <p className="type-section-title">
                Section title — Recent expenses
              </p>
              <p className="type-card-title">Card title — Electricity bill</p>
              <p className="type-body">
                Body text — Everyone in the household can see how shared costs
                were split and what has been settled.
              </p>
              <p className="type-secondary">Secondary text — Added by Asha</p>
              <p className="type-label">Label — Paid by</p>
              <p className="type-help">
                Help text — Amounts are in Indian rupees.
              </p>
              <p>
                Amount — <Amount minor={1234550} currency="INR" />, large:{" "}
                <Amount minor={1234567890} currency="INR" size="lg" />
              </p>
              <p className="type-timestamp">
                Date {formatDate("2026-11-02")} · Timestamp{" "}
                {formatDateTime("2026-11-02T13:45:00Z", "Asia/Kolkata")}
              </p>
            </CardContent>
          </Card>
        </Section>

        <Section
          title="Buttons"
          description="40px default height; 44px large for primary mobile actions."
        >
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Button>Record expense</Button>
              <Button variant="secondary">Add to list</Button>
              <Button variant="outline">View details</Button>
              <Button variant="ghost">Cancel</Button>
              <Button variant="destructive">Delete</Button>
              <Button variant="link">See how this was split</Button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm">Small</Button>
              <Button>Default</Button>
              <Button size="lg">Large</Button>
              <Button disabled>Disabled</Button>
              <Button disabled aria-busy="true">
                <Spinner aria-hidden="true" data-icon="inline-start" />
                Saving…
              </Button>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label="Edit expense"
                  >
                    <PencilIcon aria-hidden="true" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Edit expense</TooltipContent>
              </Tooltip>
            </div>
          </div>
        </Section>

        <Section
          title="Form controls"
          description="Labels above fields, help and errors directly below. Errors are written out next to the field, never shown by colour alone. Entered values are kept when validation fails."
        >
          <Card>
            <CardContent>
              <FormDemo />
            </CardContent>
          </Card>
        </Section>

        <Section
          title="Cards and amounts"
          description="Direction is always stated in words; colour only supports it."
        >
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            <Card>
              <CardHeader>
                <CardDescription>You are owed</CardDescription>
                <CardTitle>
                  <Amount
                    minor={245000}
                    currency="INR"
                    tone="positive"
                    size="lg"
                  />
                </CardTitle>
              </CardHeader>
              <CardContent className="type-secondary">
                Across 3 people in this household
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardDescription>You owe</CardDescription>
                <CardTitle>
                  <Amount
                    minor={81250}
                    currency="INR"
                    tone="negative"
                    size="lg"
                  />
                </CardTitle>
              </CardHeader>
              <CardContent className="type-secondary">
                To Ravi, for groceries and internet
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>{SAMPLE_LONG_NAME}</CardTitle>
                <CardDescription>
                  Long names wrap instead of overflowing.
                </CardDescription>
              </CardHeader>
              <CardFooter className="justify-between gap-2">
                <span className="type-secondary">4 members</span>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Household options"
                    >
                      <EllipsisVerticalIcon aria-hidden="true" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem>Rename</DropdownMenuItem>
                    <DropdownMenuItem>Invite someone</DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive">
                      Leave household
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </CardFooter>
            </Card>
          </div>
        </Section>

        <Section title="Status and people">
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <StatusBadge status="success">Settled</StatusBadge>
              <StatusBadge status="warning">Due in 2 days</StatusBadge>
              <StatusBadge status="danger">Overdue</StatusBadge>
              <StatusBadge status="info">Recorded in the app</StatusBadge>
              <StatusBadge status="neutral">Draft</StatusBadge>
              <Badge variant="highlight">New</Badge>
            </div>
            <div className="flex items-center gap-3">
              {["AS", "RK", "MN"].map((initials) => (
                <Avatar key={initials} size="lg">
                  <AvatarFallback>{initials}</AvatarFallback>
                </Avatar>
              ))}
            </div>
          </div>
        </Section>

        <Section title="Loading, empty and error states">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Card role="status" aria-busy="true" aria-label="Loading expenses">
              <CardContent className="space-y-3">
                <Skeleton className="h-5 w-2/3" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-5/6" />
                <Separator />
                <Skeleton className="h-8 w-1/3" />
              </CardContent>
            </Card>
            <EmptyState
              icon={<ReceiptTextIcon />}
              title="No expenses yet"
              description="When someone in the household records a shared cost, it will show up here."
              action={<Button>Record the first expense</Button>}
            />
            <ErrorState
              title="We couldn’t load expenses"
              description="Check your connection, then try again. Nothing you entered has been lost."
              action={
                <Button variant="outline" size="sm">
                  <RefreshCwIcon aria-hidden="true" data-icon="inline-start" />
                  Try again
                </Button>
              }
            />
          </div>
        </Section>

        <Section
          title="Feedback and overlays"
          description="Toasts confirm; dialogs ask before anything destructive. Nothing on this page changes data."
        >
          <div className="flex flex-wrap gap-2">
            <ToastDemo />
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="outline">Open dialog</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Settlement recorded</DialogTitle>
                  <DialogDescription>
                    Recorded in the app — no money is moved. Both of you will
                    see this in the journal.
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <DialogClose asChild>
                    <Button>Done</Button>
                  </DialogClose>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive">
                  <Trash2Icon aria-hidden="true" data-icon="inline-start" />
                  Delete expense
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    Delete “Electricity bill”?
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    It will stop counting towards balances. The household owner
                    can restore it later.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Keep expense</AlertDialogCancel>
                  <AlertDialogAction variant="destructive">
                    Delete expense
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </Section>
      </PageContainer>
    </main>
  );
}
