// Gives bun test a DOM so pane components can be rendered and inspected.
import { GlobalRegistrator } from "@happy-dom/global-registrator";

GlobalRegistrator.register({ url: "http://127.0.0.1:7788/" });

// Iframe page loading stays off so tests never reach the network — a pane only
// needs its `src` attribute to be observable, not fetched. happy-dom reports
// every blocked load through console.error, which would bury real failures, so
// that one expected message is filtered and everything else is passed through.
const IFRAME_LOADING_NOTICE = "Iframe page loading is disabled";
const realConsoleError = console.error.bind(console);
console.error = (...args: unknown[]) => {
  const rendered = args
    .map((arg) =>
      arg instanceof Error ? `${arg.name}: ${arg.message}` : String(arg),
    )
    .join(" ");
  if (rendered.includes(IFRAME_LOADING_NOTICE)) return;
  realConsoleError(...args);
};

// React 19 requires this flag before act() may be used.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;
