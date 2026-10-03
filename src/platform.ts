/** Native mobile shells do not expose the desktop window and filesystem UX. */
export const isMobilePlatform = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
export const isDesktopPlatform = !isMobilePlatform;
