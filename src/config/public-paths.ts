// A raiz redireciona à área logada. Somente as páginas legais podem virar
// HTML estático: todos os outros caminhos passam pelo Worker.
export const SITEMAP_STATIC_PATHS = ['/termos', '/privacidade'] as const
export const ROBOTS_DISALLOW = ['/api/', '/app', '/login'] as const

export function isPrerenderable(path: string): boolean {
  const normalized = path.replace(/\/+$/, '')
  return SITEMAP_STATIC_PATHS.some((item) => normalized === item)
}
