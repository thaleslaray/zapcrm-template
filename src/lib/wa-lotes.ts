// Cada página normalizada cabe tanto no parâmetro JSON das consultas em lote
// como na linha da caixa de entrada, independentemente do tamanho dos textos.
export function* lotesWa<T>(itens: T[]) {
  const encoder = new TextEncoder()
  let lote: T[] = []
  let bytes = 0
  for (const item of itens) {
    const tamanho = encoder.encode(JSON.stringify(item)).length
    if (lote.length && (bytes + tamanho > 512 * 1024 || lote.length >= 100)) {
      yield lote
      lote = []
      bytes = 0
    }
    lote.push(item)
    bytes += tamanho
  }
  if (lote.length) yield lote
}
