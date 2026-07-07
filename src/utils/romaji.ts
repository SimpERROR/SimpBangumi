/**
 * Kana → Romaji converter for Japanese title matching.
 * Covers hiragana + katakana (including dakuten/handakuten, digraphs, sokuon).
 * Kanji is left as-is (would require a dictionary like kuromoji).
 */

const KANA_TO_ROMAJI: Record<string, string> = {
  // ── Hiragana base ──
  あ: "a", い: "i", う: "u", え: "e", お: "o",
  か: "ka", き: "ki", く: "ku", け: "ke", こ: "ko",
  さ: "sa", し: "shi", す: "su", せ: "se", そ: "so",
  た: "ta", ち: "chi", つ: "tsu", て: "te", と: "to",
  な: "na", に: "ni", ぬ: "nu", ね: "ne", の: "no",
  は: "ha", ひ: "hi", ふ: "fu", へ: "he", ほ: "ho",
  ま: "ma", み: "mi", む: "mu", め: "me", も: "mo",
  や: "ya", ゆ: "yu", よ: "yo",
  ら: "ra", り: "ri", る: "ru", れ: "re", ろ: "ro",
  わ: "wa", を: "wo", ん: "n",
  // ── Hiragana dakuten ──
  が: "ga", ぎ: "gi", ぐ: "gu", げ: "ge", ご: "go",
  ざ: "za", じ: "ji", ず: "zu", ぜ: "ze", ぞ: "zo",
  だ: "da", ぢ: "ji", づ: "zu", で: "de", ど: "do",
  ば: "ba", び: "bi", ぶ: "bu", べ: "be", ぼ: "bo",
  // ── Hiragana handakuten ──
  ぱ: "pa", ぴ: "pi", ぷ: "pu", ぺ: "pe", ぽ: "po",
  // ── Hiragana small kana (digraphs) ──
  きゃ: "kya", きゅ: "kyu", きょ: "kyo",
  しゃ: "sha", しゅ: "shu", しょ: "sho",
  ちゃ: "cha", ちゅ: "chu", ちょ: "cho",
  にゃ: "nya", にゅ: "nyu", にょ: "nyo",
  ひゃ: "hya", ひゅ: "hyu", ひょ: "hyo",
  みゃ: "mya", みゅ: "myu", みょ: "myo",
  りゃ: "rya", りゅ: "ryu", りょ: "ryo",
  ぎゃ: "gya", ぎゅ: "gyu", ぎょ: "gyo",
  じゃ: "ja", じゅ: "ju", じょ: "jo",
  ぢゃ: "ja", ぢゅ: "ju", ぢょ: "jo",
  びゃ: "bya", びゅ: "byu", びょ: "byo",
  ぴゃ: "pya", ぴゅ: "pyu", ぴょ: "pyo",
  // ── Katakana base ──
  ア: "a", イ: "i", ウ: "u", エ: "e", オ: "o",
  カ: "ka", キ: "ki", ク: "ku", ケ: "ke", コ: "ko",
  サ: "sa", シ: "shi", ス: "su", セ: "se", ソ: "so",
  タ: "ta", チ: "chi", ツ: "tsu", テ: "te", ト: "to",
  ナ: "na", ニ: "ni", ヌ: "nu", ネ: "ne", ノ: "no",
  ハ: "ha", ヒ: "hi", フ: "fu", ヘ: "he", ホ: "ho",
  マ: "ma", ミ: "mi", ム: "mu", メ: "me", モ: "mo",
  ヤ: "ya", ユ: "yu", ヨ: "yo",
  ラ: "ra", リ: "ri", ル: "ru", レ: "re", ロ: "ro",
  ワ: "wa", ヲ: "wo", ン: "n",
  // ── Katakana dakuten ──
  ガ: "ga", ギ: "gi", グ: "gu", ゲ: "ge", ゴ: "go",
  ザ: "za", ジ: "ji", ズ: "zu", ゼ: "ze", ゾ: "zo",
  ダ: "da", ヂ: "ji", ヅ: "zu", デ: "de", ド: "do",
  バ: "ba", ビ: "bi", ブ: "bu", ベ: "be", ボ: "bo",
  // ── Katakana handakuten ──
  パ: "pa", ピ: "pi", プ: "pu", ペ: "pe", ポ: "po",
  // ── Katakana small kana (digraphs) ──
  キャ: "kya", キュ: "kyu", キョ: "kyo",
  シャ: "sha", シュ: "shu", ショ: "sho",
  チャ: "cha", チュ: "chu", チョ: "cho",
  ニャ: "nya", ニュ: "nyu", ニョ: "nyo",
  ヒャ: "hya", ヒュ: "hyu", ヒョ: "hyo",
  ミャ: "mya", ミュ: "myu", ミョ: "myo",
  リャ: "rya", リュ: "ryu", リョ: "ryo",
  ギャ: "gya", ギュ: "gyu", ギョ: "gyo",
  ジャ: "ja", ジュ: "ju", ジョ: "jo",
  ヂャ: "ja", ヂュ: "ju", ヂョ: "jo",
  ビャ: "bya", ビュ: "byu", ビョ: "byo",
  ピャ: "pya", ピュ: "pyu", ピョ: "pyo",
  // ── Katakana extensions ──
  ヴァ: "va", ヴィ: "vi", ヴ: "vu", ヴェ: "ve", ヴォ: "vo",
  ファ: "fa", フィ: "fi", フェ: "fe", フォ: "fo",
  ウィ: "wi", ウェ: "we", ウォ: "wo",
  ティ: "ti", ディ: "di", トゥ: "tu", ドゥ: "du",
  シェ: "she", ジェ: "je", チェ: "che",
  ッ: "", // sokuon — just drop for matching
  ャ: "ya", ュ: "yu", ョ: "yo", // small standalone
  ァ: "a", ィ: "i", ゥ: "u", ェ: "e", ォ: "o",
  // Punctuation / symbols → remove
  "・": " ", "ー": "", "～": " ", "「": "", "」": "",
  "『": "", "』": "", "（": "", "）": "", "！": "", "？": "",
  "。": "", "、": "", "…": "",
};

/**
 * Convert a Japanese string to romaji.
 * Kana characters are transliterated; kanji/other chars are kept as-is.
 * Handles digraphs (ゃ/ゅ/ょ etc.) and sokuon (っ).
 */
export function toRomaji(text: string): string {
  if (!text) return "";

  let result = "";
  let i = 0;

  while (i < text.length) {
    // Try 2-char match first (digraphs like きゃ)
    if (i + 1 < text.length) {
      const two = text.substring(i, i + 2);
      if (KANA_TO_ROMAJI[two] !== undefined) {
        result += KANA_TO_ROMAJI[two];
        i += 2;
        continue;
      }
    }

    // Single char match
    const one = text[i];
    if (KANA_TO_ROMAJI[one] !== undefined) {
      result += KANA_TO_ROMAJI[one];
    } else {
      // Keep non-kana chars (kanji, digits, latin, etc.)
      result += one;
    }
    i++;
  }

  // Clean up: collapse spaces, trim, lowercase
  return result.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Clean a string for fuzzy title matching:
 * lowercase, remove punctuation, collapse whitespace, trim.
 */
function normalizeForMatch(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Compare two strings using a simple token overlap score.
 * Returns 0-1 where 1 = perfect match.
 */
function tokenOverlap(a: string, b: string): number {
  const tokensA = new Set(a.split(/\s+/).filter(Boolean));
  const tokensB = new Set(b.split(/\s+/).filter(Boolean));
  if (tokensA.size === 0 || tokensB.size === 0) return 0;

  let overlap = 0;
  for (const t of tokensA) {
    if (tokensB.has(t)) overlap++;
  }
  return overlap / Math.max(tokensA.size, tokensB.size);
}

/**
 * Score how well a Bangumi title matches a Tenrai entry by romaji.
 *
 * @param bgmRomaji  Romaji of Bangumi's `name` (Japanese title)
 * @param TenraiTitle Tenrai's `title` (usually romaji/english)
 * @param TenraiTitleJapanese Tenrai's `title_japanese` (kana/kanji)
 * @param TenraiTitleEnglish Tenrai's `title_english`
 *
 * Returns 0–60 score.
 */
export function romajiTitleScore(
  bgmRomaji: string,
  TenraiTitle: string | null,
  TenraiTitleJapanese: string | null,
  TenraiTitleEnglish: string | null,
): number {
  const bgmNorm = normalizeForMatch(bgmRomaji);
  if (!bgmNorm) return 0;

  const candidates: string[] = [];
  if (TenraiTitle) candidates.push(normalizeForMatch(TenraiTitle));
  if (TenraiTitleJapanese) candidates.push(normalizeForMatch(toRomaji(TenraiTitleJapanese)));
  if (TenraiTitleEnglish) candidates.push(normalizeForMatch(TenraiTitleEnglish));

  let bestOverlap = 0;
  for (const cand of candidates) {
    if (!cand) continue;
    // Exact match → full points
    if (bgmNorm === cand) return 60;
    // Token overlap
    const overlap = tokenOverlap(bgmNorm, cand);
    if (overlap > bestOverlap) bestOverlap = overlap;
  }

  return Math.round(60 * bestOverlap);
}
