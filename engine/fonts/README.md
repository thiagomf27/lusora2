# Packaged fonts

The families a theme's `typography.display` / `typography.body` may name.
Until D70 nothing here existed and `fontStack()` was the whole story: a theme
asking for `Inter` got whatever the render machine's fontconfig chose for the
fallback stack — DejaVu Sans on this one. Two themes naming two different
sans faces rendered identically, which is a large part of why themes read as
"a font and a colour" without the font.

Each file is the **latin subset of the variable font**, straight from Google
Fonts, so one file covers the whole weight axis `typeWeight()` can ask for
(Inter 300–900, Playfair Display 400–900, Oswald 200–700). Latin only: the
subsets with `unicode-range: U+0000-00FF, ...`. 115 KB for all three.

`scripts/pack-fonts.mjs` base64s them into
`src/themes/fonts.generated.ts`, which every render tree mounts as a
`<style>` block. Data URIs, not URLs: the renderer must not need the network,
and a font that arrives late renders the first frames in the fallback face.

## Adding a family

1. Drop `<Family>.woff2` here (latin subset, variable if the family has one).
2. `node scripts/pack-fonts.mjs`
3. Add the family to `fontStack()` in `src/themes/runtime.ts` if it needs a
   fallback stack other than the sans one — the stack still matters, because
   it is what a theme naming a family nobody packaged falls back to.

## Licences

All three are SIL Open Font License 1.1:
Inter (Rasmus Andersson), Playfair Display (Claus Eggers Sørensen),
Oswald (Vernon Adams et al.).
