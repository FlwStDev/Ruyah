import { describe, expect, it } from "vitest";
import { captionFromFileName, isEligibleFileName, mimeFromExt } from "@/lib/folder-drip";

describe("folder drip helpers", () => {
  it("maps common extensions to mime types", () => {
    expect(mimeFromExt("shot.JPG")).toBe("image/jpeg");
    expect(mimeFromExt("clip.mp4")).toBe("video/mp4");
    expect(mimeFromExt("notes.txt")).toBeNull();
  });

  it("skips hidden files, the _posted folder name, and unknown types", () => {
    expect(isEligibleFileName(".DS_Store")).toBe(false);
    expect(isEligibleFileName("_posted")).toBe(false);
    expect(isEligibleFileName("ready.png")).toBe(true);
  });

  it("turns a filename into a caption", () => {
    expect(captionFromFileName("beach_sunset-01.jpg")).toBe("beach sunset 01");
  });
});
