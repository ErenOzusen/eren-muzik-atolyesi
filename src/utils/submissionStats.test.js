import { describe, it, expect } from "vitest";
import {
  getSubmissionDate,
  normalizeLessonName,
  getLessonStatCategory,
  computeSubmissionStats,
} from "./submissionStats";

describe("getSubmissionDate", () => {
  it("prefers date over createdAt", () => {
    expect(getSubmissionDate({ date: "2024-01-01", createdAt: "2023-01-01" })).toBe("2024-01-01");
  });

  it("falls back to createdAt when date is missing", () => {
    expect(getSubmissionDate({ createdAt: "2023-01-01" })).toBe("2023-01-01");
  });

  it("returns null when neither is present", () => {
    expect(getSubmissionDate({})).toBeNull();
    expect(getSubmissionDate(null)).toBeNull();
  });
});

describe("normalizeLessonName", () => {
  it("trims, lowercases, and collapses internal whitespace", () => {
    expect(normalizeLessonName("  Bas   Gitar  ")).toBe("bas gitar");
  });

  it("returns an empty string for null/undefined", () => {
    expect(normalizeLessonName(null)).toBe("");
    expect(normalizeLessonName(undefined)).toBe("");
  });
});

describe("getLessonStatCategory", () => {
  it("classifies bas gitar before plain gitar", () => {
    expect(getLessonStatCategory("Bas Gitar Dersi")).toBe("Bas Gitar");
  });

  it("classifies piyano", () => {
    expect(getLessonStatCategory("Piyano")).toBe("Piyano");
  });

  it("classifies müzik teorisi with and without the Turkish ü/i", () => {
    expect(getLessonStatCategory("Müzik Teorisi")).toBe("Müzik Teorisi");
    expect(getLessonStatCategory("muzik teorisi")).toBe("Müzik Teorisi");
  });

  it("classifies plain gitar", () => {
    expect(getLessonStatCategory("Gitar")).toBe("Gitar");
  });

  it("returns null for an unrecognized or empty lesson name", () => {
    expect(getLessonStatCategory("Davul")).toBeNull();
    expect(getLessonStatCategory("")).toBeNull();
  });
});

describe("computeSubmissionStats", () => {
  it("tallies each category and the total, ignoring unrecognized lessons", () => {
    const submissions = [
      { lesson: "Gitar" },
      { lesson: "Piyano" },
      { lesson: "Bas Gitar" },
      { lesson: "Müzik Teorisi" },
      { lesson: "Gitar" },
      { lesson: "Davul" },
    ];
    expect(computeSubmissionStats(submissions)).toEqual({
      total: 6,
      gitar: 2,
      piyano: 1,
      basGitar: 1,
      muzikTeorisi: 1,
    });
  });

  it("returns all-zero stats for an empty list", () => {
    expect(computeSubmissionStats([])).toEqual({
      total: 0,
      gitar: 0,
      piyano: 0,
      basGitar: 0,
      muzikTeorisi: 0,
    });
  });
});
