import { z } from "zod";

export const domainSource =
  "https://raw.githubusercontent.com/Hipo/university-domains-list/a8fb652f5032801de7125a814aedf213b262a1a4/world_universities_and_domains.json";

const university = z.object({
  name: z.string(),
  domains: z.array(z.string()),
  alpha_two_code: z.string(),
});

type DirectoryCampus = { unitid: number; name: string; aliases: string; website: string };
const us = new Set(["US", "AS", "GU", "MP", "PR", "VI"]);
const edu = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+edu$/;
const normalizeName = (value: string) => value.normalize("NFKD").toLowerCase()
  .replace(/\p{M}/gu, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/^the /, "");
const normalizeDomain = (value: string) => value.trim().toLowerCase().replace(/\.$/, "");

function websiteDomain(value: string) {
  try {
    return normalizeDomain(new URL(value.includes("://") ? value : "https://" + value)
      .hostname).replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function matchCampusDomains(campuses: DirectoryCampus[], source: unknown) {
  const universities = z.array(university).min(1).parse(source);
  const sites = new Map<string, Set<number>>();
  const names = new Map<string, Set<number>>();
  const index = (map: Map<string, Set<number>>, key: string, id: number) => {
    if (!key) return;
    const ids = map.get(key) ?? new Set<number>();
    ids.add(id);
    map.set(key, ids);
  };

  for (const campus of campuses) {
    index(sites, websiteDomain(campus.website), campus.unitid);
    for (const name of [campus.name, ...campus.aliases.split(/[,;|]/)]) {
      index(names, normalizeName(name), campus.unitid);
    }
  }

  const owners = new Map<string, Set<number | undefined>>();
  for (const entry of universities) {
    const domains = entry.domains.map(normalizeDomain).filter((domain) => edu.test(domain));
    const byName = names.get(normalizeName(entry.name)) ?? new Set<number>();
    const bySite = new Set(domains.flatMap((domain) => [...(sites.get(domain) ?? [])]));
    const candidates = byName.size && bySite.size
      ? [...byName].filter((id) => bySite.has(id))
      : [...(bySite.size ? bySite : byName)];
    const unitid = us.has(entry.alpha_two_code) && candidates.length === 1 ? candidates[0] : undefined;

    for (const domain of domains) {
      const ids = owners.get(domain) ?? new Set<number | undefined>();
      const officialOwners = sites.get(domain);
      ids.add(officialOwners && [...officialOwners].some((id) => id !== unitid) ? undefined : unitid);
      owners.set(domain, ids);
    }
  }

  return [...owners].flatMap(([domain, ids]) => {
    const [unitid] = ids;
    return ids.size === 1 && unitid !== undefined ? [{ domain, unitid }] : [];
  });
}
