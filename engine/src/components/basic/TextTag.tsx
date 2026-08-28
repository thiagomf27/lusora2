/**
 * TextTag — a line of text with an optional label under it, anywhere on the
 * frame. The general-purpose entry of the `basic` pack.
 *
 * The other four entries exist because a ROLE carries a placement with it: a
 * place belongs top-right, a name bottom-left, and letting the planner pick a
 * corner every time is how you get a video where nothing sits still. This one
 * is the escape hatch for text that is none of those things — a duration, a
 * rank, a caption, a count — and it pays for the freedom by making the planner
 * choose where it goes.
 *
 * Reach for a role entry when one fits; reach for this when none does.
 *
 * Drawn by TextLockup; see that file for how `background` becomes chips.
 */
import { z } from "zod";
import type { Theme } from "../theme.ts";
import { POSITION, SIZE, TextLockup } from "./TextLockup.tsx";

export const TextTagProps = z.object({
  text: z.string().max(90),
  label: z.string().max(60).optional(),
  position: POSITION.default("center"),
  size: SIZE.default("medium"),
  background: z.boolean().optional(),
});
export type TextTagProps = z.infer<typeof TextTagProps>;

export function TextTag({ props, theme }: { props: TextTagProps; theme: Theme }) {
  return (
    <TextLockup
      component="TextTag"
      lead={props.text}
      sub={props.label}
      position={props.position}
      size={props.size}
      plated={props.background}
      theme={theme}
      seconds={0.9}
    />
  );
}
