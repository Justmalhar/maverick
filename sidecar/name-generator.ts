// Aviator-callsign workspace names, Conductor-style: short, memorable, unique
// per repo. Collisions fall back to a numeric suffix so generation never fails.
const CALLSIGNS = [
  "viper", "goose", "phoenix", "raptor", "maverick", "iceman", "jester",
  "merlin", "hollywood", "wolfman", "slider", "sundown", "chipper", "cougar",
  "stinger", "falcon", "hawk", "eagle", "condor", "kestrel", "harrier",
  "osprey", "talon", "griffin", "hornet", "wasp", "scorpion", "cobra",
  "python", "mamba", "viperidae", "lancer", "saber", "rapier", "cutlass",
  "corsair", "crusader", "phantom", "spectre", "banshee", "demon", "voodoo",
  "delta", "echo", "foxtrot", "tango", "bravo", "sierra", "kilo", "zulu",
  "nova", "comet", "meteor", "quasar", "pulsar", "nebula", "orion", "vega",
  "altair", "rigel", "sirius", "polaris", "lyra", "draco", "cygnus", "atlas",
  "titan", "juno", "apollo", "artemis", "ares", "hermes", "boreas", "zephyr",
] as const;

export interface NameGeneratorOptions {
  // Injectable RNG for deterministic tests; defaults to Math.random.
  random?: () => number;
}

export function slugify(input: string): string {
  const slug = input
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return slug || "workspace";
}

export function titleize(slug: string): string {
  return slug
    .split("-")
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
    .join(" ");
}

// Picks a callsign not present in `taken`. Once the pool is exhausted, reuses
// callsigns with -2, -3, … suffixes, so the result is always unique.
export function generateWorkspaceName(
  taken: Iterable<string>,
  opts: NameGeneratorOptions = {}
): string {
  const random = opts.random ?? Math.random;
  const used = new Set<string>();
  for (const name of taken) used.add(name.toLowerCase());

  const start = Math.floor(random() * CALLSIGNS.length);
  for (let i = 0; i < CALLSIGNS.length; i++) {
    const candidate = CALLSIGNS[(start + i) % CALLSIGNS.length];
    if (!used.has(candidate)) return candidate;
  }
  for (let suffix = 2; ; suffix++) {
    for (let i = 0; i < CALLSIGNS.length; i++) {
      const candidate = `${CALLSIGNS[(start + i) % CALLSIGNS.length]}-${suffix}`;
      if (!used.has(candidate)) return candidate;
    }
  }
}
