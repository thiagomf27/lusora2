import type { VideoStatus, UserRole } from "./types.ts";

/**
 * Legal status transitions of the videos queue.
 * DRAFT → QUEUED → PRODUCING → RENDERED → IN_REVIEW → APPROVED → POSTED
 * plus ERROR (from any producing stage) and SENT_BACK (from review, returns
 * to QUEUED after edits).
 *
 * D62 adds the review-mode loop: PRODUCING → AWAITING_APPROVAL → QUEUED, walked
 * once per gate the manifest declares. It is deliberately a cycle back to
 * QUEUED rather than a status per gate — the folder says which gate is
 * pending (the first with no approvals/<stage>.json), so the queue does not
 * have to carry a second copy of that answer.
 */
export const VIDEO_STATUS_TRANSITIONS: Record<VideoStatus, VideoStatus[]> = {
  draft: ["queued"],
  queued: ["producing", "draft"],
  producing: ["awaiting_approval", "rendered", "error"],
  // approving re-queues it; a run can also be abandoned back to draft
  awaiting_approval: ["queued", "draft", "error"],
  rendered: ["in_review", "approved", "sent_back"],
  in_review: ["approved", "sent_back"],
  approved: ["posted", "sent_back"],
  sent_back: ["queued", "in_review"],
  posted: [],
  error: ["queued", "draft"],
};

/** Editor-role transitions are restricted to the review flow. */
export const EDITOR_ALLOWED_STATUSES: VideoStatus[] = [
  // D62: approving the script and the beat sheet IS the editing job, so review
  // mode must not cost a manager per gate.
  "awaiting_approval",
  "queued",
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
