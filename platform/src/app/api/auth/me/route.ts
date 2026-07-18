import { NextResponse } from "next/server";
import { handler, requireUser, grantedChannelIds } from "@/lib/auth";

export const GET = handler(async () => {
  const user = await requireUser();
  const channels = await grantedChannelIds(user);
  return NextResponse.json({ ...user, channels });
});
