import { expect, test } from "bun:test";
import { matchCampusDomains } from "../src/seed/campus-domains";

test("maps exact .edu domains and leaves conflicting campus assignments out", () => {
  const campuses = [
    { unitid: 1, name: "The Example University", aliases: "Example U", website: "www.example.edu" },
    { unitid: 2, name: "North College", aliases: "", website: "system.edu" },
    { unitid: 3, name: "South College", aliases: "", website: "system.edu" },
  ];
  const sources = [
    { name: "Example U", domains: ["Example.EDU", "student.example.edu", "example.com"], alpha_two_code: "US" },
    { name: "North College", domains: ["system.edu", "shared.edu"], alpha_two_code: "US" },
    { name: "South College", domains: ["system.edu", "shared.edu"], alpha_two_code: "US" },
    { name: "North College", domains: ["foreign.edu"], alpha_two_code: "CA" },
  ];
  expect(matchCampusDomains(campuses, sources)).toEqual([
    { domain: "example.edu", unitid: 1 },
    { domain: "student.example.edu", unitid: 1 },
  ]);
});
