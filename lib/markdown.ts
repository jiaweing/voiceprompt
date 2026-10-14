export type InlineChunk = {
  text: string
  bold: boolean
  italic: boolean
}

export type MarkdownBlock =
  | { kind: "heading"; level: 1 | 2 | 3; chunks: InlineChunk[] }
  | { kind: "paragraph"; chunks: InlineChunk[] }
  | { kind: "blank" }

export function parseMarkdownBlocks(text: string): MarkdownBlock[] {
  const lines = text.split("\n")
  const blocks: MarkdownBlock[] = []
  let paraLines: string[] = []

  const flushPara = () => {
    if (paraLines.length > 0) {
      blocks.push({ kind: "paragraph", chunks: parseInline(paraLines.join(" ")) })
      paraLines = []
    }
  }

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,3})\s+(.*)$/)
    if (headingMatch) {
      flushPara()
      const level = headingMatch[1].length as 1 | 2 | 3
      blocks.push({ kind: "heading", level, chunks: parseInline(headingMatch[2]) })
    } else if (line.trim() === "") {
      flushPara()
      blocks.push({ kind: "blank" })
    } else {
      paraLines.push(line)
    }
  }
  flushPara()
  return blocks
}

function parseInline(text: string): InlineChunk[] {
  const chunks: InlineChunk[] = []
  // Matches ***bold+italic***, **bold**, *italic*, _italic_
  const re = /(\*\*\*(.+?)\*\*\*|\*\*(.+?)\*\*|\*(.+?)\*|_(.+?)_)/g
  let last = 0
  let m: RegExpExecArray | null

  while ((m = re.exec(text)) !== null) {
    if (m.index > last) {
      chunks.push({ text: text.slice(last, m.index), bold: false, italic: false })
    }
    if (m[2]) chunks.push({ text: m[2], bold: true, italic: true })
    else if (m[3]) chunks.push({ text: m[3], bold: true, italic: false })
    else if (m[4] || m[5]) chunks.push({ text: (m[4] ?? m[5])!, bold: false, italic: true })
    last = m.index + m[0].length
  }
  if (last < text.length) {
    chunks.push({ text: text.slice(last), bold: false, italic: false })
  }
  return chunks.length > 0 ? chunks : [{ text, bold: false, italic: false }]
}

export function stripMarkdownForTokenizer(text: string): string {
  return text
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*\*(.+?)\*\*\*/g, "$1")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/_(.+?)_/g, "$1")
    .replace(/~~(.+?)~~/g, "$1")
    .replace(/`(.+?)`/g, "$1")
    .replace(/\[(.+?)\]\(.+?\)/g, "$1")
}
