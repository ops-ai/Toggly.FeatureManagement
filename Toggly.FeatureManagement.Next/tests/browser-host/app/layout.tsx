import type { ReactNode } from 'react'
export default function Layout({children}: {children: ReactNode}) {
  return <html><head><link rel="icon" href="data:," /></head><body>{children}</body></html>
}
