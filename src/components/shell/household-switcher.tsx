"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import {
  CheckIcon,
  ChevronsUpDownIcon,
  HouseIcon,
  ListIcon,
  PlusIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { currentHousehold } from "@/lib/navigation";

export type SwitcherHousehold = { id: string; name: string };

/**
 * Shows the household in the URL and moves between the user's households.
 * Switching is plain navigation, so each household's page loads its own data
 * on the server; nothing is remembered in the browser.
 */
export function HouseholdSwitcher({
  households,
}: {
  households: SwitcherHousehold[];
}) {
  const params = useParams<{ householdId?: string }>();
  const current = currentHousehold(households, params.householdId);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="w-full min-w-0 justify-between">
          <span className="flex min-w-0 items-center gap-2">
            <HouseIcon aria-hidden="true" className="size-4 shrink-0" />
            <span className="truncate">
              {current ? (
                <>
                  <span className="sr-only">Current household: </span>
                  {current.name}
                </>
              ) : (
                "Choose a household"
              )}
            </span>
          </span>
          <ChevronsUpDownIcon
            aria-hidden="true"
            className="size-4 shrink-0 text-muted-foreground"
          />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-72 max-w-[calc(100vw-2rem)]">
        {households.length > 0 ? (
          <>
            <DropdownMenuLabel>Your households</DropdownMenuLabel>
            <DropdownMenuGroup>
              {households.map((household) => {
                const isCurrent = household.id === current?.id;
                return (
                  <DropdownMenuItem key={household.id} asChild>
                    <Link
                      href={`/households/${household.id}`}
                      aria-current={isCurrent ? "page" : undefined}
                    >
                      <CheckIcon
                        aria-hidden="true"
                        className={isCurrent ? undefined : "invisible"}
                      />
                      <span className="truncate">{household.name}</span>
                      {isCurrent ? (
                        <span className="sr-only"> (current)</span>
                      ) : null}
                    </Link>
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
          </>
        ) : null}
        <DropdownMenuItem asChild>
          <Link href="/home">
            <ListIcon aria-hidden="true" />
            All households
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/households/new">
            <PlusIcon aria-hidden="true" />
            Create a household
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
