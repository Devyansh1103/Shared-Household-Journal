"use client";

import { useEffect } from "react";

/**
 * Scrolls to the element the URL's #fragment names, once the content this is
 * rendered in has streamed in. Next.js scrolls to a fragment when a
 * navigation commits; if the target is still loading behind a Suspense
 * boundary at that moment, there's nothing to scroll to yet. Put it inside
 * the streamed content that holds the targets.
 */
export function ScrollToHash() {
  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (id) document.getElementById(id)?.scrollIntoView();
  }, []);
  return null;
}
