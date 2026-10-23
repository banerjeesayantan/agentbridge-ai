import { EMBED_CONFIG } from './config';
import { chatBubbleIcon, closeIcon } from './icons';

type Position = 'bottom-right' | 'bottom-left';

interface WidgetConfig {
  organizationId?: string;
  position?: Position;
}

interface WidgetState {
  initialized: boolean;
  open: boolean;
  organizationId: string | null;
  position: Position;
}

const LOG_PREFIX = 'AgentBridge Widget:';
const BUTTON_ID = 'agentbridge-widget-button';
const CONTAINER_ID = 'agentbridge-widget-container';
const POSITIONS: readonly Position[] = ['bottom-right', 'bottom-left'];
// Organization IDs are identifiers (e.g. "org_abc123"), never credentials.
const ORG_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const HIDE_ANIMATION_MS = 300;

(function () {
  // Vite's IIFE wrapper (`extend: true`) pre-creates `window.AgentBridgeWidget`
  // as an empty object, so only treat it as "already loaded" when it carries a
  // real API. This protects against the script being included twice.
  const existing = (window as any).AgentBridgeWidget;
  if (existing && typeof existing.init === 'function') {
    console.warn(`${LOG_PREFIX} script included more than once; keeping the first instance.`);
    return;
  }

  let iframe: HTMLIFrameElement | null = null;
  let container: HTMLDivElement | null = null;
  let button: HTMLButtonElement | null = null;
  let isOpen = false;
  let hideTimer: number | undefined;
  let showTimer: number | undefined;
  let listening = false;

  let organizationId: string | null = null;
  let position: Position = EMBED_CONFIG.DEFAULT_POSITION;

  const reduceMotion =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function isPosition(value: unknown): value is Position {
    return typeof value === 'string' && (POSITIONS as readonly string[]).includes(value);
  }

  function isValidOrganizationId(value: unknown): value is string {
    return typeof value === 'string' && ORG_ID_PATTERN.test(value);
  }

  function widgetOrigin(): string {
    return new URL(EMBED_CONFIG.WIDGET_URL).origin;
  }

  function buildWidgetUrl(orgId: string): string {
    const params = new URLSearchParams();
    params.append('organizationId', orgId);
    return `${EMBED_CONFIG.WIDGET_URL}?${params.toString()}`;
  }

  function isMounted(): boolean {
    return container !== null && button !== null;
  }

  function clearTimers() {
    window.clearTimeout(hideTimer);
    window.clearTimeout(showTimer);
    hideTimer = undefined;
    showTimer = undefined;
  }

  function render() {
    const orgId = organizationId!;
    const side = position === 'bottom-right' ? 'right: 20px;' : 'left: 20px;';
    const transition = reduceMotion ? 'none' : 'all 0.2s ease';
    const panelTransition = reduceMotion ? 'none' : 'all 0.3s ease';

    const nextButton = document.createElement('button');
    const nextContainer = document.createElement('div');
    const nextIframe = document.createElement('iframe');

    try {
      nextButton.id = BUTTON_ID;
      nextButton.type = 'button';
      nextButton.setAttribute('aria-label', 'Open support chat');
      nextButton.setAttribute('aria-expanded', 'false');
      nextButton.setAttribute('aria-controls', CONTAINER_ID);
      nextButton.innerHTML = chatBubbleIcon;
      nextButton.style.cssText = `
        position: fixed;
        ${side}
        bottom: 20px;
        width: 60px;
        height: 60px;
        border-radius: 50%;
        background: #3b82f6;
        color: white;
        border: none;
        cursor: pointer;
        z-index: 999999;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 4px 24px rgba(59, 130, 246, 0.35);
        transition: ${transition};
      `;
      nextButton.addEventListener('click', toggleWidget);
      nextButton.addEventListener('mouseenter', () => {
        nextButton.style.transform = 'scale(1.05)';
      });
      nextButton.addEventListener('mouseleave', () => {
        nextButton.style.transform = 'scale(1)';
      });

      nextContainer.id = CONTAINER_ID;
      nextContainer.style.cssText = `
        position: fixed;
        ${side}
        bottom: 90px;
        width: 400px;
        height: 600px;
        max-width: calc(100vw - 40px);
        max-height: calc(100vh - 110px);
        z-index: 999998;
        border-radius: 16px;
        overflow: hidden;
        box-shadow: 0 4px 24px rgba(0, 0, 0, 0.15);
        display: none;
        opacity: 0;
        transform: translateY(10px);
        transition: ${panelTransition};
      `;

      nextIframe.title = 'Support chat';
      nextIframe.src = buildWidgetUrl(orgId);
      nextIframe.style.cssText = `
        width: 100%;
        height: 100%;
        border: none;
      `;
      nextIframe.allow = 'microphone; clipboard-read; clipboard-write';

      nextContainer.appendChild(nextIframe);
      document.body.appendChild(nextButton);
      document.body.appendChild(nextContainer);
    } catch (error) {
      // Never leave a half-mounted widget behind.
      nextButton.remove();
      nextContainer.remove();
      throw error;
    }

    button = nextButton;
    container = nextContainer;
    iframe = nextIframe;

    if (!listening) {
      window.addEventListener('message', handleMessage);
      listening = true;
    }
  }

  function handleMessage(event: MessageEvent) {
    if (!iframe || event.source !== iframe.contentWindow) return;
    if (event.origin !== widgetOrigin()) return;

    const data = event.data;
    if (!data || typeof data !== 'object') return;
    const { type, payload } = data as { type?: unknown; payload?: { height?: unknown } };

    switch (type) {
      case 'close':
        hide();
        break;
      case 'resize':
        if (container && payload && typeof payload.height === 'number' && payload.height > 0) {
          container.style.height = `${payload.height}px`;
        }
        break;
    }
  }

  function toggleWidget() {
    if (isOpen) {
      hide();
    } else {
      show();
    }
  }

  function show() {
    if (!container || !button) {
      console.warn(`${LOG_PREFIX} show() called before init().`);
      return;
    }
    if (isOpen) return;

    isOpen = true;
    clearTimers();
    container.style.display = 'block';
    // Next frame so the display change is painted before the transition runs.
    showTimer = window.setTimeout(() => {
      if (container && isOpen) {
        container.style.opacity = '1';
        container.style.transform = 'translateY(0)';
      }
    }, 10);
    button.innerHTML = closeIcon;
    button.setAttribute('aria-expanded', 'true');
    button.setAttribute('aria-label', 'Close support chat');
  }

  function hide() {
    if (!container || !button) {
      console.warn(`${LOG_PREFIX} hide() called before init().`);
      return;
    }
    if (!isOpen) return;

    isOpen = false;
    clearTimers();
    container.style.opacity = '0';
    container.style.transform = 'translateY(10px)';
    hideTimer = window.setTimeout(
      () => {
        // Skip if the widget was re-opened or destroyed during the animation.
        if (container && !isOpen) container.style.display = 'none';
      },
      reduceMotion ? 0 : HIDE_ANIMATION_MS,
    );
    button.innerHTML = chatBubbleIcon;
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-label', 'Open support chat');
  }

  function destroy() {
    clearTimers();
    if (listening) {
      window.removeEventListener('message', handleMessage);
      listening = false;
    }
    container?.remove();
    button?.remove();
    container = null;
    iframe = null;
    button = null;
    isOpen = false;
  }

  /**
   * Initialise (or re-initialise) the widget. Returns true when the widget is
   * mounted with the requested config, false when the config was rejected.
   * Calling it again with an unchanged config is a no-op; a changed config
   * rebuilds the widget so there is never more than one on the page.
   */
  function init(config?: WidgetConfig): boolean {
    const nextOrgId = config?.organizationId ?? organizationId;
    const nextPosition = config?.position ?? position;

    if (!isValidOrganizationId(nextOrgId)) {
      console.error(
        `${LOG_PREFIX} a valid organization ID is required (letters, numbers, "_" or "-"; max 128 characters).`,
      );
      return false;
    }
    if (!isPosition(nextPosition)) {
      console.error(`${LOG_PREFIX} unsupported position "${String(nextPosition)}". Use one of: ${POSITIONS.join(', ')}.`);
      return false;
    }

    if (isMounted() && nextOrgId === organizationId && nextPosition === position) {
      return true;
    }

    const wasOpen = isOpen;
    destroy();
    organizationId = nextOrgId;
    position = nextPosition;

    try {
      const mount = () => {
        render();
        if (wasOpen) show();
      };
      if (document.readyState === 'loading') {
        // Defer, but keep a single mount: destroy() cancels nothing here, so
        // guard against a second init() that landed before DOMContentLoaded.
        document.addEventListener(
          'DOMContentLoaded',
          () => {
            if (!isMounted() && organizationId === nextOrgId && position === nextPosition) mount();
          },
          { once: true },
        );
      } else {
        mount();
      }
    } catch (error) {
      destroy();
      console.error(`${LOG_PREFIX} failed to initialise.`, error);
      return false;
    }
    return true;
  }

  function getState(): WidgetState {
    return { initialized: isMounted(), open: isOpen, organizationId, position };
  }

  // Public API. `getState` is additive; init/show/hide/destroy are unchanged.
  (window as any).AgentBridgeWidget = { init, show, hide, destroy, getState };

  // Auto-initialise from the script tag when it carries an organization ID.
  // Without one the API is still registered so init({ organizationId }) works.
  const scriptTag =
    (document.currentScript as HTMLScriptElement | null) ??
    document.querySelector<HTMLScriptElement>('script[data-organization-id]');

  if (scriptTag) {
    const attrOrgId = scriptTag.getAttribute('data-organization-id');
    const attrPosition = scriptTag.getAttribute('data-position');
    if (attrOrgId) {
      init({
        organizationId: attrOrgId,
        position: isPosition(attrPosition) ? attrPosition : undefined,
      });
    }
  }
})();
