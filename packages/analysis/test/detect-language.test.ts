import { describe, expect, it } from "vitest";
import { detectLanguage } from "../src/detect-language.js";

const ALL = [
  "en",
  "de",
  "sv",
  "nl",
  "nb",
  "nn",
  "no",
  "zh",
  "ja",
  "th",
  "km",
  "lo",
];

describe("detectLanguage", () => {
  it("detects clear English prose via function-word markers", () => {
    expect(
      detectLanguage(
        "The quick brown fox jumps over the lazy dog and this is a test of the detector.",
        ALL,
      ),
    ).toBe("en");
  });

  it("detects clear German prose via function-word markers", () => {
    expect(
      detectLanguage(
        "Der schnelle braune Fuchs springt über den faulen Hund und das ist ein Test für den Detektor.",
        ALL,
      ),
    ).toBe("de");
  });

  it.each([
    ["sv", "och är att inte också detta"],
    ["nl", "het een van niet zijn wij"],
    ["nb", "ikke jeg hva også hvordan hvem"],
    ["nn", "ikkje eg kva òg korleis kven"],
  ])("detects %s from exclusive marker words", (code, text) => {
    expect(detectLanguage(text, ALL)).toBe(code);
  });

  it("never autodetects the generic Norwegian compatibility code", () => {
    expect(
      detectLanguage("ikke jeg hva også hvordan hvem", ["no"]),
    ).toBeUndefined();
  });

  it("detects Chinese text (Han script, no kana) as zh", () => {
    expect(
      detectLanguage(
        "这是一个测试文档,用来验证语言检测功能是否正常工作。",
        ALL,
      ),
    ).toBe("zh");
  });

  it("detects Japanese text (Han + hiragana/katakana) as ja", () => {
    expect(
      detectLanguage(
        "これはテストドキュメントです。言語検出機能が正しく動作するか確認します。",
        ALL,
      ),
    ).toBe("ja");
  });

  it("detects Thai text (Thai script) as th", () => {
    expect(
      detectLanguage(
        "นี่คือเอกสารทดสอบเพื่อยืนยันว่าฟังก์ชันตรวจจับภาษาทำงานได้อย่างถูกต้อง",
        ALL,
      ),
    ).toBe("th");
  });

  it("detects Lao text (Lao script) as lo", () => {
    expect(
      detectLanguage(
        "ນີ້ແມ່ນເອກະສານທົດສອບເພື່ອຢືນຢັນວ່າຟັງຊັນກວດຫາພາສາເຮັດວຽກໄດ້ຢ່າງຖືກຕ້ອງ",
        ALL,
      ),
    ).toBe("lo");
  });

  it("detects Khmer text (Khmer script) as km", () => {
    expect(
      detectLanguage(
        "នេះជាឯកសារសាកល្បងដើម្បីផ្ទៀងផ្ទាត់ថាមុខងារកំណត់អត្តសញ្ញាណភាសាដំណើរការបានត្រឹមត្រូវ",
        ALL,
      ),
    ).toBe("km");
  });

  it("returns undefined for text with no confident signal (too short/ambiguous)", () => {
    expect(detectLanguage("hello world", ALL)).toBeUndefined();
    expect(detectLanguage("", ALL)).toBeUndefined();
  });

  it("returns undefined on a tie between candidate languages", () => {
    // Exactly one English marker and one German marker.
    expect(detectLanguage("to und", ALL)).toBeUndefined();
  });

  it("does not misclassify Latin text with one stray CJK character as CJK", () => {
    expect(
      detectLanguage(
        "The quick brown fox jumps over the lazy dog with a 猫 in the yard and this is a test.",
        ALL,
      ),
    ).toBe("en");
  });

  it("only returns a code present in candidateCodes", () => {
    // Clearly Japanese script, but "ja" isn't offered as a candidate.
    expect(
      detectLanguage(
        "これはテストドキュメントです。言語検出機能を確認します。",
        ["en", "de"],
      ),
    ).toBeUndefined();
  });

  it("ignores Latin marker words for a language not in candidateCodes", () => {
    expect(
      detectLanguage(
        "Der schnelle braune Fuchs springt über den faulen Hund.",
        ["en"],
      ),
    ).toBeUndefined();
  });
});
