import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getRouteApi, Link } from '@tanstack/react-router'
import {
  BriefcaseBusiness,
  Calendar,
  Check,
  Clock,
  Ellipsis,
  X,
} from 'lucide-react'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { Skeleton } from '#/components/ui/skeleton'
import { executarComandoFn } from '#/lib/carteira-comandos'
import type {
  CartaoCarteira,
  EtapaCarteira,
  QuadroCarteira,
} from '#/lib/carteira-leitura-tipos'
import { invalidarCarteira, quadroQuery } from '#/lib/carteira-queries'
import { nomeDoContato } from '#/lib/telefone'
import {
  corDaMarca,
  dataBreve,
  dataRelativa,
  EtiquetaCarteira,
  enderecoDoContato,
  valorEmReais,
} from './carteira-pecas'
import { useRelogioRetornos } from './horario-retorno'
import { Acao, Avatar, Filtro } from './pecas'

const rota = getRouteApi('/_app/app/funil')

function Cartao({
  item,
  etapas,
  mover,
  arrastar,
  ocupado,
  agora,
}: {
  item: CartaoCarteira
  etapas: EtapaCarteira[]
  mover: (cartao: CartaoCarteira, etapa: EtapaCarteira) => void
  arrastar: (id: string) => void
  ocupado: boolean
  agora: number
}) {
  const nome = nomeDoContato(item.contato)
  const fechado = item.fechadoEm !== null
  const atrasado = item.retorno && item.retorno.marcadoPara < agora
  const [arrastando, setArrastando] = useState(false)
  const href = enderecoDoContato(item.contato.id, {
    conversa: item.conversa?.id,
    funil: item.funilId,
  })
  return (
    <article
      className={`card kcard${arrastando ? ' dragging' : ''}`}
      id={`negocio-${item.id}`}
      draggable={!fechado && !ocupado}
      onDragStart={(e) => {
        arrastar(item.id)
        setArrastando(true)
        e.dataTransfer.setData('text/plain', item.id)
        e.dataTransfer.effectAllowed = 'move'
      }}
      onDragEnd={() => {
        arrastar('')
        setArrastando(false)
      }}
    >
      <a
        className="card-link"
        draggable={false}
        href={href}
        aria-label={`${item.conversa ? 'Abrir conversa com' : 'Abrir painel de'} ${nome}`}
      >
        <div className="top">
          <Avatar nome={nome} contatoId={item.contato.id} tamanho={32} />
          <div className="min-w-0 pr-1">
            <div className="nm">{nome}</div>
            <div className="co">{item.contato.empresa}</div>
          </div>
        </div>
        {item.origem ? (
          <div className="orig">
            <BriefcaseBusiness size={14} />
            Venda ganha
            {item.origem.fechadoEm
              ? ` em ${dataBreve(item.origem.fechadoEm)}`
              : ''}
            {item.origem.responsavelNome &&
              ` · ${item.origem.responsavelNome.split(' ')[0]}`}
          </div>
        ) : (
          <div className="val money">
            {item.valorCentavos == null
              ? '—'
              : valorEmReais(item.valorCentavos)}
          </div>
        )}
        {item.etiquetas.length > 0 && (
          <div className="tags">
            {item.etiquetas.map((e) => (
              <EtiquetaCarteira key={e.id} etiqueta={e} />
            ))}
          </div>
        )}
        <div className="ft">
          {item.responsavelNome && (
            <Avatar nome={item.responsavelNome} tamanho={22} />
          )}
          <span>
            {item.responsavelNome?.split(' ')[0] ?? 'Sem responsável'}
          </span>
          {item.fechadoEm !== null ? (
            <span className="rt">
              <Calendar size={13} />
              {dataBreve(item.fechadoEm)}
            </span>
          ) : (
            item.retorno && (
              <span className={`rt ${atrasado ? 'late-t' : ''}`}>
                <Clock size={13} />
                {atrasado && 'Atrasado · '}
                {dataRelativa(item.retorno.marcadoPara)}
              </span>
            )
          )}
        </div>
      </a>
      {!fechado && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="icon-btn mv"
              aria-label="Mover para…"
              disabled={ocupado}
            >
              <Ellipsis size={18} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="min-w-[200px] rounded-[10px] border-0 bg-[var(--surface)] p-[5px] shadow-[var(--shadow-pop)]"
          >
            <DropdownMenuLabel className="muted text-xs">
              Mover para…
            </DropdownMenuLabel>
            {etapas.map((e) => (
              <DropdownMenuItem
                key={e.id}
                onSelect={() => mover(item, e)}
                style={corDaMarca('--c', e.cor)}
                className="h-9 rounded-[7px]"
              >
                <span className="dot" />
                {e.nome}
                {e.id === item.etapaId && (
                  <Check size={15} className="ml-auto text-[var(--brand)]" />
                )}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </article>
  )
}

function Quadro({
  dados,
  responsavelId,
  numeroId,
  filtrarResponsavel,
  filtrarNumero,
}: {
  dados: QuadroCarteira
  responsavelId: string
  numeroId: string
  filtrarResponsavel: (id: string) => void
  filtrarNumero: (id: string) => void
}) {
  const [etapaSelecionada, setEtapaSelecionada] = useState('')
  const [sobre, setSobre] = useState('')
  const [salvando, setSalvando] = useState(false)
  const ocupado = useRef(false)
  const arrastado = useRef('')
  const cache = useQueryClient()
  const [somenteAtrasados, setSomenteAtrasados] = useState(false)
  const agora = useRelogioRetornos(
    dados.cartoes.flatMap((c) => (c.retorno ? [c.retorno.marcadoPara] : [])),
  )
  const f = dados.funil
  if (!f)
    return (
      <div className="empty-list">
        <h1>Funil</h1>
        <p>Nenhum funil cadastrado.</p>
      </div>
    )
  const etapas = dados.etapas.filter((e) => e.funilId === f.id)
  const atual = etapaSelecionada || etapas[0]?.id
  const pos = f.id === 'pos'
  const numeros = dados.numeros.filter((n) => n.setorId === f.setorId)
  const cartoes = somenteAtrasados
    ? dados.cartoes.filter(
        (c) =>
          c.fechadoEm === null && c.retorno && c.retorno.marcadoPara < agora,
      )
    : dados.cartoes
  const abertos = cartoes.filter((c) => c.fechadoEm === null)
  const ganhos = cartoes.filter((c) => c.fechamento === 'sucesso')
  const valorTotal = (lista: CartaoCarteira[]) =>
    valorEmReais(
      lista.reduce(
        (total, c) => total + (c.origem ? 0 : (c.valorCentavos ?? 0)),
        0,
      ),
    )
  const colunas = etapas.map((etapa) => {
    const itens = cartoes.filter((c) => c.etapaId === etapa.id)
    return {
      etapa,
      itens,
      total:
        pos && !itens.some((c) => !c.origem && c.valorCentavos !== null)
          ? `${itens.length} ${itens.length === 1 ? 'negócio' : 'negócios'}`
          : valorTotal(itens),
    }
  })
  async function mover(cartao: CartaoCarteira, etapa: EtapaCarteira) {
    if (
      ocupado.current ||
      cartao.etapaId === etapa.id ||
      cartao.fechadoEm !== null
    )
      return
    ocupado.current = true
    setSalvando(true)
    try {
      const resultado = await executarComandoFn({
        data: { tipo: 'moverNegocio', negocioId: cartao.id, etapaId: etapa.id },
      })
      if (!resultado.ok) {
        toast.error(resultado.mensagem)
        return
      }
      await invalidarCarteira(cache)
      setEtapaSelecionada(etapa.id)
      const criado = resultado.posVenda
      if (criado) {
        const destino = criado.podeAbrir
          ? `/app/funil?funil=${encodeURIComponent(criado.funilId)}#negocio-${encodeURIComponent(criado.negocioId)}`
          : enderecoDoContato(cartao.contatoId, {
              funil: cartao.funilId,
              painel: true,
            })
        toast(
          <>
            Negócio criado no Pós-venda · {criado.etapa}{' '}
            <a className="ml-2 font-semibold underline" href={destino}>
              Ver
            </a>
          </>,
          { duration: 9000 },
        )
      } else toast.success(`Movido para ${etapa.nome}`)
    } catch {
      toast.error('Não foi possível confirmar a mudança de etapa.', {
        action: {
          label: 'Tentar de novo',
          onClick: () => void mover(cartao, etapa),
        },
      })
    } finally {
      ocupado.current = false
      setSalvando(false)
    }
  }
  return (
    <div className="page">
      <div className="page-head">
        <h1>Funil</h1>
        <div className="seg pipeseg" role="tablist" aria-label="Funis">
          {dados.funis.map((item) => (
            <Link
              to="/app/funil"
              search={{ funil: item.id }}
              key={item.id}
              role="tab"
              aria-selected={item.id === f.id}
              className={item.id === f.id ? 'on' : ''}
              style={corDaMarca('--pc', item.cor)}
            >
              <span className="dot" />
              {item.nome}
            </Link>
          ))}
        </div>
        <span className="sum">
          {pos ? (
            <>
              <b>{abertos.length}</b>{' '}
              {abertos.length === 1 ? 'instalação' : 'instalações'} em andamento
              · <b>{ganhos.length}</b>{' '}
              {ganhos.length === 1 ? 'concluída' : 'concluídas'} em 30 dias
              {cartoes.some((c) => !c.origem && c.valorCentavos !== null) ? (
                <>
                  {' '}
                  · <b>{valorTotal(abertos)}</b> em aberto ·{' '}
                  <b>{valorTotal(ganhos)}</b> ganhos em 30 dias
                </>
              ) : (
                ' · valores já contados em Vendas'
              )}
            </>
          ) : (
            <>
              <b>{valorTotal(abertos)}</b> em aberto ·{' '}
              <b>{valorTotal(ganhos)}</b> ganhos em 30 dias
            </>
          )}
        </span>
        <span className="sp" />
        <div className="ctl">
          <Filtro
            nome="Responsável"
            valor={responsavelId}
            onChange={filtrarResponsavel}
            todos="Todos os responsáveis"
            opcoes={dados.pessoas
              .filter(
                (p) => p.papel === 'gestor' || p.setorIds.includes(f.setorId),
              )
              .map((p) => [p.id, p.nome])}
          />
          <button
            className={`pill ${somenteAtrasados ? 'on' : ''}`}
            type="button"
            aria-pressed={somenteAtrasados}
            onClick={() => setSomenteAtrasados(!somenteAtrasados)}
          >
            <Clock size={14} /> Retorno atrasado
          </button>
          {dados.gestor && numeros.length > 0 && (
            <Filtro
              nome="Número da empresa"
              valor={numeroId}
              onChange={filtrarNumero}
              todos="Todos os números"
              opcoes={numeros.map((n) => [n.id, n.nome])}
            />
          )}
        </div>
      </div>
      <div className="page-body" aria-busy={salvando}>
        <div className="stagepills">
          {colunas.map(({ etapa, itens, total }) => (
            <button
              key={etapa.id}
              className={atual === etapa.id ? 'on' : ''}
              type="button"
              aria-pressed={atual === etapa.id}
              onClick={() => setEtapaSelecionada(etapa.id)}
            >
              <span className="t" style={corDaMarca('--c', etapa.cor)}>
                <span className="dot" />
                {etapa.nome} <span className="muted">{itens.length}</span>
              </span>
              <span className="v">{total}</span>
            </button>
          ))}
        </div>
        <div className="board">
          {colunas.map(({ etapa, itens, total }) => (
            <section
              key={etapa.id}
              className={`colm${etapa.id === atual ? ' cur' : ''}${etapa.fechamento ? ' closing' : ''}${sobre === etapa.id ? ' over' : ''}`}
              style={corDaMarca('--c', etapa.cor)}
              aria-label={etapa.nome}
              onDragOver={(e) => {
                if (arrastado.current) {
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'move'
                  setSobre(etapa.id)
                }
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null))
                  setSobre('')
              }}
              onDrop={(e) => {
                e.preventDefault()
                setSobre('')
                const cartao = cartoes.find((c) => c.id === arrastado.current)
                if (cartao) void mover(cartao, etapa)
                arrastado.current = ''
              }}
            >
              <div className="colh">
                <div className="t">
                  <span className="dot" />
                  {etapa.nome}
                  {etapa.fechamento && (
                    <span
                      className={`closetag ${etapa.fechamento === 'sucesso' ? 'win' : 'loss'}`}
                    >
                      {etapa.fechamento === 'sucesso' ? (
                        <Check size={11} />
                      ) : (
                        <X size={11} />
                      )}{' '}
                      {etapa.fechamento}
                    </span>
                  )}
                  <span className="n">{itens.length}</span>
                </div>
                <div className="tot">{total}</div>
                {etapa.fechamento && (
                  <div className="colsub">últimos 30 dias</div>
                )}
                <div className="bar" />
              </div>
              <div className="cards">
                {itens.map((c) => (
                  <Cartao
                    key={c.id}
                    item={c}
                    etapas={etapas}
                    mover={mover}
                    arrastar={(id) => {
                      arrastado.current = id
                      if (!id) setSobre('')
                    }}
                    agora={agora}
                    ocupado={salvando}
                  />
                ))}
                {!itens.length && (
                  <p className="muted empty-column">
                    Nenhum negócio nesta etapa
                  </p>
                )}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}

function FunilSelecionado({
  usuarioId,
  funilId,
}: {
  usuarioId: string
  funilId?: string
}) {
  const [responsavelId, setResponsavelId] = useState('')
  const [numeroId, setNumeroId] = useState('')
  const consulta = useQuery(
    quadroQuery(usuarioId, {
      funilId,
      responsavelId: responsavelId || undefined,
      numeroId: numeroId || undefined,
    }),
  )
  if (consulta.isError)
    return (
      <div className="empty-list" role="alert">
        <p>Não foi possível carregar</p>
        <Acao onClick={() => void consulta.refetch()}>Tentar de novo</Acao>
      </div>
    )
  if (!consulta.data)
    return <Skeleton aria-label="Carregando funil" className="m-5 h-28" />
  return (
    <Quadro
      dados={consulta.data}
      responsavelId={responsavelId}
      numeroId={numeroId}
      filtrarResponsavel={setResponsavelId}
      filtrarNumero={setNumeroId}
    />
  )
}

export function Funil() {
  const { session } = rota.useRouteContext()
  const { funil } = rota.useSearch()
  return (
    <FunilSelecionado key={funil} usuarioId={session.user.id} funilId={funil} />
  )
}
