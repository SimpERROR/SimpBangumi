import { ref, watch, onMounted, onUnmounted } from "vue";

const LINK_CONFIRM_ENABLED_KEY = "bangumi.linkConfirm.enabled";
const LINK_CONFIRM_SKIPPED_DOMAINS_KEY = "bangumi.linkConfirm.skippedDomains";

/** Global reactive state shared across the app for link confirmation. */
export const linkModalVisible = ref(false);
export const pendingUrl = ref("");

/** Master toggle — when false, links open immediately without confirmation. */
export const linkConfirmEnabled = ref(loadLinkConfirmEnabled());

/** Domains the user has chosen to skip confirmation for. */
export const linkConfirmSkippedDomains = ref<Set<string>>(loadSkippedDomains());

let cleanup: (() => void) | null = null;

function loadLinkConfirmEnabled(): boolean {
  return localStorage.getItem(LINK_CONFIRM_ENABLED_KEY) !== "false";
}

function loadSkippedDomains(): Set<string> {
  try {
    const raw = localStorage.getItem(LINK_CONFIRM_SKIPPED_DOMAINS_KEY);
    if (raw) {
      const arr: string[] = JSON.parse(raw);
      if (Array.isArray(arr)) return new Set(arr);
    }
  } catch { /* ignore corrupt data */ }
  return new Set();
}

function persistSkippedDomains() {
  localStorage.setItem(
    LINK_CONFIRM_SKIPPED_DOMAINS_KEY,
    JSON.stringify([...linkConfirmSkippedDomains.value]),
  );
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

function isExternalLink(href: string): boolean {
  return /^(https?:\/\/|mailto:)/i.test(href);
}

function onDocumentClick(event: MouseEvent) {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;

  const anchor = target.closest<HTMLAnchorElement>("a[href]");
  if (!anchor) return;

  const href = anchor.getAttribute("href");
  if (!href || href === "#" || href.startsWith("javascript:")) return;
  if (!isExternalLink(href)) return;

  event.preventDefault();
  event.stopPropagation();

  // If confirmation is disabled, open immediately
  if (!linkConfirmEnabled.value) {
    openUrlDirectly(href);
    return;
  }

  // If this domain is in the skip list, open immediately
  const domain = extractDomain(href);
  if (domain && linkConfirmSkippedDomains.value.has(domain)) {
    openUrlDirectly(href);
    return;
  }

  pendingUrl.value = href;
  linkModalVisible.value = true;
}

async function openUrlDirectly(url: string) {
  try {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
  } catch {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

export function cancelOpenLink() {
  linkModalVisible.value = false;
  pendingUrl.value = "";
}

export async function confirmOpenLink() {
  const url = pendingUrl.value;
  linkModalVisible.value = false;
  pendingUrl.value = "";

  if (!url) return;
  await openUrlDirectly(url);
}

/** Add the domain of the currently pending URL to the skip list and open it. */
export async function skipDomainAndOpen() {
  const url = pendingUrl.value;
  const domain = extractDomain(url);
  linkModalVisible.value = false;
  pendingUrl.value = "";

  if (domain) {
    linkConfirmSkippedDomains.value.add(domain);
    persistSkippedDomains();
  }

  if (url) {
    await openUrlDirectly(url);
  }
}

// Persist master toggle changes
watch(linkConfirmEnabled, (value) => {
  localStorage.setItem(LINK_CONFIRM_ENABLED_KEY, String(value));
});

/**
 * Activate the global link interceptor. Call once in App.vue onMounted.
 */
export function useLinkInterceptor() {
  onMounted(() => {
    if (cleanup) return;
    document.addEventListener("click", onDocumentClick, true);
    cleanup = () => document.removeEventListener("click", onDocumentClick, true);
  });

  onUnmounted(() => {
    cleanup?.();
    cleanup = null;
  });

  return {
    linkModalVisible,
    pendingUrl,
    linkConfirmEnabled,
    linkConfirmSkippedDomains,
    cancelOpenLink,
    confirmOpenLink,
    skipDomainAndOpen,
  };
}
