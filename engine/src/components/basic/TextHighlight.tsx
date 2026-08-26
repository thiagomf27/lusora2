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
import { POSITION, SIZE, TextTag } from "./TextTag.tsx";

export const TextHighlightProps = z.object({
  text: z.string().max(160),
  mark: z.string().max(60).optional(),
  position: POSITION.default("center"),
  size: SIZE.default("medium"),
});
export type TextHighlightProps = z.infer<typeof TextHighlightProps>;

export function TextHighlight({ props, theme }: { props: TextHighlightProps; theme: Theme }) {
  return (
    <TextTag
      component="TextHighlight"
      lead={props.text}
      mark={props.mark}
      position={props.position}
      size={props.size}
      theme={theme}
      seconds={1.4}
    />
  );
}
