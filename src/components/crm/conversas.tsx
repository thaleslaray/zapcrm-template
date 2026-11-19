import {
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from '@tanstack/react-query'
import { getRouteApi, useNavigate } from '@tanstack/react-router'
import {
  ArrowLeft,
  Clock,
  LockKeyhole,
  PanelRight,
  Search,
  Send,
  Smile,
  SquarePen,
  WifiOff,
} from 'lucide-react'
import { type CSSProperties, useEffect, useRef, useState } from 'react'
import { Input } from '#/components/ui/input'
import { painelQuery } from '#/lib/carteira-queries'
import { nomeDoContato } from '#/lib/telefone'
import type {
  FilaConversas,
  LinhaConversa,
  MensagemChat,
} from '#/lib/wa-conversas'
import { enviarTextoFn, marcarLidaFn } from '#/lib/wa-conversas-fns'
import {
  conversasQuery,
  invalidarConversa,
  mensagensQuery,
} from '#/lib/wa-conversas-queries'
import { CompositorMidia, repetirMidia } from './compositor-midia'
import { HistoricoAnterior } from './historico-anterior'
import { hora, Mensagens } from './mensagens'
import { Painel } from './painel'
import { Acao, Avatar, Busca, Filtro, IconeBotao, MarcaEntrega } from './pecas'
import { PrimeiroNumero } from './primeiro-numero'
import { SugestoesRespostas } from './sugestoes-respostas'
import { useGravarNota } from './usar-nota'

type Canal = FilaConversas['numeros'][number]
function Marca({ n }: { n: Canal }) {
  return (
    <span className="nummark" style={{ '--nc': n.cor } as CSSProperties}>
      {n.nome}
    </span>
  )
}
function Etapa({ v }: { v: LinhaConversa }) {
  return (
    v.etapa && (
      <span className="stage" style={{ '--c': v.etapaCor } as CSSProperties}>
        <span className="dot" />
        {v.etapa}
      </span>
    )
  )
}
function Avisos({ canais, gestor }: { canais: Canal[]; gestor: boolean }) {
  return canais.map((n) => (
    <div key={n.id}>
      {n.estado === 'desconectado' && (
        <div className="warn-strip" role="alert">
          <span className="wi">
            <WifiOff size={18} />
          </span>
          <div>
            <b>{n.nome} está desconectado</b>
            <span>Mensagens não estão chegando.</span>
          </div>
          {gestor && (
            <a
              className="btn btn-warn btn-sm"
              href={`/app/configuracoes?secao=numeros&numero=${encodeURIComponent(n.id)}`}
            >
              Reconectar
            </a>
          )}
        </div>
      )}
      {n.sincronizando && (
        <div className="warn-strip" role="status">
          Sincronizando histórico · {n.nome}
        </div>
      )}
    </div>
  ))
}
function ListaConversas({
  dados,
  selecionada,
  abrir,
  gestor,
  usuario,
}: {
  dados: FilaConversas
  selecionada?: string
  abrir: (id: string) => void
  gestor: boolean
  usuario: string
}) {
  const [q, setQ] = useState(''),
    [filtro, setFiltro] = useState('Todas'),
    [numero, setNumero] = useState(''),
    [tag, setTag] = useState('')
  const termo = q.trim().toLocaleLowerCase('pt-BR')
  const digitos = /^[+()\d\s.-]+$/.test(termo) ? termo.replace(/\D/g, '') : ''
  const lista = dados.lista.filter(
    (v) =>
      (!numero || v.numeroId === numero) &&
      (!tag || v.tags.includes(tag)) &&
      (filtro !== 'Não lidas' || v.naoLidas > 0) &&
      (filtro !== 'Minhas' || v.responsavelId === usuario) &&
      (filtro !== 'Retorno atrasado' || v.atraso) &&
      ((digitos.length > 0 &&
        v.telefone?.replace(/\D/g, '').includes(digitos)) ||
        [v.nome, v.telefone, v.empresa].some((s) =>
          s?.toLocaleLowerCase('pt-BR').includes(termo),
        )),
  )
  const canais = new Map(dados.numeros.map((n) => [n.id, n]))
  return (
    <section className="list-col" aria-label="Conversas">
      <Avisos canais={dados.numeros} gestor={gestor} />
      <div className="list-head">
        <h1>Conversas</h1>
        <IconeBotao nome="Nova conversa" disabled>
          <SquarePen size={20} />
        </IconeBotao>
      </div>
      <Busca nome="Buscar conversa" value={q} onChange={setQ} />
      <div className="pills" role="tablist" aria-label="Filtrar conversas">
        {['Todas', 'Não lidas', 'Retorno atrasado', 'Minhas'].map((f) => (
          <button
            key={f}
            type="button"
            role="tab"
            className={`pill ${f === filtro ? 'on' : ''}`}
            aria-selected={f === filtro}
            onClick={() => setFiltro(f)}
          >
            {f === 'Retorno atrasado' && <Clock size={13} />} {f}
          </button>
        ))}
      </div>
      <div className="subfilters">
        {dados.numeros.length === 1 ? (
          <span className="onlynum">
            <Marca n={dados.numeros[0]} />
            <span className="muted">{dados.numeros[0].telefone}</span>
          </span>
        ) : (
          <Filtro
            nome="Número da empresa"
            todos="Todos os números"
            valor={numero}
            onChange={setNumero}
            opcoes={dados.numeros.map((n) => [n.id, n.nome])}
          />
        )}
        <Filtro
          nome="Etiqueta"
          todos="Todas as etiquetas"
          valor={tag}
          onChange={setTag}
          opcoes={dados.etiquetas.map((t) => [t.id, t.nome])}
        />
      </div>
      <div className="rows">
        {lista.map((v) => {
          const n = canais.get(v.numeroId)
          const nome = nomeDoContato(v)
          const previa = v.resumo ?? 'Nenhuma mensagem ainda'
          return (
            <button
              type="button"
              key={v.id}
              className={`row ${v.naoLidas ? 'unread' : ''} ${selecionada === v.id ? 'sel' : ''}`}
              onClick={() => abrir(v.id)}
            >
              <Avatar nome={nome} contatoId={v.contatoId} />
              <span className="row-main">
                <span className="l1">
                  <span className="nm">{nome}</span>
                  <span className="tm">{v.ultimaEm && hora(v.ultimaEm)}</span>
                </span>
                <span className="l2">
                  <span className="pv">
                    {v.ultimaDirecao === 'enviada' && v.ultimaEstado && (
                      <MarcaEntrega estado={v.ultimaEstado} />
                    )}
                    <span className="t">
                      {v.ultimaDirecao === 'enviada' &&
                      !v.ultimaEstado &&
                      previa
                        ? 'Você: '
                        : ''}
                      {previa}
                    </span>
                  </span>
                  {!!v.atraso && (
                    <span className="late">
                      <Clock size={12} />
                      Atrasado
                    </span>
                  )}
                  {v.naoLidas > 0 && (
                    <span className="badge">{v.naoLidas}</span>
                  )}
                </span>
                <span className="l3">
                  <Etapa v={v} />
                  {n && <Marca n={n} />}{' '}
                  {filtro !== 'Minhas' && v.responsavel && (
                    <span className="own" title={v.responsavel}>
                      <Avatar nome={v.responsavel} tamanho={20} />
                    </span>
                  )}
                </span>
              </span>
            </button>
          )
        })}
        {!lista.length && (
          <div className="empty-list">
            <Search size={28} />
            <p>
              {q
                ? `Nada encontrado para “${q}”`
                : dados.lista.length
                  ? 'Nenhuma conversa com esses filtros.'
                  : 'Nenhuma conversa ainda.'}
            </p>
            {(q || numero || tag || filtro !== 'Todas') && (
              <Acao
                onClick={() => {
                  setQ('')
                  setNumero('')
                  setTag('')
                  setFiltro('Todas')
                }}
              >
                {q ? 'Limpar busca' : 'Limpar filtros'}
              </Acao>
            )}
          </div>
        )}
      </div>
    </section>
  )
}

function Chat({
  v,
  usuario,
  painel,
  alternar,
  voltar,
}: {
  v: LinhaConversa
  usuario: string
  painel: boolean
  alternar: () => void
  voltar: () => void
}) {
  const nome = nomeDoContato(v)
  const cache = useQueryClient()
  const {
    data: chat,
    isError,
    refetch,
  } = useQuery(mensagensQuery(usuario, v.id))
  const gravadas = chat?.lista
  const [texto, setTexto] = useState(''),
    [buscando, setBuscando] = useState(false),
    [busca, setBusca] = useState('')
  const [notaInterna, setNotaInterna] = useState(false)
  const [textoNota, setTextoNota] = useState('')
  const nota = useGravarNota(v.contatoId, v.id)
  const conteudo = notaInterna ? textoNota : texto
  const [erroMidia, setErroMidia] = useState('')
  const [pendentes, setPendentes] = useState<MensagemChat[]>([])
  const rascunho = useRef({ id: '', texto: '' })
  const emVoo = useRef(new Set<string>())
  useEffect(() => {
    if (!v.naoLidas || !gravadas || document.hidden) return
    let ativo = true
    void marcarLidaFn({ data: v.id })
      .then(() => {
        if (ativo)
          return cache.invalidateQueries({
            queryKey: conversasQuery(usuario).queryKey,
          })
      })
      .catch(() => {})
    return () => {
      ativo = false
    }
  }, [v.id, v.naoLidas, usuario, cache, gravadas])

  function digitar(valor: string) {
    rascunho.current = { id: '', texto: valor }
    setTexto(valor)
  }
  async function enviar(id: string, corpo: string, repetir: boolean) {
    if (!corpo || emVoo.current.has(id)) return
    emVoo.current.add(id)
    const agora = new Date()
    const local: MensagemChat = {
      id,
      texto: corpo,
      interativa: null,
      editada: false,
      tipo: 'texto',
      estado: 'fila',
      direcao: 'enviada',
      instante: agora,
      tentativaEm: agora,
      confirmada: 0,
      nomeArquivo: null,
      bytes: null,
      duracao: null,
      temArquivo: 0,
    }
    setPendentes((antes) => [...antes.filter((m) => m.id !== id), local])
    if (rascunho.current.texto.trim() === corpo) digitar('')
    const restaurar = () => {
      if (!rascunho.current.texto) {
        rascunho.current = { id, texto: corpo }
        setTexto(corpo)
      }
    }
    try {
      const estado = await enviarTextoFn({
        data: { id, conversaId: v.id, texto: corpo, repetir },
      })
      if (estado === 'falha') restaurar()
      await invalidarConversa(cache, usuario, v.id)
      setPendentes((antes) => antes.filter((m) => m.id !== id))
    } catch {
      setPendentes((antes) =>
        antes.map((m) => (m.id === id ? { ...m, estado: 'falha' } : m)),
      )
      restaurar()
    } finally {
      emVoo.current.delete(id)
    }
  }
  const salvas = new Map(
    (gravadas ?? []).filter((m) => m.tipo !== 'nota').map((m) => [m.id, m]),
  )
  const internas = (gravadas ?? []).filter((m) => m.tipo === 'nota')
  for (const local of pendentes) {
    const salva = salvas.get(local.id)
    if (
      !salva ||
      ((salva.estado === 'falha' || salva.estado === 'fila') &&
        emVoo.current.has(local.id))
    )
      salvas.set(local.id, local)
  }
  const lista = [...salvas.values(), ...internas].sort(
    (a, b) => a.instante.getTime() - b.instante.getTime(),
  )
  async function reenviarArquivo(id: string) {
    if (emVoo.current.has(id)) return
    emVoo.current.add(id)
    setErroMidia('')
    try {
      await repetirMidia(v.id, id)
      await invalidarConversa(cache, usuario, v.id)
    } catch {
      setErroMidia('Não foi possível confirmar o reenvio. Tente de novo.')
    } finally {
      emVoo.current.delete(id)
    }
  }
  function enviarRascunho() {
    const { id, texto } = rascunho.current
    if (texto.trim()) void enviar(id || crypto.randomUUID(), texto.trim(), !!id)
  }
  return (
    <section className="chat-col" aria-label={`Conversa com ${nome}`}>
      <header className="chat-head">
        <IconeBotao nome="Voltar" className="back" onClick={voltar}>
          <ArrowLeft size={22} />
        </IconeBotao>
        <button
          type="button"
          className="who"
          aria-label="Abrir painel do contato"
          onClick={alternar}
        >
          <Avatar nome={nome} contatoId={v.contatoId} />
          <span style={{ minWidth: 0 }}>
            <span className="nm">
              {nome}
              {v.empresa && <small>{v.empresa}</small>}
            </span>
            <span className="sub">
              <span>Responsável: {v.responsavel ?? 'Sem responsável'}</span>
              {v.etapa && (
                <>
                  {' '}
                  · <Etapa v={v} />
                </>
              )}
            </span>
          </span>
        </button>
        <IconeBotao
          nome="Buscar na conversa"
          className="hide-m"
          onClick={() => {
            setBusca('')
            setBuscando(!buscando)
          }}
        >
          <Search size={20} />
        </IconeBotao>
        <IconeBotao
          nome="Painel do contato"
          className={painel ? 'on' : ''}
          onClick={alternar}
        >
          <PanelRight size={20} />
        </IconeBotao>
      </header>
      {buscando && (
        <Input
          type="search"
          aria-label="Buscar mensagem"
          placeholder="Buscar mensagem"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
        />
      )}
      {isError ? (
        <div className="empty-list" role="alert">
          Não foi possível carregar as mensagens.
          <Acao onClick={() => void refetch()}>Tentar de novo</Acao>
        </div>
      ) : (
        <Mensagens
          nome={nome}
          lista={lista}
          termo={busca}
          historico={
            chat && (
              <HistoricoAnterior
                historico={chat.historico}
                conversaId={v.id}
                atualizar={refetch}
              />
            )
          }
          carregado={!!chat}
          repetir={(m) => {
            if (m.tipo !== 'texto') void reenviarArquivo(m.id)
            else if (m.texto) void enviar(m.id, m.texto, true)
          }}
        />
      )}
      {notaInterna && nota.erro && <p role="alert">{nota.erro}</p>}
      {erroMidia && (
        <p className="midia-aviso" role="alert">
          {erroMidia}
        </p>
      )}
      <CompositorMidia
        conversa={v.id}
        notaInterna={notaInterna}
        atualizar={() => invalidarConversa(cache, usuario, v.id)}
      >
        {(anexar, gravar) => (
          <form
            className={notaInterna ? 'composer notemode' : 'composer'}
            onSubmit={async (e) => {
              e.preventDefault()
              if (notaInterna) {
                if (textoNota.trim() && (await nota.criar(textoNota)))
                  setTextoNota('')
              } else enviarRascunho()
            }}
          >
            {notaInterna && (
              <span className="notehint">
                <LockKeyhole size={12} />
                Nota interna: só a equipe vê
              </span>
            )}
            {!notaInterna && /^\/[\p{L}\p{N}_-]*$/u.test(texto) && (
              <SugestoesRespostas
                usuario={usuario}
                termo={texto}
                escolher={digitar}
              />
            )}
            <IconeBotao nome="Emoji" disabled>
              <Smile size={22} />
            </IconeBotao>
            {anexar}
            <div className="box">
              <input
                aria-label={notaInterna ? 'Nota para a equipe' : 'Mensagem'}
                autoComplete="off"
                maxLength={notaInterna ? 4000 : 16000}
                disabled={nota.ocupado}
                placeholder={
                  notaInterna
                    ? 'Nota para a equipe'
                    : 'Digite uma mensagem ou / para respostas rápidas'
                }
                value={conteudo}
                onChange={(e) =>
                  notaInterna
                    ? setTextoNota(e.target.value)
                    : digitar(e.target.value)
                }
              />
              <IconeBotao
                nome="Alternar nota interna"
                aria-pressed={notaInterna}
                className={notaInterna ? 'on' : ''}
                disabled={nota.ocupado}
                onClick={() => setNotaInterna(!notaInterna)}
              >
                <LockKeyhole size={17} />
              </IconeBotao>
            </div>
            {!notaInterna && !texto ? (
              gravar
            ) : (
              <button
                className="send"
                type="submit"
                disabled={nota.ocupado || !conteudo.trim()}
                aria-label={
                  notaInterna ? 'Salvar nota interna' : 'Enviar mensagem'
                }
              >
                {notaInterna ? <LockKeyhole size={20} /> : <Send size={22} />}
              </button>
            )}
          </form>
        )}
      </CompositorMidia>
    </section>
  )
}

const app = getRouteApi('/_app')
const rota = getRouteApi('/_app/app/conversas')

export function Conversas({ gestor }: { gestor: boolean }) {
  const { session } = app.useRouteContext()
  const usuario = session.user.id
  const busca = rota.useSearch()
  const { conversa, contato, funil } = busca
  const navegar = useNavigate({ from: '/app/conversas' })
  const {
    data: dados,
    isError,
    refetch,
  } = useSuspenseQuery(conversasQuery(usuario))
  const [amplo, setAmplo] = useState(false),
    [chatVisivel, setChatVisivel] = useState(false)
  useEffect(() => {
    const largo = matchMedia('(min-width: 1024px)'),
      duplo = matchMedia('(min-width: 768px)')
    function ajustar() {
      setAmplo(largo.matches)
      setChatVisivel(duplo.matches)
    }
    ajustar()
    largo.addEventListener('change', ajustar)
    duplo.addEventListener('change', ajustar)
    return () => {
      largo.removeEventListener('change', ajustar)
      duplo.removeEventListener('change', ajustar)
    }
  }, [])
  const ultima = useRef('')
  const selecionada = conversa
    ? dados.lista.find((l) => l.id === conversa)
    : contato
      ? dados.lista.find((l) => !funil && l.contatoId === contato)
      : (dados.lista.find((l) => l.id === ultima.current) ?? dados.lista[0])
  const alvo = {
    contatoId: contato ?? (conversa ? undefined : selecionada?.contatoId),
    conversaId: conversa ?? (contato ? undefined : selecionada?.id),
    funilId: funil,
  }
  const visivel = busca.painel ?? (amplo || Boolean(contato && !selecionada))
  const painel = useQuery({
    ...painelQuery(usuario, alvo),
    enabled: visivel && Boolean(alvo.conversaId || alvo.contatoId),
  })
  const v =
    contato && !conversa && painel.data
      ? dados.lista.find((l) => l.id === painel.data.conversaAtivaId)
      : selecionada
  useEffect(() => {
    if (v) ultima.current = v.id
  }, [v])
  function abrir(id?: string) {
    void navegar({ search: id ? { conversa: id } : {} })
  }
  function mostrarPainel(aberto: boolean) {
    void navegar({ search: { ...busca, painel: aberto }, replace: true })
  }
  if (isError)
    return (
      <div className="empty-list" role="alert">
        Não foi possível carregar
        <Acao onClick={() => void refetch()}>Tentar de novo</Acao>
      </div>
    )
  if (conversa && (!v || (contato && contato !== v.contatoId)))
    return (
      <div className="empty-list">
        <h1>Sem acesso</h1>
        <p>Esta conversa não pertence a um dos seus setores.</p>
      </div>
    )
  if (
    !contato &&
    !dados.lista.length &&
    !dados.numeros.some((n) => n.estado === 'conectado')
  )
    return (
      <PrimeiroNumero
        gestor={gestor}
        avisos={<Avisos canais={dados.numeros} gestor={gestor} />}
      />
    )
  const aberto = Boolean(conversa || contato)
  return (
    <div className={`conv ${aberto ? 'show-chat' : 'show-list'}`}>
      <ListaConversas
        dados={dados}
        selecionada={v?.id}
        abrir={abrir}
        gestor={gestor}
        usuario={usuario}
      />
      {v && (chatVisivel || aberto) ? (
        <Chat
          key={v.id}
          v={v}
          usuario={usuario}
          painel={visivel}
          alternar={() => mostrarPainel(!visivel)}
          voltar={() => abrir()}
        />
      ) : (
        <section className="chat-col">
          {contato && (
            <header className="chat-head">
              <IconeBotao
                nome="Voltar"
                className="back"
                onClick={() => abrir()}
              >
                <ArrowLeft size={22} />
              </IconeBotao>
              <Acao onClick={() => mostrarPainel(true)}>
                Abrir painel do contato
              </Acao>
            </header>
          )}
          <div className="welcome">
            <p>
              {contato
                ? 'Nenhuma conversa disponível para este contato neste contexto.'
                : 'As mensagens recebidas aparecem aqui.'}
            </p>
          </div>
        </section>
      )}
      {visivel && (alvo.contatoId || alvo.conversaId) && (
        <>
          <button
            type="button"
            className="scrim"
            aria-label="Voltar ao chat"
            onClick={() => mostrarPainel(false)}
          />
          {painel.data ? (
            <Painel
              key={painel.data.contato.id}
              dados={painel.data}
              usuarioId={usuario}
              conversaId={v?.id}
              fechar={() => mostrarPainel(false)}
              selecionarFunil={(id) => {
                void navegar({
                  search: {
                    contato: painel.data.contato.id,
                    conversa: v?.id,
                    funil: id,
                    painel: true,
                  },
                  replace: true,
                })
              }}
            />
          ) : (
            <aside className="panel" aria-label="Painel do contato">
              <div
                className="empty-list"
                role={painel.isError ? 'alert' : 'status'}
              >
                {painel.isError ? (
                  <>
                    Não foi possível carregar o painel.
                    <Acao onClick={() => void painel.refetch()}>
                      Tentar de novo
                    </Acao>
                  </>
                ) : (
                  'Carregando dados do contato…'
                )}
                <Acao onClick={() => mostrarPainel(false)}>Fechar painel</Acao>
              </div>
            </aside>
          )}
        </>
      )}
    </div>
  )
}
