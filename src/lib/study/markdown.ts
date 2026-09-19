/**
 * Safe markdown subset for study guidelines. Escape HTML first, then apply
 * a small set of markers. Do not pass admin HTML through raw.
 */
export function renderStudyMarkdown(source: string): string {
  const escaped = escapeHtml(source.replace(/\r\n/g, "\n"));
  const blocks = escaped.split(/\n{2,}/);
  return blocks
    .map((block) => formatBlock(block.trim()))
    .filter(Boolean)
    .join("");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function inline(value: string): string {
  return value
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/_(.+?)_/g, "<em>$1</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

function formatBlock(block: string): string {
  if (!block) return "";
  if (block.startsWith("### ")) {
    return `<h3>${inline(block.slice(4))}</h3>`;
  }
  if (block.startsWith("## ")) {
    return `<h2>${inline(block.slice(3))}</h2>`;
  }
  if (block.startsWith("# ")) {
    return `<h1>${inline(block.slice(2))}</h1>`;
  }
  const lines = block.split("\n");
  if (lines.every((line) => /^[-*]\s+/.test(line))) {
    const items = lines
      .map((line) => `<li>${inline(line.replace(/^[-*]\s+/, ""))}</li>`)
      .join("");
    return `<ul>${items}</ul>`;
  }
  if (lines.every((line) => /^\d+\.\s+/.test(line))) {
    const items = lines
      .map((line) => `<li>${inline(line.replace(/^\d+\.\s+/, ""))}</li>`)
      .join("");
    return `<ol>${items}</ol>`;
  }
  return `<p>${inline(lines.join("<br/>"))}</p>`;
}
