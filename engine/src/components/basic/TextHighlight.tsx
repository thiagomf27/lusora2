/**
 * TextHighlight — a passage on screen with one phrase lifted out of it.
 *
 * `mark` must be a substring of `text`; the rest of the line drops back rather
 * than the phrase lighting up, so the emphasis costs no colour. That is what
 * separates it from TextTitle: a title is a line to READ, this is a line to
 * read one part of.
 */
import { z } from "zod";
import type { Theme } from "../theme.ts";
import { POSITION, SIZE, TextLockup } from "./TextLockup.tsx";

export const TextHighlightProps = z.object({
  text: z.string().max(160),
  mark: z.string().max(60).optional(),
  label: z.string().max(60).optional(),
  position: POSITION.default("center"),
  size: SIZE.default("medium"),
  background: z.boolean().optional(),
});
export type TextHighlightProps = z.infer<typeof TextHighlightProps>;

export function TextHighlight({ props, theme }: { props: TextHighlightProps; theme: Theme }) {
  return (
    <TextLockup
      component="TextHighlight"
      lead={props.text}
      sub={props.label}
      mark={props.mark}
      position={props.position}
      size={props.size}
      plated={props.background}
      theme={theme}
      seconds={1.4}
    />
  );
}
