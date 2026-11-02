import type { Metadata } from "next";
import { notFound } from "next/navigation";

// Development-only tools. Every route under /dev is a 404 in production builds.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function DevLayout({ children }: LayoutProps<"/dev">) {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }
  return children;
}
