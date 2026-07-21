// Remotion Studio config only (`pnpm --filter @lusora/engine studio`): browse
// the composition against the generated fixture video-dir. The CLI render path
// does not read this file — it passes publicDir/inputProps explicitly.
//
// Studio needs the Remotion CLI, kept OUT of the locked deps because its studio
// bundle is heavy; install it once when you want the studio: `pnpm add -D -w
// @remotion/cli` (or per-package). The render path and tests do not need it.
import { Config } from "@remotion/cli/config";

Config.setPublicDir("./fixtures/video-dir");
