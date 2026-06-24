// Builds a workspace branch name from the user's naming scheme
// (general.namingScheme, e.g. "feature/{feature-name}") instead of the sidecar's
// random callsign. {feature-name} is a slug of the task title; supported tokens:
// {feature-name}, {backend}, {date}. A scheme with no {feature-name} token is
// treated as a prefix and the slug is appended (so "feature/" → "feature/<slug>").

/** Lowercase, hyphenated, git-safe slug. Falls back to "workspace" when empty. */
export function slugify(input: string): string {
  const slug = input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "workspace";
}

export interface BranchVars {
  featureName: string;
  backend?: string;
  date?: string;
}

export function applyNamingScheme(scheme: string, vars: BranchVars): string {
  const slug = slugify(vars.featureName);
  const date = vars.date ?? new Date().toISOString().slice(0, 10);
  const filled = scheme
    .replace(/\{feature-name\}/g, slug)
    .replace(/\{backend\}/g, vars.backend ?? "")
    .replace(/\{date\}/g, date)
    .replace(/\{branch\}/g, "");
  if (scheme.includes("{feature-name}")) {
    // Clean any separators left by empty tokens, e.g. trailing/double slashes.
    return filled.replace(/\/{2,}/g, "/").replace(/^\/+|\/+$/g, "") || slug;
  }
  // No {feature-name} token: treat the scheme as a prefix and append the slug.
  const prefix = filled.replace(/\/+$/, "");
  return prefix ? `${prefix}/${slug}` : slug;
}
