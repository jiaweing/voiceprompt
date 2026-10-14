export type TextToken = {
  type: "TOKEN" | "DELIMITER"
  value: string
  index: number
}

export function tokenize(text: string): TextToken[] {
  const results: TextToken[] = []
  if (!text) return results

  let current: TextToken | null = null
  let i = 0

  while (i < text.length) {
    let s = text[i]
    let inToken: boolean

    if (s === "[") {
      const end = text.indexOf("]", i)
      s = end > 0 ? text.slice(i, end + 1) : s
      inToken = false
    } else {
      inToken = /[A-Za-zÀ-ÿА-Яа-я0-9_]/.test(s)
    }

    if (current === null) {
      current = { type: inToken ? "TOKEN" : "DELIMITER", value: s, index: 0 }
    } else if (
      (current.type === "TOKEN" && inToken) ||
      (current.type === "DELIMITER" && !inToken)
    ) {
      current.value += s
    } else {
      const lastIndex: number = current.index
      results.push(current)
      current = { type: inToken ? "TOKEN" : "DELIMITER", value: s, index: lastIndex + 1 }
    }

    i += s.length
  }

  if (current !== null) results.push(current)
  return results
}

export function normalizeWord(word: string): string {
  return word.toLowerCase().replace(/[^a-z0-9àáâãäåæçèéêëìíîïðñòóôõöøùúûüýþÿа-яё]/g, "")
}
