import { objeto } from './uazapi'

type Opcao = {
  tipo: 'resposta' | 'link' | 'ligacao' | 'copiar' | 'item'
  rotulo: string
  descricao?: string
}

export type Interativa = {
  rodape: string | null
  botaoLista: string | null
  opcoes: Opcao[]
}

const respostas = new Set([
  'buttonsresponsemessage',
  'listresponsemessage',
  'templatebuttonreplymessage',
])
const interativos = new Set([
  ...respostas,
  'buttonsmessage',
  'listmessage',
  'templatemessage',
  'nativeflowmessage',
  'interactivemessage',
])

export function tipoInterativo(tipo: string) {
  return interativos.has(tipo.toLowerCase())
}

function objetoJson(valor: unknown) {
  if (typeof valor !== 'string') return objeto(valor)
  try {
    return objeto(JSON.parse(valor))
  } catch {
    return {}
  }
}

function texto(valor: unknown, max = 65536) {
  return typeof valor === 'string' ? valor.trim().slice(0, max) || null : null
}

// Um emoji pode ocupar duas unidades UTF-16. Corte apenas entre caracteres.
function lerRotulo(valor: unknown) {
  const trecho = texto(valor, 160)
  return trecho ? Array.from(trecho).slice(0, 80).join('') : null
}

function campoSemCaixa(valor: unknown, nome: string) {
  const registro = objeto(valor)
  return Object.entries(registro).find(([k]) => k.toLowerCase() === nome)?.[1]
}

const lista = (valor: unknown): unknown[] => (Array.isArray(valor) ? valor : [])

function adicionar(
  opcoes: Opcao[],
  tipo: Opcao['tipo'],
  nome: unknown,
  detalhe?: unknown,
) {
  const rotulo = lerRotulo(nome)
  if (!rotulo) return
  const descricao = texto(detalhe, 256)
  opcoes.push(descricao ? { tipo, rotulo, descricao } : { tipo, rotulo })
}

const tiposNativos = new Map<string, Opcao['tipo']>([
  ['quick_reply', 'resposta'],
  ['cta_url', 'link'],
  ['cta_call', 'ligacao'],
  ['cta_copy', 'copiar'],
])

function botoesNativos(botoes: unknown) {
  const opcoes: Opcao[] = []
  for (const valor of lista(botoes)) {
    const b = objeto(valor)
    const tipo = tiposNativos.get(texto(b.name)?.toLowerCase() ?? '')
    if (tipo) {
      const params = objetoJson(b.buttonParamsJSON ?? b.buttonParamsJson)
      adicionar(opcoes, tipo, params.display_text)
    }
    if (opcoes.length === 12) break
  }
  return opcoes
}

const tiposHydrated = new Map<string, Opcao['tipo']>([
  ['quickreplybutton', 'resposta'],
  ['urlbutton', 'link'],
  ['callbutton', 'ligacao'],
  ['copybutton', 'copiar'],
])

function botoesHydrated(botoes: unknown) {
  const opcoes: Opcao[] = []
  for (const valor of lista(botoes)) {
    const botao = objeto(campoSemCaixa(valor, 'hydratedbutton'))
    for (const [chave, dados] of Object.entries(botao)) {
      const tipo = tiposHydrated.get(
        chave.toLowerCase().replace(/^hydrated/, ''),
      )
      if (tipo) {
        adicionar(
          opcoes,
          tipo,
          campoSemCaixa(dados, 'displaytext') ??
            campoSemCaixa(dados, 'hydrateddisplaytext'),
        )
        break
      }
    }
    if (opcoes.length === 12) break
  }
  return opcoes
}

function itensDaLista(secoes: unknown) {
  const opcoes: Opcao[] = []
  for (const secao of lista(secoes)) {
    for (const linha of lista(objeto(secao).rows)) {
      const { title, description } = objeto(linha)
      adicionar(opcoes, 'item', title, description)
      if (opcoes.length === 12) return opcoes
    }
  }
  return opcoes
}

function botoesDaMensagem(botoes: unknown) {
  const opcoes: Opcao[] = []
  for (const botao of lista(botoes)) {
    adicionar(opcoes, 'resposta', objeto(objeto(botao).buttonText).displayText)
    if (opcoes.length === 12) break
  }
  return opcoes
}

function conteudo(
  corpo: string | null,
  rodape: string | null,
  opcoes: Opcao[],
  botaoLista: string | null = null,
) {
  const interativa: Interativa | null =
    rodape || botaoLista || opcoes.length
      ? { rodape, opcoes, botaoLista }
      : null
  return { corpo, interativa, escolha: null }
}

export function lerInterativa(tipo: string, valor: unknown, voto: unknown) {
  if (!tipoInterativo(tipo)) return null
  const c = objetoJson(valor)
  if (respostas.has(tipo)) {
    const escolha =
      lerRotulo(voto) ??
      lerRotulo(objeto(c.Response).SelectedDisplayText) ??
      lerRotulo(c.title) ??
      lerRotulo(c.selectedDisplayText)
    return { corpo: null, interativa: null, escolha }
  }
  if (tipo === 'buttonsmessage')
    return conteudo(
      texto(c.contentText),
      texto(c.footerText),
      botoesDaMensagem(c.buttons),
    )
  if (tipo === 'listmessage')
    return conteudo(
      texto(c.description),
      texto(c.footerText),
      itensDaLista(c.sections),
      lerRotulo(c.buttonText),
    )

  const formato = objeto(c.Format)
  // O modelo hidratado vem dentro de Format ou direto no conteúdo.
  const hidratado =
    formato.HydratedFourRowTemplate ??
    formato.hydratedFourRowTemplate ??
    c.hydratedTemplate ??
    c.HydratedTemplate ??
    c.hydratedFourRowTemplate
  if (hidratado) {
    const h = objeto(hidratado)
    const titulo = texto(objeto(h.Title).HydratedTitleText)
    const corpo = [titulo, texto(h.hydratedContentText)]
      .filter(Boolean)
      .join('\n')
    return conteudo(
      texto(corpo),
      texto(h.hydratedFooterText),
      botoesHydrated(h.hydratedButtons),
    )
  }
  const modelo = objeto(formato.InteractiveMessageTemplate ?? c)
  const mensagem = objeto(
    modelo.InteractiveMessage ?? modelo.interactiveMessage ?? modelo,
  )
  const fluxo = objeto(
    mensagem.NativeFlowMessage ?? mensagem.nativeFlowMessage ?? mensagem,
  )
  return conteudo(
    texto(objeto(modelo.body ?? mensagem.body).text),
    texto(objeto(modelo.footer ?? mensagem.footer).text),
    botoesNativos(fluxo.buttons),
  )
}
