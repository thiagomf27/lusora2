/**
 * An error carrying the HTTP status a route should answer with.
 *
 * Its own module, with no Next import, so library code that throws it
 * (videos.ts, backgrounds.ts) also loads under plain Node — the CLI scripts in
 * platform/scripts enqueue through videos.ts. auth.ts re-exports it, so route
 * code keeps importing it from there.
 */
export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
