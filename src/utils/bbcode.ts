function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function sanitizeHref(rawHref: string): string {
  const href = rawHref.trim().replace(/&amp;/g, "&");
  if (/^(https?:\/\/|mailto:|\/)/i.test(href)) {
    return href;
  }

  return "#";
}

const BBCodeColors = new Set(["red", "green", "blue", "orange"]);

function sanitizeColor(rawColor: string): string | undefined {
  const color = rawColor.trim().toLowerCase();
  if (BBCodeColors.has(color) || /^#[0-9a-f]{3,8}$/i.test(color)) {
    return color;
  }

  return undefined;
}

function sanitizeSize(rawSize: string): string | undefined {
  const size = rawSize.trim();
  const numericSize = Number(size);
  if (/^\d+$/.test(size) && numericSize >= 8 && numericSize <= 72) {
    return `${numericSize}px`;
  }

  return undefined;
}

function replaceTagPair(html: string, tag: string, replacer: (content: string) => string): string {
  const pattern = new RegExp(`\\[${tag}\\]([\\s\\S]*?)\\[\\/${tag}\\]`, "gi");
  let current = html;

  for (let i = 0; i < 10; i += 1) {
    if (!pattern.test(current)) {
      break;
    }

    current = current.replace(pattern, (_, content: string) => replacer(content));
  }

  return current;
}

export function renderBbcodeText(input?: string): string {
  const source = (input ?? "").trim();
  const escaped = escapeHtml(source.length > 0 ? source : "暂无简介");

  let html = escaped;
  html = replaceTagPair(html, "b", (content) => `<strong>${content}</strong>`);
  html = replaceTagPair(html, "i", (content) => `<em>${content}</em>`);
  html = replaceTagPair(html, "u", (content) => `<u>${content}</u>`);
  html = replaceTagPair(html, "s", (content) => `<s>${content}</s>`);
  html = replaceTagPair(html, "mask", (content) => `<span class="bbcode-mask">${content}</span>`);

  html = html.replace(/\[color=([^\]]+)\]([\s\S]*?)\[\/color\]/gi, (_, rawColor: string, content: string) => {
    const color = sanitizeColor(rawColor);
    return color ? `<span style="color: ${color}">${content}</span>` : content;
  });

  html = html.replace(/\[size=([^\]]+)\]([\s\S]*?)\[\/size\]/gi, (_, rawSize: string, content: string) => {
    const size = sanitizeSize(rawSize);
    return size ? `<span style="font-size: ${size}">${content}</span>` : content;
  });

  html = html.replace(/\[url=([^\]]+)\]([\s\S]*?)\[\/url\]/gi, (_, href: string, text: string) => {
    const safeHref = sanitizeHref(href);
    return `<a href="${safeHref}" target="_blank" rel="noreferrer">${text}</a>`;
  });

  html = html.replace(/\[url\]([\s\S]*?)\[\/url\]/gi, (_, href: string) => {
    const safeHref = sanitizeHref(href);
    return `<a href="${safeHref}" target="_blank" rel="noreferrer">${href}</a>`;
  });

  html = html.replace(/\[img\]([\s\S]*?)\[\/img\]/gi, (_, rawSrc: string) => {
    const src = sanitizeHref(rawSrc);
    return src === "#" ? rawSrc : `<img src="${src}" alt="" loading="lazy" />`;
  });

  // Auto-link plain text URLs not already inside <a> tags
  html = autoLinkInHtml(html);

  return html.replace(/\r?\n/g, "<br>");
}

import { autoLinkInHtml } from "./autoLink";
