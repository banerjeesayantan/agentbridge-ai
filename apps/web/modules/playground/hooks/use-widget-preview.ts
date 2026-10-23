"use client";

import { EMBED_SCRIPT_URL } from "@/modules/integrations/constants";
import type { WidgetPosition } from "@/modules/integrations/utils";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * `loading`      – preview page or bundle still loading
 * `ready`        – bundle loaded and window.AgentBridgeWidget is available
 * `missing-api`  – bundle loaded but did not register the expected API
 *                  (typically a stale widget.js that needs rebuilding)
 * `error`        – the bundle URL could not be loaded
 */
export type BundleStatus = "loading" | "ready" | "missing-api" | "error";

export interface WidgetState {
  initialized: boolean;
  open: boolean;
  organizationId: string | null;
  position: WidgetPosition;
}

export type LogLevel = "info" | "success" | "warn" | "error";

export interface LogEntry {
  id: number;
  at: Date;
  level: LogLevel;
  message: string;
}

export type LastAction = "none" | "init" | "show" | "hide" | "destroy";

interface WidgetApi {
  init: (config?: { organizationId?: string; position?: WidgetPosition }) => boolean | void;
  show: () => void;
  hide: () => void;
  destroy: () => void;
  getState?: () => WidgetState;
}

const MAX_LOG_ENTRIES = 100;
const POLL_INTERVAL_MS = 400;

// A neutral stand-in for a customer's website. The real widget bundle is
// injected into it so layout, z-index and viewport behaviour are genuine.
export const PREVIEW_SRC_DOC = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body{margin:0;font-family:system-ui,sans-serif;color:#475569;background:#fff}
  header{padding:16px 24px;border-bottom:1px solid #e2e8f0;font-weight:600;color:#0f172a}
  main{padding:24px;max-width:640px}
  .bar{height:12px;border-radius:6px;background:#e2e8f0;margin:12px 0}
  .bar.s{width:60%}.bar.m{width:80%}
  p{font-size:13px;color:#94a3b8}
</style></head>
<body><header>Sample website</header>
<main><div class="bar"></div><div class="bar m"></div><div class="bar s"></div><div class="bar"></div><div class="bar m"></div>
<p>This page stands in for your site. The widget loads into it exactly as it would in production.</p></main></body></html>`;

const sameState = (a: WidgetState | null, b: WidgetState | null) =>
  a === b ||
  (!!a && !!b && a.initialized === b.initialized && a.open === b.open && a.position === b.position && a.organizationId === b.organizationId);

export function useWidgetPreview() {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const logId = useRef(0);
  const stateRef = useRef<WidgetState | null>(null);

  const [frameKey, setFrameKey] = useState(0);
  const [bundleStatus, setBundleStatus] = useState<BundleStatus>("loading");
  const [widgetState, setWidgetState] = useState<WidgetState | null>(null);
  const [lastAction, setLastAction] = useState<LastAction>("none");
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [supportsState, setSupportsState] = useState(true);

  const log = useCallback((level: LogLevel, message: string) => {
    setLogs((prev) =>
      [...prev, { id: ++logId.current, at: new Date(), level, message }].slice(-MAX_LOG_ENTRIES),
    );
  }, []);

  const getApi = useCallback((): WidgetApi | null => {
    const api = (iframeRef.current?.contentWindow as (Window & { AgentBridgeWidget?: WidgetApi }) | null | undefined)
      ?.AgentBridgeWidget;
    return api && typeof api.init === "function" ? api : null;
  }, []);

  // Pull the widget's real state. Returns it so callers can log accurate results.
  const sync = useCallback((): WidgetState | null => {
    const api = getApi();
    const next = api && typeof api.getState === "function" ? api.getState() : null;
    if (!sameState(stateRef.current, next)) {
      stateRef.current = next;
      setWidgetState(next);
    }
    return next;
  }, [getApi]);

  // Called when the sample page has loaded: forward its warnings/errors to the
  // log, then load the real bundle into it.
  const handleFrameLoad = useCallback(() => {
    const win = iframeRef.current?.contentWindow;
    const doc = iframeRef.current?.contentDocument;
    if (!win || !doc) return;

    for (const level of ["warn", "error"] as const) {
      const original = win.console[level].bind(win.console);
      win.console[level] = (...args: unknown[]) => {
        original(...args);
        log(level, args.map((a) => (a instanceof Error ? a.message : String(a))).join(" "));
      };
    }

    setBundleStatus("loading");
    const script = doc.createElement("script");
    script.src = EMBED_SCRIPT_URL;
    script.async = true;
    script.onload = () => {
      const api = getApi();
      if (!api) {
        setBundleStatus("missing-api");
        log(
          "error",
          "Bundle loaded, but window.AgentBridgeWidget was not registered. The served widget.js is likely out of date: rebuild apps/embed and redeploy it.",
        );
        return;
      }
      setBundleStatus("ready");
      setSupportsState(typeof api.getState === "function");
      if (typeof api.getState !== "function") {
        log("warn", "Bundle has no getState(); lifecycle badges cannot be verified. Rebuild apps/embed.");
      }
      log("success", "Widget bundle loaded.");
      sync();
    };
    script.onerror = () => {
      setBundleStatus("error");
      log("error", `Could not load the widget bundle from ${new URL(EMBED_SCRIPT_URL, window.location.href).host}. Check the URL, network and CSP.`);
    };
    doc.body.appendChild(script);
  }, [getApi, log, sync]);

  // The widget can change itself (visitor clicks the launcher, widget asks to
  // close), so observe it rather than trusting only our own calls.
  useEffect(() => {
    if (bundleStatus !== "ready") return;
    const id = window.setInterval(() => {
      const before = stateRef.current;
      const after = sync();
      if (before && after && before.open !== after.open) {
        log("info", after.open ? "Chat opened from the widget." : "Chat closed from the widget.");
      }
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [bundleStatus, log, sync]);

  const withApi = useCallback(
    (name: string, fn: (api: WidgetApi) => void) => {
      const api = getApi();
      if (!api) {
        log("error", `${name}() unavailable: the widget bundle is not ready.`);
        return;
      }
      try {
        fn(api);
      } catch (error) {
        log("error", `${name}() threw: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
    [getApi, log],
  );

  const init = useCallback(
    (organizationId: string, position: WidgetPosition) => {
      setLastAction("init");
      withApi("init", (api) => {
        const result = api.init({ organizationId, position });
        const state = sync();
        if (result === false || (state && !state.initialized)) {
          log("error", "init() rejected the configuration. See the preview errors above.");
        } else {
          log("success", `Initialized (position: ${position}).`);
        }
      });
    },
    [log, sync, withApi],
  );

  const show = useCallback(() => {
    setLastAction("show");
    withApi("show", (api) => {
      api.show();
      const state = sync();
      log(state && !state.open ? "warn" : "info", state && !state.open ? "show() had no effect." : "Chat opened.");
    });
  }, [log, sync, withApi]);

  const hide = useCallback(() => {
    setLastAction("hide");
    withApi("hide", (api) => {
      api.hide();
      sync();
      log("info", "Chat hidden (launcher stays mounted).");
    });
  }, [log, sync, withApi]);

  const destroy = useCallback(() => {
    setLastAction("destroy");
    withApi("destroy", (api) => {
      api.destroy();
      sync();
      log("info", "Widget destroyed and removed from the page.");
    });
  }, [log, sync, withApi]);

  // Re-apply position to a live widget; the embed rebuilds it and keeps the
  // open/closed state.
  const applyPosition = useCallback(
    (position: WidgetPosition) => {
      if (!stateRef.current?.initialized) return;
      withApi("init", (api) => {
        api.init({ position });
        sync();
        log("info", `Position changed to ${position}.`);
      });
    },
    [log, sync, withApi],
  );

  const reload = useCallback(() => {
    stateRef.current = null;
    setWidgetState(null);
    setLastAction("none");
    setBundleStatus("loading");
    log("info", "Reloading preview.");
    setFrameKey((k) => k + 1);
  }, [log]);

  const clearLogs = useCallback(() => setLogs([]), []);

  return {
    iframeRef,
    frameKey,
    handleFrameLoad,
    bundleStatus,
    widgetState,
    lastAction,
    supportsState,
    logs,
    clearLogs,
    actions: { init, show, hide, destroy, applyPosition, reload },
  };
}
