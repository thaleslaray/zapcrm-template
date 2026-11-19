// Chave de comparação do contato. O JID do provedor é guardado separadamente.
export function normalizarTelefone(entrada: string): string {
  const numero = entrada.replace(/\D/g, '')
  const internacional = entrada.trimStart().startsWith('+')
  if (internacional && !numero.startsWith('55')) return numero

  const nacional = /^55\d{10,11}$/.test(numero) ? numero.slice(2) : numero
  const brasileiro = /^(\d{2})9?(\d{8})$/.exec(nacional)
  if (!brasileiro) throw new Error('Informe um telefone com DDD.')
  return `55${brasileiro[1]}${brasileiro[2]}`
}

export function jidDoTelefone(telefone: string) {
  const digitos = telefone.replace(/\D/g, '')
  const numero =
    telefone.startsWith('+') || /^55\d{10,11}$/.test(digitos)
      ? digitos
      : `55${digitos}`
  return `${numero}@s.whatsapp.net`
}

// O nono dígito é parte da apresentação mesmo quando não participa da chave de comparação.
export function telefoneParaExibir({
  telefone,
  telefoneNormalizado,
}: {
  telefone: string | null
  telefoneNormalizado?: string | null
}) {
  if (!telefone) return null
  const digitos = telefone.replace(/\D/g, '')
  // A chave inclui o DDI mesmo quando o cadastro da equipe começou pelo DDD.
  const nacional =
    telefoneNormalizado?.startsWith('55') && /^\d{10,11}$/.test(digitos)
  const brasileiro = /^55(\d{2})(\d{4,5})(\d{4})$/.exec(
    nacional ? `55${digitos}` : digitos,
  )
  if (brasileiro)
    return `+55 ${brasileiro[1]} ${brasileiro[2]}-${brasileiro[3]}`
  return /^\d+$/.test(telefone) ? `+${digitos}` : telefone
}

export function nomeSemTelefone(nome: string | null, telefone: string | null) {
  if (!nome || nome === 'Contato do WhatsApp') return null
  if (telefone && /^[+\d()\s.-]+$/.test(nome)) {
    const numero = telefone.replace(/\D/g, '')
    const candidato = nome.replace(/\D/g, '')
    if (numero === candidato) return null
    if (
      /^55\d{2}9?\d{8}$/.test(numero) &&
      /^(?:55)?\d{2}9?\d{8}$/.test(candidato)
    ) {
      if (normalizarTelefone(numero) === normalizarTelefone(candidato))
        return null
    }
  }
  return nome
}

export function nomeDoContato(c: {
  nome: string
  telefone: string | null
  telefoneNormalizado?: string | null
}) {
  return (
    nomeSemTelefone(c.nome, c.telefone) ??
    telefoneParaExibir(c) ??
    'Contato do WhatsApp'
  )
}
