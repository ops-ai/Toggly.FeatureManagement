import { readFileSync, writeFileSync } from 'node:fs'

function isLineTerminator(character) {
  return character === '\n' || character === '\r' || character === '\u2028' || character === '\u2029'
}

function trimTrailingSpacesAndTabs(text) {
  let normalized = ''
  let lineStart = 0

  for (let index = 0; index <= text.length; index++) {
    if (index !== text.length && !isLineTerminator(text[index])) {
      continue
    }

    let lineEnd = index
    while (lineEnd > lineStart && (text[lineEnd - 1] === ' ' || text[lineEnd - 1] === '\t')) {
      lineEnd--
    }
    normalized += text.slice(lineStart, lineEnd)

    if (index < text.length) {
      normalized += text[index]
      lineStart = index + 1
    }
  }

  return normalized
}

for (const entryPoint of ['dist/cjs/index.cjs', 'dist/esm/index.js']) {
  writeFileSync(
    entryPoint,
    trimTrailingSpacesAndTabs(readFileSync(entryPoint, 'utf8').replaceAll('\r\n', '\n')),
  )
}
