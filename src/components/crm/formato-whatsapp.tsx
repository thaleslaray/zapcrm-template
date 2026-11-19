import type { ReactNode } from 'react'

// Formatação que o WhatsApp aplica ao texto: *negrito*, _itálico_,
// ~tachado~, `código` e ```bloco```. O resultado são nós do React; nenhum
// HTML vindo da mensagem é interpretado.
const marcas = [
  { abre: '```', fecha: '```', tag: 'code', bloco: true },
  { abre: '`', fecha: '`', tag: 'code', bloco: false },
  { abre: '*', fecha: '*', tag: 'strong', bloco: false },
  { abre: '_', fecha: '_', tag: 'em', bloco: false },
  { abre: '~', fecha: '~', tag: 's', bloco: false },
] as const

const letra = /[\p{L}\p{N}]/u

function fechamento(
  texto: string,
  inicio: number,
  marca: (typeof marcas)[number],
) {
  const de = inicio + marca.abre.length
  // O conteúdo começa e termina sem espaço, e a marca simples não atravessa linhas.
  if (!texto[de] || /\s/.test(texto[de])) return -1
  for (let i = de + 1; i <= texto.length - marca.fecha.length; i++) {
    if (!marca.bloco && texto[i] === '\n') return -1
    if (!texto.startsWith(marca.fecha, i)) continue
    if (/\s/.test(texto[i - 1])) continue
    const depois = texto[i + marca.fecha.length]
    if (!marca.bloco && depois && letra.test(depois)) continue
    return i
  }
  return -1
}

export function formatarWhatsApp(texto: string, chave = 'f'): ReactNode[] {
  const nos: ReactNode[] = []
  let liso = ''
  let i = 0
  while (i < texto.length) {
    const marca = marcas.find((m) => texto.startsWith(m.abre, i))
    const antes = texto[i - 1]
    if (marca && (marca.bloco || !antes || !letra.test(antes))) {
      const fim = fechamento(texto, i, marca)
      if (fim !== -1) {
        if (liso) nos.push(liso)
        liso = ''
        const dentro = texto.slice(i + marca.abre.length, fim)
        const id = `${chave}-${i}`
        const Tag = marca.tag
        nos.push(
          <Tag key={id}>
            {marca.tag === 'code' ? dentro : formatarWhatsApp(dentro, id)}
          </Tag>,
        )
        i = fim + marca.fecha.length
        continue
      }
    }
    liso += texto[i]
    i++
  }
  if (liso) nos.push(liso)
  return nos
}
