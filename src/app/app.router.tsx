/**
 * React Router in library mode on purpose: the layout lives in the store, so
 * routes only ever name a saved view. Framework mode would pull in Vite, which
 * the compiled binary has no use for.
 */

import { createBrowserRouter, type RouteObject } from "react-router";

import { AppShell } from "./app.shell.tsx";

export const SAVED_VIEW_PATH = "/view/:viewId";

export const routes: RouteObject[] = [
  { path: "/", element: <AppShell /> },
  // Saved views are wired up once the view store exists; the route is reserved
  // here so no pane ever gets a route of its own.
  { path: SAVED_VIEW_PATH, element: <AppShell /> },
  { path: "*", element: <div className="noc-error">No such view.</div> },
];

export function createAppRouter() {
  return createBrowserRouter(routes);
}
