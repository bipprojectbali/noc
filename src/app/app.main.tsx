import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router";

import { WallFullscreen } from "../display/display.fullscreen.tsx";
import { useWallStore } from "../pane/pane.store.ts";
import { createWallClient } from "../persist/persist.client.ts";
import { PersistenceNotice } from "../persist/persist.notice.tsx";
import { startWallPersistence } from "../persist/persist.sync.ts";
import { createAppRouter } from "./app.router.tsx";

const container = document.getElementById("root");
if (container === null) {
  throw new Error("Missing #root element in index.html");
}

// Started before the first render on purpose: the store is still on its fresh
// layout until the stored one arrives, and saving is held off until then.
const wallClient = createWallClient({
  onError: (message) => {
    useWallStore.getState().setPersistence({ kind: "save-failed", message });
  },
});
void startWallPersistence(wallClient, useWallStore).ready;

createRoot(container).render(
  <StrictMode>
    <div className="noc-root">
      <PersistenceNotice />
      <RouterProvider router={createAppRouter()} />
      {/* After the router, not before: it floats over the wall rather than
          taking a row above it, and painting last is what keeps it reachable
          without a z-index that has to beat anything inside a pane. */}
      <WallFullscreen />
    </div>
  </StrictMode>,
);
