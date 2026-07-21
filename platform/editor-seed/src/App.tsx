/**
 * Two screens, no router: the video picker, then the editor for the chosen
 * working folder. An unsaved-changes guard protects both navigation away
 * from the editor and closing the tab.
 */

import { useEffect } from "react";
import { isDirty, usePlanStore } from "./store/planStore";
import { Editor } from "./screens/Editor";
import { VideoPicker } from "./screens/VideoPicker";

export function App() {
  const videoId = usePlanStore((s) => s.videoId);
  const dirty = usePlanStore(isDirty);

  // deep link: ?video=<id> re-opens the editor on refresh
  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get("video");
    if (wanted && !usePlanStore.getState().videoId) {
      void usePlanStore.getState().loadVideo(wanted, wanted.split("~").pop() ?? wanted);
    }
  }, []);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (videoId) url.searchParams.set("video", videoId);
    else url.searchParams.delete("video");
    window.history.replaceState(null, "", url);
  }, [videoId]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  return videoId ? <Editor /> : <VideoPicker />;
}
