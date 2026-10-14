import { type TextToken, normalizeWord } from "./tokenizer"
import { levenshteinDistance } from "./levenshtein"

function buildComparisonString(words: string[]): string {
  return words.map(normalizeWord).filter(Boolean).join(" ")
}

export function matchSpeechToScript(
  recognized: string,
  tokens: TextToken[],
  lastIndex: number,
): number {
  const recognizedWords = recognized
    .split(/\s+/)
    .map(normalizeWord)
    .filter(Boolean)

  if (recognizedWords.length === 0) return lastIndex

  const query = buildComparisonString(recognizedWords)
  if (!query) return lastIndex

  const refTokens = tokens.filter((t) => t.type === "TOKEN")
  if (refTokens.length === 0) return lastIndex

  const anchor = Math.max(0, lastIndex)

  // Forward window: recognized_len * 3 + 20 words ahead
  const forwardWindowSize = recognizedWords.length * 3 + 20
  // Backward window: allow small backtrack for repetition/restart
  const backwardWindowSize = Math.min(anchor, recognizedWords.length + 5)

  const windowStart = Math.max(0, anchor - backwardWindowSize)
  const windowEnd = Math.min(refTokens.length, anchor + forwardWindowSize)
  const windowTokens = refTokens.slice(windowStart, windowEnd)

  let bestIndex = anchor
  let bestDistance = Infinity

  for (let i = 1; i <= windowTokens.length; i++) {
    const candidate = buildComparisonString(windowTokens.slice(0, i).map((t) => t.value))
    const dist = levenshteinDistance(query, candidate)

    // Normalize by length to avoid bias toward long strings
    const normalized = dist / Math.max(query.length, candidate.length)

    if (normalized < bestDistance) {
      bestDistance = normalized
      bestIndex = windowTokens[i - 1].index
    }
  }

  // Only advance if match quality is reasonable
  if (bestDistance > 0.6) return lastIndex

  return bestIndex
}
