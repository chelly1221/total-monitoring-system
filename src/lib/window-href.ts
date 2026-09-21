export function windowHref(href: string, standalone: boolean): string {
  if (!standalone) return href
  const url = new URL(href, 'http://localhost')
  url.searchParams.set('standalone', 'true')
  return `${url.pathname}${url.search}${url.hash}`
}
