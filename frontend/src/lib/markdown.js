// Lightweight, zero-dependency, XSS-safe Markdown parser for Lab Notebook notes.
// Produces a pure AST (blocks & inline tokens) so React renders native elements
// without dangerouslySetInnerHTML.

const SAFE_URL = /^https?:\/\/[^\s<>()]+$/i

// parseInline splits a line of text into typed inline tokens:
// text | code | bold | italic | strike | link
export function parseInline(text) {
  const tokens = []
  let i = 0
  const pushText = (s) => {
    if (!s) return
    if (tokens.length > 0 && tokens[tokens.length - 1].type === 'text') {
      tokens[tokens.length - 1].value += s
    } else {
      tokens.push({ type: 'text', value: s })
    }
  }

  while (i < text.length) {
    // Inline code: `...`
    if (text[i] === '`') {
      const end = text.indexOf('`', i + 1)
      if (end > i + 1) {
        tokens.push({ type: 'code', value: text.slice(i + 1, end) })
        i = end + 1
        continue
      }
    }

    // Markdown link: [label](https://...)
    if (text[i] === '[') {
      const closeBracket = text.indexOf(']', i + 1)
      if (closeBracket > i + 1 && text[closeBracket + 1] === '(') {
        const closeParen = text.indexOf(')', closeBracket + 2)
        if (closeParen > closeBracket + 2) {
          const label = text.slice(i + 1, closeBracket)
          const href = text.slice(closeBracket + 2, closeParen).trim()
          if (SAFE_URL.test(href)) {
            tokens.push({ type: 'link', label, href })
            i = closeParen + 1
            continue
          }
        }
      }
    }

    // Bold: **...**
    if (text[i] === '*' && text[i + 1] === '*') {
      const end = text.indexOf('**', i + 2)
      if (end > i + 2) {
        tokens.push({ type: 'bold', children: parseInline(text.slice(i + 2, end)) })
        i = end + 2
        continue
      }
    }

    // Strikethrough: ~~...~~
    if (text[i] === '~' && text[i + 1] === '~') {
      const end = text.indexOf('~~', i + 2)
      if (end > i + 2) {
        tokens.push({ type: 'strike', children: parseInline(text.slice(i + 2, end)) })
        i = end + 2
        continue
      }
    }

    // Italic: *...* (single star, not followed by space)
    if (text[i] === '*' && text[i + 1] !== '*' && text[i + 1] !== ' ') {
      const end = text.indexOf('*', i + 1)
      if (end > i + 1 && text[end - 1] !== ' ') {
        tokens.push({ type: 'italic', children: parseInline(text.slice(i + 1, end)) })
        i = end + 1
        continue
      }
    }

    // Bare http(s):// URL
    if (text.startsWith('http://', i) || text.startsWith('https://', i)) {
      const m = text.slice(i).match(/^https?:\/\/[^\s<>)]+/)
      if (m) {
        let href = m[0]
        // Trim trailing punctuation that's usually prose, not part of the URL
        while (/[.,;:!?]$/.test(href)) href = href.slice(0, -1)
        if (SAFE_URL.test(href)) {
          tokens.push({ type: 'link', label: href, href })
          i += href.length
          continue
        }
      }
    }

    pushText(text[i])
    i++
  }

  return tokens
}

// parseMarkdown parses a note string into block AST nodes, tracking source
// line index on task list items so checkboxes can be toggled in place.
export function parseMarkdown(src) {
  const lines = String(src ?? '').replace(/\r\n?/g, '\n').split('\n')
  const blocks = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    // Fenced code block ```
    if (/^\s*```/.test(line)) {
      const lang = line.trim().slice(3).trim()
      const codeLines = []
      i++
      while (i < lines.length && !/^\s*```/.test(lines[i])) {
        codeLines.push(lines[i])
        i++
      }
      if (i < lines.length) i++ // consume closing fence
      blocks.push({ type: 'codeblock', lang, code: codeLines.join('\n') })
      continue
    }

    // Blank line
    if (line.trim() === '') {
      i++
      continue
    }

    // Heading (#, ##, ###)
    const hm = line.match(/^(#{1,3})\s+(.+)$/)
    if (hm) {
      blocks.push({ type: 'heading', level: hm[1].length, tokens: parseInline(hm[2].trim()) })
      i++
      continue
    }

    // Horizontal rule
    if (/^\s*(?:---|\*\*\*|___)\s*$/.test(line)) {
      blocks.push({ type: 'hr' })
      i++
      continue
    }

    // Blockquote
    if (/^\s*>\s?/.test(line)) {
      const qlines = []
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        qlines.push(lines[i].replace(/^\s*>\s?/, ''))
        i++
      }
      blocks.push({ type: 'quote', tokens: parseInline(qlines.join('\n')) })
      continue
    }

    // Unordered / checklist items (- , * , - [ ] , - [x] )
    if (/^\s*[-*]\s+/.test(line)) {
      const items = []
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        const tm = lines[i].match(/^\s*[-*]\s+\[([ xX])\]\s+(.*)$/)
        if (tm) {
          items.push({ task: true, checked: tm[1].toLowerCase() === 'x', lineIndex: i, tokens: parseInline(tm[2]) })
        } else {
          const text = lines[i].replace(/^\s*[-*]\s+/, '')
          items.push({ task: false, lineIndex: i, tokens: parseInline(text) })
        }
        i++
      }
      blocks.push({ type: 'ul', items })
      continue
    }

    // Ordered list (1. ...)
    if (/^\s*\d+\.\s+/.test(line)) {
      const items = []
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        const text = lines[i].replace(/^\s*\d+\.\s+/, '')
        items.push({ tokens: parseInline(text) })
        i++
      }
      blocks.push({ type: 'ol', items })
      continue
    }

    // Paragraph (coalesce contiguous plain lines)
    const plines = []
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^\s*```/.test(lines[i]) &&
      !/^#{1,3}\s+/.test(lines[i]) &&
      !/^\s*[-*]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i]) &&
      !/^\s*>\s?/.test(lines[i]) &&
      !/^\s*(?:---|\*\*\*|___)\s*$/.test(lines[i])
    ) {
      plines.push(lines[i])
      i++
    }
    blocks.push({ type: 'p', lines: plines.map((l) => parseInline(l)) })
  }

  return blocks
}

// toggleTaskLine flips `- [ ]` <-> `- [x]` at lineIndex in raw markdown text.
export function toggleTaskLine(src, lineIndex) {
  const lines = String(src ?? '').replace(/\r\n?/g, '\n').split('\n')
  if (lineIndex < 0 || lineIndex >= lines.length) return src
  lines[lineIndex] = lines[lineIndex].replace(/^(\s*[-*]\s+\[)([ xX])(\]\s+)/, (_, pre, ch, post) => {
    return pre + (ch.toLowerCase() === 'x' ? ' ' : 'x') + post
  })
  return lines.join('\n')
}
