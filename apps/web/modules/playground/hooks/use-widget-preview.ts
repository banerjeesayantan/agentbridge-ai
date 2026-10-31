"use client";

import { EMBED_SCRIPT_URL } from "@/modules/integrations/constants";
import type { WidgetPosition } from "@/modules/integrations/utils";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildPreviewDocument } from "../preview-document";

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

const MAX_LOG_ENTRIES = 100;
const RPC_TIMEOUT_MS = 4000;

type Command = "init" | "show" | "hide" | "destroy";
interface RpcResult {
  ok: boolean;
  result?: unknown;
  error?: string;
  state?: WidgetState | null;
}

const sameState = (a: WidgetState | null, b: WidgetState | null) =>
  a === b ||
  (!!a && !!b && a.initialized === b.initialized && a.open === b.open && a.position === b.position && a.organizationId === b.organizationId);

/**
 * Drives the sandboxed preview iframe over postMessage. The preview runs in an
 * opaque origin (see preview-document.ts), so nothing here reaches into its
 * window; every call is a request/response message, and only messages that
 * come from that iframe's own window are accepted.
 */
export function useWidgetPreview() {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const logId = useRef(0);
  const rpcId = useRef(0);
  const pending = useRef(new Map<number, (r: RpcResult) => void>());
  const stateRef = useRef<WidgetState | null>(null);
  const lastCommandAt = useRef(0);

  const [frameKey, setFrameKey] = useState(0);
  const [bundleStatus, setBundleStatus] = useState<BundleStatus>("loading");
  const [widgetState, setWidgetState] = useState<WidgetState | null>(null);
  const [lastAction, setLastAction] = useState<LastAction>("none");
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [supportsState, setSupportsState] = useState(true);

  const srcDoc = useMemo(() => buildPreviewDocument(EMBED_SCRIPT_URL), []);

  const log = useCallback((level: LogLevel, message: string) => {
    setLogs((prev) => [...prev, { id: ++logId.current, at: new Date(), level, message }].slice(-MAX_LOG_ENTRIES));
  }, []);

  const applyState = useCallback((next: WidgetState | null) => {
    if (!sameState(stateRef.current, next)) {
      stateRef.current = next;
      setWidgetState(next);
    }
  }, []);

  // Messages from the preview. Accept only our own iframe's window.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return;
      const data = event.data as { __ab?: number; type?: string } & Record<string, any>;
      if (!data || data.__ab !== 1) return;

      switch (data.type) {
        case "ready": {
          const status = data.status as "ready" | "missing-api" | "error";
          setBundleStatus(status);
          if (status === "ready") {
            setSupportsState(Boolean(data.hasGetState));
            if (!data.hasGetState) log("warn", "Bundle has no getState(); lifecycle badges cannot be verified. Rebuild apps/embed.");
            log("success", "Widget bundle loaded.");
          } else if (status === "missing-api") {
            log("error", "Bundle loaded, but window.AgentBridgeWidget was not registered. The served widget.js is likely out of date: rebuild apps/embed and redeploy it.");
          } else {
            let host = EMBED_SCRIPT_URL;
            try { host = new URL(EMBED_SCRIPT_URL, window.location.href).host; } catch {}
            log("error", `Could not load the widget bundle from ${host}. Check the URL, network and CSP.`);
          }
          break;
        }
        case "result": {
          const resolve = pending.current.get(data.id);
          if (resolve) {
            pending.current.delete(data.id);
            resolve({ ok: !!data.ok, result: data.result, error: data.error, state: data.state ?? null });
          }
          break;
        }
        case "state": {
          const before = stateRef.current;
          const next = (data.state ?? null) as WidgetState | null;
          applyState(next);
          // Only narrate changes the widget made itself (visitor clicked, widget asked to close).
          if (before && next && before.open !== next.open && Date.now() - lastCommandAt.current > 800) {
            log("info", next.open ? "Chat opened from the widget." : "Chat closed from the widget.");
          }
          break;
        }
        case "log": {
          const level = data.level === "error" ? "error" : "warn";
          log(level, String(data.message ?? "").slice(0, 500));
          break;
        }
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [applyState, log]);

  const call = useCallback((cmd: Command, args?: unknown): Promise<RpcResult> => {
    const win = iframeRef.current?.contentWindow;
    if (!win) return Promise.resolve({ ok: false, error: "preview-unavailable" });
    const id = ++rpcId.current;
    lastCommandAt.current = Date.now();
    return new Promise<RpcResult>((resolve) => {
      const timer = window.setTimeout(() => {
        pending.current.delete(id);
        resolve({ ok: false, error: "timeout" });
      }, RPC_TIMEOUT_MS);
      pending.current.set(id, (r) => {
        window.clearTimeout(timer);
        resolve(r);
      });
      // Opaque-origin target, so "*" is required; the payload holds only the public org ID and position.
      win.postMessage({ __ab: 1, id, cmd, args }, "*");
    });
  }, []);

  const run = useCallback(
    async (name: Command, args: unknown, onOk: (r: RpcResult) => void) => {
      const r = await call(name, args);
      if (r.state !== undefined) applyState(r.state ?? null);
      if (!r.ok) {
        log("error", `${name}() failed: ${r.error === "bundle-not-ready" ? "the widget bundle is not ready." : r.error ?? "unknown error"}`);
        return;
      }
      onOk(r);
    },
    [applyState, call, log],
  );

  const init = useCallback(
    (organizationId: string, position: WidgetPosition) => {
      setLastAction("init");
      void run("init", { organizationId, position }, (r) => {
        if (r.result === false || (r.state && !r.state.initialized)) {
          log("error", "init() rejected the configuration. See the preview errors above.");
        } else {
          log("success", `Initialized (position: ${position}).`);
        }
      });
    },
    [log, run],
  );

  const show = useCallback(() => {
    setLastAction("show");
    void run("show", undefined, (r) => {
      const noEffect = r.state && !r.state.open;
      log(noEffect ? "warn" : "info", noEffect ? "show() had no effect." : "Chat opened.");
    });
  }, [log, run]);

  const hide = useCallback(() => {
    setLastAction("hide");
    void run("hide", undefined, () => log("info", "Chat hidden (launcher stays mounted)."));
  }, [log, run]);

  const destroy = useCallback(() => {
    setLastAction("destroy");
    void run("destroy", undefined, () => log("info", "Widget destroyed and removed from the page."));
  }, [log, run]);

  // Re-apply position to a live widget; the embed rebuilds it and keeps the open state.
  const applyPosition = useCallback(
    (position: WidgetPosition) => {
      if (!stateRef.current?.initialized) return;
      void run("init", { position }, () => log("info", `Position changed to ${position}.`));
    },
    [log, run],
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
    srcDoc,
    bundleStatus,
    widgetState,
    lastAction,
    supportsState,
    logs,
    clearLogs,
    actions: { init, show, hide, destroy, applyPosition, reload },
  };
}
