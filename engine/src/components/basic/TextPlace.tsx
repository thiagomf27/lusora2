/**
 * TextPlace — where we are, in the corner, while the shot continues.
 *
 * The core twin is SatelliteLocate, and the difference is the claim: that one
 * SHOWS you the place on a map, this one just names it. Use this when the
 * footage already establishes the location and the viewer only needs it
 * labelled.
 */
import { z } from "zod";
import type { Theme } from "../theme.ts";
import { POSITION, SIZE, TextTag } from "./TextTag.tsx";

export const TextPlaceProps = z.object({
  place: z.string().max(48),
  country: z.string().max(40).optional(),
  position: POSITION.default("top_right"),
  size: SIZE.default("medium"),
});
export type TextPlaceProps = z.infer<typeof TextPlaceProps>;

export function TextPlace({ props, theme }: { props: TextPlaceProps; theme: Theme }) {
  return (
    <TextTag
      component="TextPlace"
      lead={props.place}
      sub={props.country}
      position={props.position}
      size={props.size}
      theme={theme}
      seconds={0.7}
    />
  );
}
