import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router";

import { useWallStore } from "../pane/pane.store.ts";
import { createWallClient } from "../persist/persist.client.ts";
import { PersistenceNotice } from "../persist/persist.notice.tsx";
import { startWallPersistence } from "../persist/persist.sync.ts";
import { ProxyHostNotice } from "../proxy/proxy.notice.tsx";
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
      <ProxyHostNotice />
      <RouterProvider router={createAppRouter()} />
    </div>
  </StrictMode>,
);
