import { describe, it, expect } from "vitest";
import {
  getYoutubeVideoId,
  getYoutubeThumbnail,
  getYoutubeEmbedUrl,
} from "./youtube";

describe("getYoutubeVideoId", () => {
  it("extracts the id from a watch URL", () => {
    expect(getYoutubeVideoId("https://www.youtube.com/watch?v=abc123")).toBe("abc123");
  });

  it("extracts the id from a shorts URL", () => {
    expect(getYoutubeVideoId("https://www.youtube.com/shorts/abc123")).toBe("abc123");
  });

  it("extracts the id from an embed URL", () => {
    expect(getYoutubeVideoId("https://www.youtube.com/embed/abc123")).toBe("abc123");
  });

  it("extracts the id from a youtu.be short link", () => {
    expect(getYoutubeVideoId("https://youtu.be/abc123")).toBe("abc123");
  });

  it("stops at trailing query params or path segments", () => {
    expect(getYoutubeVideoId("https://youtu.be/abc123?t=30")).toBe("abc123");
  });

  it("returns an empty string for a non-YouTube or missing URL", () => {
    expect(getYoutubeVideoId("https://example.com/video")).toBe("");
    expect(getYoutubeVideoId()).toBe("");
  });
});

describe("getYoutubeThumbnail", () => {
  it("builds the hqdefault thumbnail URL for a valid video URL", () => {
    expect(getYoutubeThumbnail("https://youtu.be/abc123")).toBe(
      "https://img.youtube.com/vi/abc123/hqdefault.jpg"
    );
  });

  it("returns an empty string when no video id can be extracted", () => {
    expect(getYoutubeThumbnail("not a url")).toBe("");
  });
});

describe("getYoutubeEmbedUrl", () => {
  it("builds the embed URL for a valid video URL", () => {
    expect(getYoutubeEmbedUrl("https://www.youtube.com/watch?v=abc123")).toBe(
      "https://www.youtube.com/embed/abc123"
    );
  });

  it("returns an empty string when no video id can be extracted", () => {
    expect(getYoutubeEmbedUrl("not a url")).toBe("");
  });
});
