// HTML sanitizer for AI-generated content.
//
// Claude returns rich text (e.g. <b>bold</b>) in the "context" field. We render
// it with dangerouslySetInnerHTML so the formatting shows up. To defend against
// any future prompt-injection or unexpected output that might contain <script>,
// <img onerror>, etc., we run every such string through DOMPurify with a strict
// allowlist: bold/italic/break/paragraph tags only, no attributes, no URLs.

import DOMPurify from "dompurify";

const CONFIG = {
  ALLOWED_TAGS: ["b", "strong", "i", "em", "u", "br", "p", "span"],
  ALLOWED_ATTR: [],
  // Belt and suspenders: even if a tag slips through, no event handlers run.
  FORBID_ATTR: ["onerror", "onload", "onclick", "onmouseover", "style"],
  FORBID_TAGS: ["script", "iframe", "object", "embed", "form", "input", "img", "a"],
  RETURN_TRUSTED_TYPE: false,
};

export function sanitizeContextHtml(input: string | null | undefined): string {
  if (!input) return "";
  return DOMPurify.sanitize(String(input), CONFIG) as unknown as string;
}
