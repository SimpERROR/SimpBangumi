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
  html = replaceTagPair(html, "mask", (content) => `<span class="bbcode-mask">${content}</span>`);

  html = html.replace(/\[url=([^\]]+)\]([\s\S]*?)\[\/url\]/gi, (_, href: string, text: string) => {
    const safeHref = sanitizeHref(href);
    return `<a href="${safeHref}" target="_blank" rel="noreferrer">${text}</a>`;
  });

  html = html.replace(/\[url\]([\s\S]*?)\[\/url\]/gi, (_, href: string) => {
    const safeHref = sanitizeHref(href);
    return `<a href="${safeHref}" target="_blank" rel="noreferrer">${href}</a>`;
  });

  return html.replace(/\r?\n/g, "<br>");
}
