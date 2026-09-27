import { readFileSync, writeFileSync } from 'node:fs'

function trimTrailingSpacesAndTabs(line) {
  let end = line.length
  while (end > 0 && (line[end - 1] === ' ' || line[end - 1] === '\t')) {
    end--
  }
  return line.slice(0, end)
}

for (const entryPoint of ['dist/cjs/index.cjs', 'dist/esm/index.js']) {
  writeFileSync(
    entryPoint,
    readFileSync(entryPoint, 'utf8')
      .replaceAll('\r\n', '\n')
      .split('\n')
      .map(trimTrailingSpacesAndTabs)
      .join('\n'),
  )
}
