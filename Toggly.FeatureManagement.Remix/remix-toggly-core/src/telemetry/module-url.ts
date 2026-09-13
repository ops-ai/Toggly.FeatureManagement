/**
 * The native ESM URL for this module. Keeping this in a focused module lets
 * CommonJS-oriented test transforms replace it while published ESM keeps the
 * real package location.
 */
export const moduleUrl = import.meta.url
