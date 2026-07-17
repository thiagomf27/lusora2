import type { VideoStatus, UserRole } from "./types.ts";

/**
 * Legal status transitions of the videos queue.
 * DRAFT → QUEUED → PRODUCING → RENDERED → IN_REVIEW → APPROVED → POSTED
 * plus ERROR (from any producing stage) and SENT_BACK (from review, returns
 * to QUEUED after edits).
 */
export const VIDEO_STATUS_TRANSITIONS: Record<VideoStatus, VideoStatus[]> = {
  draft: ["queued"],
  queued: ["producing", "draft"],
  producing: ["rendered", "error"],
  rendered: ["in_review", "approved", "sent_back"],
  in_review: ["approved", "sent_back"],
  approved: ["posted", "sent_back"],
  sent_back: ["queued", "in_review"],
  posted: [],
  error: ["queued", "draft"],
};

/** Editor-role transitions are restricted to the review flow. */
export const EDITOR_ALLOWED_STATUSES: VideoStatus[] = [
  "rendered",
  "in_review",
  "approved",
  "sent_back",
  "posted",
];

export function canTransition(
  role: UserRole,
  from: VideoStatus,
  to: VideoStatus
): boolean {
  if (!VIDEO_STATUS_TRANSITIONS[from]?.includes(to)) return false;
  if (role === "editor") {
    return (
      EDITOR_ALLOWED_STATUSES.includes(from) && EDITOR_ALLOWED_STATUSES.includes(to)
    );
  }
  return true;
}
