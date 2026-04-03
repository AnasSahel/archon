import { describe, it, expect } from "vitest";
import { companies, companyMembers } from "./companies.js";

describe("companies schema", () => {
  it("exports companies table", () => {
    expect(companies).toBeDefined();
  });
  it("exports companyMembers table", () => {
    expect(companyMembers).toBeDefined();
  });
});
