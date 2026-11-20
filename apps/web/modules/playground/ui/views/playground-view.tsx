"use client";

import { useOrganization } from "@clerk/nextjs";
import { useAction } from "convex/react";
import { api } from "@workspace/backend/_generated/api";
import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@workspace/ui/components/card";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import { ScrollArea } from "@workspace/ui/components/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select";
import { Separator } from "@workspace/ui/components/separator";
import { SidebarTrigger } from "@workspace/ui/components/sidebar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@workspace/ui/components/tabs";
import { ToggleGroup, ToggleGroupItem } from "@workspace/ui/components/toggle-group";
import { cn } from "@workspace/ui/lib/utils";
import {
  AlertTriangleIcon,
  EyeIcon,
  EyeOffIcon,
  MonitorIcon,
  PlayIcon,
  RefreshCwIcon,
  SmartphoneIcon,
  Trash2Icon,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { PLAYGROUND_EMBED_SCRIPT_URL, INTEGRATIONS, type IntegrationId } from "@/modules/integrations/constants";
import { createScript, type WidgetPosition } from "@/modules/integrations/utils";
import { CodeBlock } from "@/modules/integrations/ui/components/code-block";
import {
  PREVIEW_SRC_DOC,
  useWidgetPreview,
  type BundleStatus,
  type LogLevel,
} from "../../hooks/use-widget-preview";

type Tone = "neutral" | "success" | "warn" | "error";

const TONE_CLASS: Record<Tone, string> = {
  neutral: "text-muted-foreground",
  success: "border-emerald-500/40 text-emerald-700 dark:text-emerald-400",
  warn: "border-amber-500/40 text-amber-700 dark:text-amber-400",
  error: "border-destructive/50 text-destructive",
};

const LOG_CLASS: Record<LogLevel, string> = {
  info: "text-muted-foreground",
  success: "text-emerald-700 dark:text-emerald-400",
  warn: "text-amber-700 dark:text-amber-400",
  error: "text-destructive",
};

const StatusBadge = ({ tone, children }: { tone: Tone; children: React.ReactNode }) => (
  <Badge className={cn("gap-1.5", TONE_CLASS[tone])} variant="outline">
    <span aria-hidden className="size-1.5 rounded-full bg-current" />
    {children}
  </Badge>
);

const BUNDLE_LABEL: Record<BundleStatus, { tone: Tone; text: string }> = {
  loading: { tone: "neutral", text: "Bundle loading" },
  ready: { tone: "success", text: "Bundle ready" },
  "missing-api": { tone: "error", text: "Bundle outdated" },
  error: { tone: "error", text: "Bundle failed" },
};

const POSITION_LABEL: Record<WidgetPosition, string> = {
  "bottom-right": "Bottom right",
  "bottom-left": "Bottom left",
};

export const PlaygroundView = () => {
  const { organization, isLoaded } = useOrganization();
  const orgId = organization?.id ?? "";
  const authorizePreview = useAction(api.public.widgetSettings.getPreviewToken);

  const [position, setPosition] = useState<WidgetPosition>("bottom-right");
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [framework, setFramework] = useState<IntegrationId>("html");
  const [previewToken, setPreviewToken] = useState<string | null>(null);
  const [previewTokenError, setPreviewTokenError] = useState<string | null>(null);

  const preview = useWidgetPreview();
  const { bundleStatus, isInitializing, widgetState, lastAction, supportsState, actions } = preview;
  const autoInitKey = useRef<string | null>(null);

  // Mint a short-lived token using the signed-in organization context. This
  // lets the Playground preview work without weakening customer-site origin
  // allowlists.
  useEffect(() => {
    if (!isLoaded || !orgId) {
      setPreviewToken(null);
      setPreviewTokenError(null);
      return;
    }
    let cancelled = false;
    setPreviewToken(null);
    setPreviewTokenError(null);
    void authorizePreview({ origin: window.location.origin })
      .then(({ token }) => {
        if (!cancelled) setPreviewToken(token);
      })
      .catch((error) => {
        if (!cancelled) {
          setPreviewTokenError(error instanceof Error ? error.message : "Could not authorize the widget preview.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [isLoaded, orgId, preview.frameKey, authorizePreview]);

  // Once the bundle, organization, and preview authorization are ready,
  // initialize the actual widget automatically.
  useEffect(() => {
    if (bundleStatus !== "ready" || !orgId || !previewToken) return;
    const key = `${preview.frameKey}:${orgId}:${position}`;
    if (autoInitKey.current === key) return;
    autoInitKey.current = key;
    actions.init(orgId, position, previewToken);
  }, [bundleStatus, orgId, previewToken, position, preview.frameKey, actions.init]);

  const ready = bundleStatus === "ready";
  const initialized = widgetState?.initialized ?? false;
  const open = widgetState?.open ?? false;

  // With a bundle that cannot report state we cannot know what is valid, so
  // leave the controls available rather than blocking them on a guess.
  const canInit = ready && !!orgId && !!previewToken && !isInitializing;
  const canShow = ready && (!supportsState || (initialized && !open));
  const canHide = ready && (!supportsState || (initialized && open));
  const canDestroy = ready && (!supportsState || initialized);

  const widgetBadge = !ready
    ? null
    : !supportsState
      ? { tone: "warn" as Tone, text: "State unknown" }
      : isInitializing
        ? { tone: "warn" as Tone, text: "Initializing" }
        : initialized
          ? open
            ? { tone: "success" as Tone, text: "Open" }
            : { tone: "neutral" as Tone, text: "Hidden" }
          : { tone: "neutral" as Tone, text: lastAction === "destroy" ? "Destroyed" : "Not initialized" };

  const bundle = BUNDLE_LABEL[bundleStatus];

  const toolbarHint = !isLoaded
    ? "Loading organization…"
    : !orgId
      ? "Select an organization to initialize the widget."
      : previewTokenError
        ? `Preview authorization failed: ${previewTokenError}`
        : !previewToken
          ? "Preparing secure preview authorization…"
          : isInitializing
        ? "Authorizing the widget and waiting for it to mount…"
        : bundleStatus === "loading"
        ? "Waiting for the widget bundle…"
        : !ready
          ? "Lifecycle controls are disabled until the bundle loads."
          : null;

  const snippet = createScript(framework, orgId || "YOUR_ORGANIZATION_ID", position);

  return (
    <div className="flex min-h-svh w-full min-w-0 max-w-full flex-col overflow-x-hidden bg-muted xl:h-svh xl:overflow-hidden">
      <header className="flex min-h-14 shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b bg-background px-3 py-2 sm:px-4">
        <SidebarTrigger aria-label="Toggle sidebar" />
        <Separator className="h-5" orientation="vertical" />
        <h1 className="font-semibold text-base">Playground</h1>
        <div aria-live="polite" className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2">
          <StatusBadge tone={bundle.tone}>{bundle.text}</StatusBadge>
          {widgetBadge && <StatusBadge tone={widgetBadge.tone}>{widgetBadge.text}</StatusBadge>}
        </div>
      </header>

      <div className="grid w-full min-w-0 flex-1 grid-cols-1 gap-3 p-2 sm:gap-4 sm:p-4 xl:min-h-0 xl:grid-cols-[minmax(0,1fr)_minmax(320px,380px)]">
        {/* Preview canvas */}
        <Card className="flex min-h-[400px] min-w-0 max-w-full flex-col gap-0 overflow-hidden py-0 sm:min-h-[460px] xl:min-h-0">
          <CardHeader className="flex flex-col items-stretch gap-3 border-b px-3 py-3 sm:flex-row sm:items-center sm:px-4">
            <div className="flex w-full min-w-0 flex-wrap items-center gap-2 sm:w-auto" role="toolbar" aria-label="Widget lifecycle">
              <Button disabled={!canInit} onClick={() => actions.init(orgId, position, previewToken ?? undefined)} size="sm" type="button">
                <PlayIcon />
                {isInitializing ? "Initializing…" : "Initialize"}
              </Button>
              <Button disabled={!canShow} onClick={actions.show} size="sm" type="button" variant="outline">
                <EyeIcon />
                Show
              </Button>
              <Button disabled={!canHide} onClick={actions.hide} size="sm" type="button" variant="outline">
                <EyeOffIcon />
                Hide
              </Button>
              <Button disabled={!canDestroy} onClick={actions.destroy} size="sm" type="button" variant="outline">
                <Trash2Icon />
                Destroy
              </Button>
            </div>
            <ToggleGroup
              aria-label="Preview size"
              className="ml-0 shrink-0 self-start sm:ml-auto sm:self-auto"
              onValueChange={(value) => value && setDevice(value as "desktop" | "mobile")}
              type="single"
              value={device}
              variant="outline"
            >
              <ToggleGroupItem aria-label="Desktop preview" value="desktop">
                <MonitorIcon className="size-4" />
              </ToggleGroupItem>
              <ToggleGroupItem aria-label="Mobile preview" value="mobile">
                <SmartphoneIcon className="size-4" />
              </ToggleGroupItem>
            </ToggleGroup>
          </CardHeader>

          {(toolbarHint || bundleStatus === "error" || bundleStatus === "missing-api") && (
            <div className="space-y-2 px-4 pt-3">
              {toolbarHint && <p className="text-muted-foreground text-xs">{toolbarHint}</p>}
              {(bundleStatus === "error" || bundleStatus === "missing-api") && (
                <Alert variant="destructive">
                  <AlertTriangleIcon />
                  <AlertTitle>
                    {bundleStatus === "error" ? "Widget bundle could not be loaded" : "Widget bundle is out of date"}
                  </AlertTitle>
                  <AlertDescription>
                    <p>
                      {bundleStatus === "error"
                        ? "Check that the script URL is reachable. See the Diagnostics tab for details."
                        : "The served widget.js does not expose window.AgentBridgeWidget. Rebuild apps/embed and redeploy the bundle."}
                    </p>
                    <Button onClick={actions.reload} size="sm" type="button" variant="outline">
                      <RefreshCwIcon />
                      Retry
                    </Button>
                  </AlertDescription>
                </Alert>
              )}
            </div>
          )}

          <CardContent className="flex min-h-[300px] min-w-0 flex-1 items-stretch justify-center overflow-hidden p-2 sm:min-h-[360px] sm:p-4 xl:min-h-0">
            <div
              className={cn(
                "h-full min-h-0 w-full overflow-hidden border bg-white shadow-sm transition-[max-width] duration-200",
                device === "mobile" ? "max-w-[375px] rounded-[1.75rem] border-4 border-foreground/80" : "rounded-lg",
              )}
            >
              <iframe
                className="size-full min-h-0 bg-white"
                key={preview.frameKey}
                onLoad={preview.handleFrameLoad}
                ref={preview.iframeRef}
                srcDoc={PREVIEW_SRC_DOC}
                title="Widget preview on a sample website"
              />
            </div>
          </CardContent>
        </Card>

        {/* Configure / Install / Diagnostics */}
        <Card className="flex min-h-[400px] min-w-0 max-w-full flex-col gap-0 overflow-hidden py-0 sm:min-h-[460px] xl:min-h-0">
          <Tabs className="flex min-h-0 flex-1 flex-col gap-0" defaultValue="configure">
            <div className="border-b p-3">
              <TabsList className="grid h-auto w-full grid-cols-3">
                <TabsTrigger className="min-w-0 px-2 text-xs sm:text-sm" value="configure">Configure</TabsTrigger>
                <TabsTrigger className="min-w-0 px-2 text-xs sm:text-sm" value="install">Install</TabsTrigger>
                <TabsTrigger className="min-w-0 px-2 text-xs sm:text-sm" value="diagnostics">Diagnostics</TabsTrigger>
              </TabsList>
            </div>

            <ScrollArea className="min-h-0 flex-1">
              <TabsContent className="space-y-5 p-4" value="configure">
                <div className="space-y-2">
                  <Label htmlFor="playground-org-id">Organization ID</Label>
                  <Input
                    className="font-mono text-sm"
                    id="playground-org-id"
                    readOnly
                    value={orgId}
                    placeholder={isLoaded ? "No organization selected" : "Loading…"}
                  />
                  <p className="text-muted-foreground text-xs">
                    An identifier, not a credential. The backend decides what each organization can access.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="playground-position">Position</Label>
                  <Select
                    onValueChange={(value) => {
                      const next = value as WidgetPosition;
                      setPosition(next);
                    }}
                    value={position}
                  >
                    <SelectTrigger className="w-full" id="playground-position">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(POSITION_LABEL) as WidgetPosition[]).map((value) => (
                        <SelectItem key={value} value={value}>
                          {POSITION_LABEL[value]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-muted-foreground text-xs">
                    Applied live if the widget is already initialized.
                  </p>
                </div>

                <Separator />
                <p className="text-muted-foreground text-sm">
                  Greeting, suggested questions and voice settings are managed in{" "}
                  <Link className="text-primary underline underline-offset-4" href="/customization">
                    Widget Customization
                  </Link>
                  .
                </p>
              </TabsContent>

              <TabsContent className="space-y-5 p-4" value="install">
                <ToggleGroup
                  aria-label="Integration type"
                  className="flex w-full flex-wrap justify-start gap-1"
                  onValueChange={(value) => value && setFramework(value as IntegrationId)}
                  type="single"
                  value={framework}
                  variant="outline"
                >
                  {INTEGRATIONS.map((integration) => (
                    <ToggleGroupItem className="min-w-0 flex-1 px-2 text-xs sm:text-sm" key={integration.id} value={integration.id}>
                      {integration.title}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>

                <ol className="space-y-4 text-sm">
                  <li className="space-y-2">
                    <p className="font-medium">1. Copy the snippet</p>
                    <CodeBlock code={snippet} label={`${INTEGRATIONS.find((i) => i.id === framework)?.title} embed snippet`} />
                    {!orgId && (
                      <p className="text-muted-foreground text-xs">
                        Select an organization to fill in your real ID.
                      </p>
                    )}
                  </li>
                  <li className="space-y-1">
                    <p className="font-medium">2. Add it to your site</p>
                    <p className="text-muted-foreground">
                      {framework === "html" || framework === "javascript"
                        ? "Paste it just before the closing </body> tag of every page that should show the chat."
                        : "Add it to your root layout or app shell so it loads once, on every page."}
                    </p>
                  </li>
                  <li className="space-y-1">
                    <p className="font-medium">3. Verify</p>
                    <p className="text-muted-foreground">
                      Open your site: the chat launcher appears in the {POSITION_LABEL[position].toLowerCase()} corner. In
                      the browser console,{" "}
                      <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
                        AgentBridgeWidget.getState()
                      </code>{" "}
                      should report <code className="font-mono text-xs">initialized: true</code>.
                    </p>
                  </li>
                </ol>

                <Separator />
                <div className="space-y-2 text-sm">
                  <p className="font-medium">Troubleshooting</p>
                  <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
                    <li>No launcher: check the console for an AgentBridge Widget error and that the script URL loads.</li>
                    <li>Blocked by CSP: allow the script host in <code className="font-mono text-xs">script-src</code> and the widget host in <code className="font-mono text-xs">frame-src</code>.</li>
                    <li>Script added twice: the second copy is ignored and logs a warning.</li>
                  </ul>
                </div>
              </TabsContent>

              <TabsContent className="space-y-5 p-4" value="diagnostics">
                <Card className="gap-0 py-0">
                  <CardHeader className="px-4 py-3">
                    <CardTitle className="text-sm">Status</CardTitle>
                    <CardDescription className="text-xs">Read from the live preview.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2 px-4 pb-4 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-muted-foreground">Bundle</span>
                      <StatusBadge tone={bundle.tone}>{bundle.text}</StatusBadge>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-muted-foreground">Widget</span>
                      {widgetBadge ? (
                        <StatusBadge tone={widgetBadge.tone}>{widgetBadge.text}</StatusBadge>
                      ) : (
                        <span className="text-muted-foreground text-xs">Unavailable</span>
                      )}
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-muted-foreground">Script</span>
                      <span className="truncate font-mono text-xs" title={PLAYGROUND_EMBED_SCRIPT_URL}>
                        {PLAYGROUND_EMBED_SCRIPT_URL}
                      </span>
                    </div>
                  </CardContent>
                </Card>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="font-medium text-sm">Event log</p>
                    <Button
                      disabled={preview.logs.length === 0}
                      onClick={preview.clearLogs}
                      size="sm"
                      type="button"
                      variant="ghost"
                    >
                      Clear
                    </Button>
                  </div>
                  <ol
                    aria-label="Widget event log"
                    className="max-h-80 space-y-1.5 overflow-y-auto rounded-md border bg-background p-3 font-mono text-xs"
                    role="log"
                  >
                    {preview.logs.length === 0 ? (
                      <li className="text-muted-foreground">No events yet.</li>
                    ) : (
                      preview.logs.map((entry) => (
                        <li className="flex gap-2" key={entry.id}>
                          <time className="shrink-0 text-muted-foreground" dateTime={entry.at.toISOString()}>
                            {entry.at.toLocaleTimeString([], { hour12: false })}
                          </time>
                          <span className={cn("break-words", LOG_CLASS[entry.level])}>{entry.message}</span>
                        </li>
                      ))
                    )}
                  </ol>
                </div>
              </TabsContent>
            </ScrollArea>
          </Tabs>
        </Card>
      </div>
    </div>
  );
};
