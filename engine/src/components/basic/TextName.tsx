/**
 * TextName — who this is, in the lower corner, while they keep talking.
 *
 * The core twin is NamePlate, and the difference is furniture: NamePlate is a
 * lower third with a plate and an accent rule, this is the name written on the
 * shot. Same information, and that is exactly why a channel picks one pack or
 * the other rather than both.
 */
import { z } from "zod";
import type { Theme } from "../theme.ts";
import { POSITION, SIZE, TextLockup } from "./TextLockup.tsx";

export const TextNameProps = z.object({
  name: z.string().max(48),
  role: z.string().max(56).optional(),
  position: POSITION.default("bottom_left"),
  size: SIZE.default("medium"),
  background: z.boolean().optional(),
});
export type TextNameProps = z.infer<typeof TextNameProps>;

export function TextName({ props, theme }: { props: TextNameProps; theme: Theme }) {
  return (
    <TextLockup
      component="TextName"
      lead={props.name}
      sub={props.role}
      position={props.position}
      size={props.size}
      plated={props.background}
      theme={theme}
      seconds={0.7}
    />
  );
}
