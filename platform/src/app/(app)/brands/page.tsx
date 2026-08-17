/**
 * /brands — gone, folded into /channels.
 *
 * "Brand" was a row of its own in the VidRush mockup this UI was ported from,
 * where several channels point at one. Here a brand profile IS the channel's
 * config document, so the screen was a second editor over the same row: the
 * same theme, the same sound, the same source policy, saved through the same
 * endpoint. Its three tabs now live on the Channel screen.
 *
 * Kept as a redirect rather than deleted because links to it are bookmarked
 * and were, until this change, printed on Home and Settings.
 */
import { redirect } from "next/navigation";

export default async function BrandsPage({
  searchParams,
}: {
  searchParams: Promise<{ channel?: string }>;
}) {
  const { channel } = await searchParams;
  redirect(channel ? `/channels?channel=${encodeURIComponent(channel)}` : "/channels");
}
