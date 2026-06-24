// Stable, URL/testid-safe slug for a theme name. Kept out of theme-card.tsx so
// that module exports only its component (Fast Refresh requirement); the card
// and the first-run theme step both derive testids from this.
export function themeSlug(name: string): string {
  return name.toLowerCase().replace(/\s+/g, "-");
}
