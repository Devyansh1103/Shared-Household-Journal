import Link from "next/link";
import { SubmitButton } from "@/components/submit-button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { getCurrentUser, getMyProfile } from "@/lib/auth/session";
import { initials } from "@/lib/initials";
import { signOut } from "./actions";

export async function AccountNav() {
  // The layout's SignedIn boundary redirects signed-out visitors; render nothing meanwhile.
  if (!(await getCurrentUser())) return null;
  const profile = await getMyProfile();

  return (
    <nav
      aria-label="Account"
      className="flex min-w-0 items-center gap-1 sm:gap-2"
    >
      <Link
        href="/profile"
        className="flex min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-muted"
      >
        <Avatar aria-hidden="true">
          <AvatarFallback>{initials(profile.displayName)}</AvatarFallback>
        </Avatar>
        <span className="max-w-32 truncate type-label sm:max-w-48">
          {profile.displayName}
        </span>
      </Link>
      <form action={signOut}>
        <SubmitButton variant="ghost" size="sm" pendingLabel="Signing out…">
          Sign out
        </SubmitButton>
      </form>
    </nav>
  );
}
