import {
  CircleAlert,
  Copy,
  Download,
  ExternalLink,
  List,
  LockKeyhole,
  Mic,
  Pause,
  Phone,
  Play,
  RefreshCw,
} from 'lucide-react'
import { Fragment, type ReactNode, useEffect, useRef, useState } from 'react'
import type { ItemChat, MensagemChat } from '#/lib/wa-conversas'
import type { Interativa } from '#/lib/wa-interativa'
import { PRAZO_REENVIO_MS } from '#/lib/wa-reenvio'
import { formatarWhatsApp } from './formato-whatsapp'
import { Acao, Avatar, MarcaEntrega } from './pecas'

const horaBrasil = new Intl.DateTimeFormat('pt-BR', {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'America/Sao_Paulo',
})
const diaBrasil = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: 'America/Sao_Paulo',
})
export const hora = (data: Date) => horaBrasil.format(data)

function AudioChat({
  arquivo,
  nome,
  segundos,
}: {
  arquivo: string
  nome: string
  segundos: number | null
}) {
  const audio = useRef<HTMLAudioElement>(null)
  const [tocando, setTocando] = useState(false),
    [tempo, setTempo] = useState(0),
    [duracao, setDuracao] = useState(segundos ?? 0),
    [falhou, setFalhou] = useState(false)
  const instante = tocando ? Math.floor(tempo) : Math.ceil(duracao)
  return (
    <>
      {/* biome-ignore lint/a11y/useMediaCaption: gravação da conversa sem transcrição. */}
      <audio
        ref={audio}
        src={arquivo}
        hidden
        preload="metadata"
        onPlay={() => setTocando(true)}
        onPause={() => setTocando(false)}
        onTimeUpdate={(e) => setTempo(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => {
          if (Number.isFinite(e.currentTarget.duration))
            setDuracao(e.currentTarget.duration)
        }}
      />
      <button
        type="button"
        className="play"
        aria-label={tocando ? 'Pausar áudio' : 'Tocar áudio'}
        onClick={() => {
          if (tocando) audio.current?.pause()
          else {
            setFalhou(false)
            void audio.current?.play().catch(() => setFalhou(true))
          }
        }}
      >
        {tocando ? <Pause size={22} /> : <Play size={22} fill="currentColor" />}
      </button>
      <span className="wave">
        <svg
          viewBox="0 0 170 28"
          style={{ width: '100%' }}
          height="28"
          aria-hidden="true"
        >
          <path
            d="M2 12v5m5-8v12m5-16v17m5-13v11m5-16v20m5-21v24m5-19v15m5-12v8m5-12v15m5-19v21m5-23v25m5-21v17m5-12v8m5-7v6m5-10v14m5-18v20m5-17v12m5-8v7m5-12v15m5-18v21m5-15v10m5-9v7m5-10v12m5-17v18m5-21v23m5-18v14m5-8v7m5-9v11m5-14v15m5-10v6m5-7v9m5-12v13m5-9v7m5-6v5"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            opacity=".5"
          />
        </svg>
        <span
          className="knob"
          style={{
            left: `${duracao ? Math.min(100, (tempo / duracao) * 100) : 0}%`,
          }}
        />
      </span>
      <Avatar nome={nome} tamanho={44}>
        <span className="mic">
          <Mic size={14} />
        </span>
      </Avatar>
      <span className="dur" style={{ gridColumn: 2, gridRow: 2 }}>
        {falhou
          ? 'Falha ao reproduzir'
          : `${Math.floor(instante / 60)}:${String(instante % 60).padStart(2, '0')}`}
      </span>
    </>
  )
}

function OpcoesMensagem({ rodape, botaoLista, opcoes }: Interativa) {
  const icones = {
    link: ExternalLink,
    copiar: Copy,
    ligacao: Phone,
    resposta: null,
    item: null,
  }
  return (
    <>
      {rodape && <p className="rodape-mensagem">{rodape}</p>}
      {(botaoLista || opcoes.length > 0) && (
        <ul className="opcoes-mensagem" aria-label="Opções da mensagem">
          {botaoLista && (
            <li aria-label={`Botão da mensagem: ${botaoLista}`}>
              <List aria-hidden="true" size={15} />
              {botaoLista}
            </li>
          )}
          {opcoes.map(({ tipo, rotulo, descricao }, i) => {
            const Icone = icones[tipo]
            return (
              // biome-ignore lint/suspicious/noArrayIndexKey: opções estáticas podem repetir o rótulo.
              <li key={i} aria-label={`Botão da mensagem: ${rotulo}`}>
                {Icone && <Icone aria-hidden="true" size={15} />}
                {rotulo}
                {descricao && <small>{descricao}</small>}
              </li>
            )
          })}
        </ul>
      )}
    </>
  )
}

function Conteudo({ m, nome }: { m: MensagemChat; nome: string }) {
  const arquivo = m.temArquivo
    ? `/api/whatsapp/midia/${encodeURIComponent(m.id)}`
    : undefined
  if (m.tipo === 'texto')
    return (
      <>
        <span style={{ whiteSpace: 'pre-wrap' }}>
          {formatarWhatsApp(m.texto ?? '')}
        </span>
        {m.interativa && <OpcoesMensagem {...m.interativa} />}
      </>
    )
  if (!arquivo)
    return <span>Arquivo indisponível{m.texto && ` · ${m.texto}`}</span>
  if (m.tipo === 'foto')
    return (
      <>
        <img
          className="img"
          style={{ objectFit: 'contain', aspectRatio: 'auto' }}
          alt={
            m.texto ||
            (m.direcao === 'enviada' ? 'Foto enviada' : 'Foto recebida')
          }
          src={arquivo}
        />
        {m.texto && <div className="cap">{formatarWhatsApp(m.texto)}</div>}
      </>
    )
  if (m.tipo === 'audio')
    return (
      <AudioChat
        arquivo={arquivo}
        nome={m.direcao === 'enviada' ? 'Equipe' : nome}
        segundos={m.duracao}
      />
    )
  const extensao = (
    m.nomeArquivo?.match(/\.([a-z0-9]{1,5})$/i)?.[1] ?? 'DOC'
  ).toUpperCase()
  return (
    <>
      <div className="box">
        <span className="ftype">{extensao}</span>
        <div>
          <div className="fname">{m.nomeArquivo ?? 'Documento'}</div>
          <div className="fmeta">
            {m.bytes != null
              ? `${(m.bytes / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} KB · `
              : ''}
            {extensao}
          </div>
        </div>
        <a
          className="dl"
          href={arquivo}
          download={m.nomeArquivo ?? 'documento'}
          aria-label={`Baixar ${m.nomeArquivo ?? 'documento'}`}
        >
          <Download size={16} />
        </a>
      </div>
      {m.texto && <div className="cap">{formatarWhatsApp(m.texto)}</div>}
    </>
  )
}

export function Mensagens({
  lista,
  nome,
  termo,
  repetir,
  historico,
  carregado,
}: {
  historico: ReactNode
  carregado: boolean
  nome: string
  lista: ItemChat[]
  termo: string
  repetir: (m: MensagemChat) => void
}) {
  const area = useRef<HTMLDivElement>(null)
  const noFim = useRef(true)
  const ultima = lista.at(-1)?.id
  useEffect(() => {
    const el = area.current
    if (el && ultima && noFim.current) el.scrollTop = el.scrollHeight
  }, [ultima])
  const hoje = diaBrasil.format(new Date())
  const ontem = diaBrasil.format(new Date(Date.now() - 86400000))
  const visiveis = lista.filter(
    (m) =>
      !termo ||
      [m.texto, m.tipo !== 'nota' ? m.nomeArquivo : null].some((t) =>
        t
          ?.toLocaleLowerCase('pt-BR')
          .includes(termo.toLocaleLowerCase('pt-BR')),
      ),
  )
  return (
    <div
      className="msgs"
      ref={area}
      role="log"
      aria-label="Mensagens"
      onLoadCapture={(e) => {
        const el = e.currentTarget
        if (noFim.current) el.scrollTop = el.scrollHeight
      }}
      onScroll={(e) => {
        const el = e.currentTarget
        noFim.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
      }}
    >
      {historico}
      <div className="sysline crypto">
        <LockKeyhole size={13} />
        Mensagens desta conversa são registradas no ZapCRM e visíveis à sua
        equipe.
      </div>
      {carregado && !lista.some((m) => m.tipo !== 'nota') && (
        <p className="day">Nenhuma mensagem nesta conversa.</p>
      )}
      {visiveis.map((m, i) => {
        const dia = diaBrasil.format(m.instante)
        const anterior = visiveis[i - 1]
        const novoDia = !anterior || diaBrasil.format(anterior.instante) !== dia
        const separador = novoDia && (
          <div className="day">
            {dia === hoje ? 'Hoje' : dia === ontem ? 'Ontem' : dia}
          </div>
        )
        if (m.tipo === 'nota')
          return (
            <Fragment key={`nota-${m.id}`}>
              {separador}
              <div className="note">
                <div className="nh">
                  <LockKeyhole size={13} />
                  Nota interna · {m.autorNome || 'Equipe'}
                  <span className="tm">{hora(m.instante)}</span>
                </div>
                <p className="whitespace-pre-wrap break-words">{m.texto}</p>
              </div>
            </Fragment>
          )
        const primeira =
          novoDia || anterior.tipo === 'nota' || anterior.direcao !== m.direcao
        const enviada = m.direcao === 'enviada'
        const interrompida =
          m.estado === 'fila' &&
          enviada &&
          !m.confirmada &&
          (m.tentativaEm?.getTime() ?? m.instante.getTime()) <
            Date.now() - PRAZO_REENVIO_MS
        const falha = m.estado === 'falha' || interrompida
        return (
          <Fragment key={m.id}>
            {separador}
            <div
              className={`m ${enviada ? 'out' : 'in'} ${primeira ? 'first' : ''} ${falha ? 'failed' : ''}`}
            >
              {falha && (
                <span className="failicon" title="Não enviada">
                  <CircleAlert size={20} />
                </span>
              )}
              <div
                className={`bubble ${{ texto: 'text', foto: 'photo', audio: 'audio', documento: 'doc' }[m.tipo]}`}
              >
                <Conteudo m={m} nome={nome} />
                <span
                  className="meta"
                  style={
                    m.tipo === 'audio'
                      ? { gridRow: 2, gridColumn: 3, justifySelf: 'end' }
                      : undefined
                  }
                >
                  {m.editada && <span>Editada</span>}
                  {hora(m.instante)}
                  {enviada && !falha && <MarcaEntrega estado={m.estado} />}
                </span>
              </div>
            </div>
            {falha && (
              <div className="failrow">
                <CircleAlert size={13} />
                {interrompida ? 'Envio sem confirmação.' : 'Não enviada.'}
                <Acao className="btn-sm" onClick={() => repetir(m)}>
                  <RefreshCw size={13} />
                  Tentar de novo
                </Acao>
              </div>
            )}
          </Fragment>
        )
      })}
    </div>
  )
}
