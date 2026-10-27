import { access } from 'node:fs/promises';
import { join } from 'node:path';

/** @param {string} segmentsRoot absolute path to toggly-segments */
export function togglySegmentsDistPath(segmentsRoot) {
  return join(segmentsRoot, 'dist', 'index.js');
}

/**
 * Build toggly-segments only when dist/ is missing (e.g. CI restores dist via artifact).
 * @param {string} segmentsRoot
 * @param {(args: string[]) => Promise<void>} runNpm runs `npm <args>` with cwd segmentsRoot
 * @returns {Promise<boolean>} true when a fresh build ran
 */
export async function ensureTogglySegmentsDist(segmentsRoot, runNpm) {
  try {
    await access(togglySegmentsDistPath(segmentsRoot));
    return false;
  } catch {
    try {
      await runNpm(['ci']);
    } catch {
      await runNpm(['install']);
    }
    await runNpm(['run', 'build']);
    return true;
  }
}
