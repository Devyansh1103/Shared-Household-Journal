/**
 * Sent on window after a notification is marked read, so the shell's bell
 * refreshes its count. A plain module, so server components can pass the
 * name to client ones (a constant exported from a "use client" file would
 * arrive as a client reference, not a string).
 */
export const NOTIFICATIONS_CHANGED = "notifications:changed";
