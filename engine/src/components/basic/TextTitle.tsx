/**
 * TextTitle — the big line: a title, a cold open, or a single figure written
 * out as words ("14,2 MILHÕES km²"). `sub` is the quiet line under it — a
 * pronunciation, a translation, a date.
 *
 * Drawn by TextTag; see that file for why the `basic` pack paints no plate.
 */
import { z } from "zod";
import type { Theme } from "../theme.ts";
import { POSITION, SIZE, TextTag } from "./TextTag.tsx";

export const TextTitleProps = z.object({
  text: z.string().max(90),
  sub: z.string().max(60).optional(),
  position: POSITION.default("center"),
  size: SIZE.default("big"),
});
export type TextTitleProps = z.infer<typeof TextTitleProps>;

export function TextTitle({ props, theme }: { props: TextTitleProps; theme: Theme }) {
  return (
    <TextTag
      component="TextTitle"
      lead={props.text}
      sub={props.sub}
      position={props.position}
      size={props.size}
      theme={theme}
      seconds={1.1}
    />
  );
}
