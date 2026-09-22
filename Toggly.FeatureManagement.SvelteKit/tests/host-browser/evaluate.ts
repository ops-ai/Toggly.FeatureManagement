import type { Page } from '@playwright/test';
export async function evaluate<T, A = undefined>(
  page: Page,
  action: (arg: A) => T | Promise<T>,
  arg?: A,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      page.evaluate(action, arg as A),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Browser evaluation exceeded 10000ms')), 10000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
