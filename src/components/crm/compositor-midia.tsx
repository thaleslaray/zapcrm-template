import { FileText, ImageIcon, Mic, Paperclip, Send, X } from 'lucide-react'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { buscarComSessao } from '#/lib/sessao-expirada'
import { Gravador } from './gravador'
import { Acao, IconeBotao } from './pecas'

type Anexo = {
  id: string
  arquivo: File
  tipo: 'foto' | 'documento' | 'audio'
  duracao?: number
}
function postar(conversa: string, id: string, anexo?: Anexo, legenda = '') {
  return buscarComSessao(
    `/api/whatsapp/envio/${encodeURIComponent(conversa)}/${encodeURIComponent(id)}`,
    {
      method: 'POST',
      headers: anexo
        ? {
            'x-arquivo-nome': encodeURIComponent(anexo.arquivo.name),
            'x-legenda': encodeURIComponent(legenda),
            ...(anexo.duracao ? { 'x-duracao': String(anexo.duracao) } : {}),
          }
        : undefined,
      body: anexo?.arquivo,
    },
  )
}
async function conferirEnvio(resposta: Response) {
  const dados = (await resposta.json()) as { erro?: string; estado?: string }
  if (!resposta.ok || !dados.estado)
    throw new Error(dados.erro || 'Não foi possível confirmar o envio.')
}

export async function repetirMidia(conversa: string, id: string) {
  await conferirEnvio(await postar(conversa, id))
}

function PreviaFoto({ arquivo }: { arquivo: File }) {
  const [url, setUrl] = useState('')
  useEffect(() => {
    const local = URL.createObjectURL(arquivo)
    setUrl(local)
    return () => URL.revokeObjectURL(local)
  }, [arquivo])
  return url && <img className="anexo-foto" src={url} alt="Prévia da foto" />
}

export function CompositorMidia({
  conversa,
  notaInterna,
  atualizar,
  children,
}: {
  conversa: string
  notaInterna: boolean
  atualizar: () => Promise<void>
  children: (anexar: ReactNode, gravar: ReactNode) => ReactNode
}) {
  const foto = useRef<HTMLInputElement>(null)
  const documento = useRef<HTMLInputElement>(null)
  const ocupado = useRef(false)
  const [anexo, setAnexo] = useState<Anexo | null>(null)
  const [legenda, setLegenda] = useState('')
  const [gravando, setGravando] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [incerto, setIncerto] = useState(false)
  const [erro, setErro] = useState('')
  function limpar() {
    setAnexo(null)
    setLegenda('')
    setErro('')
    setIncerto(false)
  }
  async function enviar(atual: Anexo) {
    if (ocupado.current) return
    ocupado.current = true
    setEnviando(true)
    setErro('')
    try {
      // A resposta anterior pode ter se perdido depois da escrita. Só repõe
      // os bytes se o servidor informar que ainda precisa do arquivo.
      let res = incerto ? await postar(conversa, atual.id) : undefined
      if (!res || res.status === 404)
        res = await postar(conversa, atual.id, atual, legenda)
      if (res.status >= 400 && res.status < 500) {
        const dados = (await res.json()) as { erro?: string }
        setErro(dados.erro || 'Não foi possível enviar este arquivo.')
        return
      }
      await conferirEnvio(res)
      await atualizar()
      limpar()
    } catch {
      setIncerto(true)
      setErro('Não foi possível confirmar o envio. O anexo foi mantido.')
    } finally {
      ocupado.current = false
      setEnviando(false)
    }
  }
  if (gravando)
    return (
      <Gravador
        cancelar={() => setGravando(false)}
        enviar={(arquivo, duracao) => {
          const atual: Anexo = {
            id: crypto.randomUUID(),
            arquivo,
            duracao,
            tipo: 'audio',
          }
          setAnexo(atual)
          setGravando(false)
          void enviar(atual)
        }}
      />
    )
  if (anexo) {
    const tamanho = anexo.arquivo.size
    const unidade = tamanho < 1024 ? 'B' : tamanho < 1024 ** 2 ? 'KB' : 'MB'
    const valor =
      tamanho / (unidade === 'B' ? 1 : unidade === 'KB' ? 1024 : 1024 ** 2)
    const nomeEnvio = incerto
      ? 'Tentar de novo'
      : `Enviar ${anexo.tipo === 'audio' ? 'áudio' : anexo.tipo}`
    return (
      <form
        className="composer anexo-previa"
        onSubmit={(e) => {
          e.preventDefault()
          void enviar(anexo)
        }}
      >
        <div className="anexo-resumo">
          {anexo.tipo === 'foto' ? (
            <PreviaFoto arquivo={anexo.arquivo} />
          ) : anexo.tipo === 'audio' ? (
            <Mic />
          ) : (
            <FileText />
          )}
          <div className="anexo-arquivo">
            <strong>{anexo.arquivo.name}</strong>
            <small>
              {valor.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}{' '}
              {unidade}
            </small>
          </div>
          <IconeBotao
            nome="Cancelar anexo"
            disabled={enviando}
            onClick={limpar}
          >
            <X size={20} />
          </IconeBotao>
        </div>
        {erro && (
          <p className="midia-aviso" role="alert">
            {erro}
          </p>
        )}
        <div className="anexo-acoes">
          {anexo.tipo === 'foto' && (
            <div className="box">
              <input
                aria-label="Legenda"
                placeholder="Adicione uma legenda"
                maxLength={1024}
                readOnly={enviando || incerto}
                value={legenda}
                onChange={(e) => setLegenda(e.target.value)}
              />
            </div>
          )}
          {enviando && <span role="status">Enviando…</span>}
          {incerto ? (
            <Acao type="submit" tipo="primary" disabled={enviando}>
              Tentar de novo
            </Acao>
          ) : (
            <button
              type="submit"
              className="send"
              aria-label={nomeEnvio}
              title={nomeEnvio}
              disabled={enviando}
            >
              <Send size={22} />
            </button>
          )}
        </div>
      </form>
    )
  }
  function selecionar(tipo: 'foto' | 'documento', arquivo?: File) {
    if (arquivo) setAnexo({ tipo, arquivo, id: crypto.randomUUID() })
  }
  const anexar = (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild disabled={notaInterna}>
          <IconeBotao nome="Anexar" disabled={notaInterna}>
            <Paperclip size={21} />
          </IconeBotao>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start">
          <DropdownMenuItem onSelect={() => foto.current?.click()}>
            <ImageIcon />
            Foto
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => documento.current?.click()}>
            <FileText />
            Documento
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <input
        hidden
        ref={foto}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        aria-label="Escolher foto"
        onChange={(e) => selecionar('foto', e.target.files?.[0])}
      />
      <input
        hidden
        ref={documento}
        type="file"
        accept="application/pdf"
        aria-label="Escolher documento"
        onChange={(e) => selecionar('documento', e.target.files?.[0])}
      />
    </>
  )
  const gravar = (
    <button
      className="send mic"
      type="button"
      aria-label="Gravar áudio"
      onClick={(e) => {
        // Enviar e gravar ocupam a mesma posição. O segundo clique de um
        // envio de texto não deve abrir o microfone quando o campo esvazia.
        if (e.detail <= 1) setGravando(true)
      }}
    >
      <Mic size={22} />
    </button>
  )
  return children(anexar, gravar)
}
