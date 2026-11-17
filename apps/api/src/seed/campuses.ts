import { parse } from "csv-parse/sync";
import { sql } from "drizzle-orm";
import { strFromU8, unzipSync } from "fflate";
import { connectDatabase } from "../db";
import { campusEmailDomains, campuses } from "../schema";
import { domainSource, matchCampusDomains } from "./campus-domains";

const source = "https://nces.ed.gov/ipeds/datacenter/data/HD2024.zip";
const includedLocations = new Set(
  ("AK AL AR AS AZ CA CO CT DC DE FL GA GU HI IA ID IL IN KS KY LA MA MD ME MI MN MO MP MS MT " +
   "NC ND NE NH NJ NM NV NY OH OK OR PA PR RI SC SD TN TX UT VA VI VT WA WI WV WY").split(" "),
);
const localArchive = process.argv[2];
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");

let archive: ArrayBuffer;
if (localArchive) {
  archive = await Bun.file(localArchive).arrayBuffer();
} else {
  const response = await fetch(source);
  if (!response.ok) throw new Error(`IPEDS download failed with HTTP ${response.status}`);
  archive = await response.arrayBuffer();
}
const csv = unzipSync(new Uint8Array(archive), {
  filter: ({ name }) => name.toLowerCase() === "hd2024.csv",
});
const [directory] = Object.values(csv);
if (!directory) throw new Error("HD2024.csv was not found in the IPEDS archive");

const columns = ["UNITID", "INSTNM", "IALIAS", "CITY", "STABBR", "POSTSEC", "WEBADDR"];
const records = parse(strFromU8(directory), {
  bom: true,
  columns(headers: string[]) {
    if (columns.some((column) => !headers.includes(column))) {
      throw new Error("IPEDS directory columns are missing");
    }
    return headers;
  },
  skip_empty_lines: true,
  trim: true,
}) as Record<string, string>[];

const ids = new Set<number>();
const rows: (typeof campuses.$inferInsert)[] = [];
const websites = new Map<number, string>();
for (const record of records) {
  if (record.POSTSEC !== "1" || !includedLocations.has(record.STABBR)) continue;
  const unitid = Number(record.UNITID);
  if (!/^\d+$/.test(record.UNITID) || !Number.isSafeInteger(unitid) ||
      unitid < 1 || unitid > 2_147_483_647 || !record.INSTNM || ids.has(unitid)) {
    throw new Error(`Invalid or repeated UNITID in IPEDS directory: ${record.UNITID}`);
  }
  ids.add(unitid);
  websites.set(unitid, record.WEBADDR);
  rows.push({
    unitid,
    name: record.INSTNM,
    aliases: record.IALIAS,
    city: record.CITY,
    state: record.STABBR,
  });
}
if (!rows.length) throw new Error("No US postsecondary institutions found in the IPEDS directory");

async function loadDomainDirectory(): Promise<unknown> {
  const localDomains = process.argv[3];
  if (localDomains) return Bun.file(localDomains).json();
  const response = await fetch(domainSource);
  if (!response.ok) throw new Error(`University domains download failed with HTTP ${response.status}`);
  return response.json();
}

const domains = matchCampusDomains(
  rows.map(({ unitid, name, aliases }) => ({ unitid, name, aliases, website: websites.get(unitid) ?? "" })),
  await loadDomainDirectory(),
);
if (!domains.length) throw new Error("No university domains matched IPEDS institutions");

const { db, client } = connectDatabase(url);
try {
  await db.transaction(async (tx) => {
    for (let start = 0; start < rows.length; start += 250) {
      await tx.insert(campuses).values(rows.slice(start, start + 250)).onConflictDoUpdate({
        target: campuses.unitid,
        set: {
          name: sql`excluded.name`,
          aliases: sql`excluded.aliases`,
          city: sql`excluded.city`,
          state: sql`excluded.state`,
        },
      });
    }
    // Publish the new mapping atomically, including domains removed by collision checks.
    await tx.delete(campusEmailDomains);
    for (let start = 0; start < domains.length; start += 250) {
      await tx.insert(campusEmailDomains).values(domains.slice(start, start + 250));
    }
  });
  console.log(`Imported ${rows.length} US postsecondary institutions from IPEDS 2024.`);
  const matched = new Set(domains.map(({ unitid }) => unitid)).size;
  console.log(`Matched ${matched} campuses to ${domains.length} unique .edu domains. Unmatched: ${rows.length - matched}.`);
} finally {
  await client.end();
}
