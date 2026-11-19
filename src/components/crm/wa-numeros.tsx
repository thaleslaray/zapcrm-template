import {
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from '@tanstack/react-query'
import { getRouteApi } from '@tanstack/react-router'
import { LockKeyhole, Plus, RefreshCw, Smartphone } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { EmptyState } from '#/components/app/empty-state'
import { Input } from '#/components/ui/input'
import {
  adicionarNumerosFn,
  criarNumeroFn,
  desconectarNumeroFn,
  type painelNumerosFn,
  sincronizarConversasFn,
} from '#/lib/wa-numeros-fns'
import type { Destino } from '#/lib/wa-numeros-gestao'
import {
  catalogoNumerosQuery,
  invalidarNumeros,
  painelNumerosQuery,
} from '#/lib/wa-numeros-queries'
import { Conectar, Dias } from './conectar'
import { Acao, Janela } from './pecas'
import { ServidorUazapi } from './servidor-uazapi'

type Painel = Awaited<ReturnType<typeof painelNumerosFn>>
export type NumeroPainel = Painel['numeros'][number]
const rota = getRouteApi('/_app/app/configuracoes')
const rotulos = {
  conectado: 'Conectado',
  conectando: 'Conectando',
  desconectado: 'Desconectado',
}
const classes = { conectado: 'ok', conectando: 'wait', desconectado: 'down' }

function CamposDestino({
  painel,
  valor,
  mudar,
  nome,
}: {
  painel: Painel
  valor: Destino
  mudar: (v: Destino) => void
  nome?: string
}) {
  const sufixo = nome ? ` de ${nome}` : ''
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="grid gap-1">
        Setor
        <select
          className="select"
          aria-label={`Setor${sufixo}`}
          value={valor.setorId}
          onChange={(e) => {
            const setorId = e.target.value
            mudar({
              setorId,
              funilId:
                painel.funis.find((f) => f.setorId === setorId)?.id ?? '',
            })
          }}
        >
          {painel.setores.map((s) => (
            <option key={s.id} value={s.id}>
              {s.nome}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1">
        Funil padrão
        <select
          className="select"
          aria-label={`Funil padrão${sufixo}`}
          value={valor.funilId}
          onChange={(e) => mudar({ ...valor, funilId: e.target.value })}
        >
          {painel.funis
            .filter((f) => f.setorId === valor.setorId)
            .map((f) => (
              <option key={f.id} value={f.id}>
                {f.nome}
              </option>
            ))}
        </select>
      </label>
    </div>
  )
}
function Catalogo({
  painel,
  usuario,
  fechar,
  parear,
}: {
  painel: Painel
  usuario: string
  fechar: () => void
  parear: (n: NumeroPainel) => void
}) {
  const cache = useQueryClient()
  const consulta = useQuery(catalogoNumerosQuery(usuario))
  const [modo, setModo] = useState<'lista' | 'novo'>('lista')
  const [nome, setNome] = useState('')
  const [dias, setDias] = useState(90)
  const [selecoes, setSelecoes] = useState<Record<string, Destino>>({})
  const setorId = painel.setores[0]?.id ?? ''
  const padrao = {
    setorId,
    funilId: painel.funis.find((f) => f.setorId === setorId)?.id ?? '',
  }
  const [destino, setDestino] = useState(padrao)
  const [operacao] = useState(() => crypto.randomUUID())
  const [erro, setErro] = useState('')
  const ocupado = useRef(false)
  const [salvando, setSalvando] = useState(false)
  async function salvar() {
    if (ocupado.current) return
    ocupado.current = true
    setSalvando(true)
    setErro('')
    try {
      if (modo === 'novo') {
        const resultado = await criarNumeroFn({
          data: { id: operacao, nome, dias, ...destino },
        })
        if (!resultado.ok) {
          setErro(resultado.mensagem)
          return
        }
        await invalidarNumeros(cache)
        fechar()
        parear({
          id: resultado.valor,
          nome,
          setorId: destino.setorId,
          funilPadraoId: destino.funilId,
          diasHistorico: dias,
          estado: 'desconectado',
          telefone: null,
          precisaVincular: false,
          sincronizando: false,
        })
      } else {
        // Cada vínculo pode importar uma página com mídia e tem seu próprio
        // orçamento de consultas e subpedidos do Worker.
        for (const [instanciaId, d] of Object.entries(selecoes)) {
          await adicionarNumerosFn({ data: [{ instanciaId, ...d }] })
        }
        await invalidarNumeros(cache)
        fechar()
      }
    } catch {
      setErro(
        'Não foi possível confirmar a gravação. Seus dados continuam aqui. Tente de novo.',
      )
    } finally {
      ocupado.current = false
      setSalvando(false)
    }
  }
  return (
    <Janela
      titulo={modo === 'novo' ? 'Criar número novo' : 'Conectar número'}
      onClose={() => {
        if (!ocupado.current) fechar()
      }}
      rodape={
        <Acao
          tipo="primary"
          disabled={
            salvando ||
            (modo === 'novo'
              ? !nome.trim() ||
                !destino.funilId ||
                !Number.isInteger(dias) ||
                dias < 1 ||
                dias > 365
              : !Object.keys(selecoes).length)
          }
          onClick={salvar}
        >
          {salvando
            ? 'Salvando…'
            : modo === 'novo'
              ? 'Criar e conectar'
              : 'Adicionar selecionados'}
        </Acao>
      }
    >
      {modo === 'novo' ? (
        <div className="grid gap-4">
          <label htmlFor="nome-novo-numero" className="grid gap-1">
            Nome do número
            <Input
              id="nome-novo-numero"
              value={nome}
              maxLength={100}
              onChange={(e) => setNome(e.target.value)}
            />
          </label>
          <CamposDestino painel={painel} valor={destino} mudar={setDestino} />
          <Dias valor={dias} mudar={setDias} />
          <Acao
            className="justify-self-start"
            disabled={salvando}
            onClick={() => setModo('lista')}
          >
            Voltar à lista
          </Acao>
        </div>
      ) : (
        <div className="grid gap-4">
          <Acao
            tipo="ghost"
            className="justify-self-start"
            disabled={salvando}
            onClick={() => setModo('novo')}
          >
            Criar número novo
          </Acao>
          {consulta.isPending && <p role="status">Buscando números…</p>}
          {consulta.isError && (
            <div role="alert">
              Não foi possível carregar.{' '}
              <Acao onClick={() => consulta.refetch()}>Tentar de novo</Acao>
            </div>
          )}
          {consulta.data?.length === 0 && <p>Nenhuma instância disponível.</p>}
          {consulta.data?.map((i) => (
            <section className="card grid gap-3 p-4" key={i.id}>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  aria-label={i.nome}
                  checked={i.adicionada || !!selecoes[i.id]}
                  disabled={i.adicionada || salvando}
                  onChange={(e) => {
                    const marcado = e.target.checked
                    setSelecoes((atuais) => {
                      const proximas = { ...atuais }
                      if (marcado) proximas[i.id] = padrao
                      else delete proximas[i.id]
                      return proximas
                    })
                  }}
                />
                <strong>{i.nome}</strong>{' '}
                {i.adicionada && <span>Já adicionado</span>}
              </label>
              <span className="muted">
                {[i.telefone, rotulos[i.estado]].filter(Boolean).join(' · ')}
              </span>
              {selecoes[i.id] && (
                <CamposDestino
                  nome={i.nome}
                  painel={painel}
                  valor={selecoes[i.id]}
                  mudar={(d) => setSelecoes((s) => ({ ...s, [i.id]: d }))}
                />
              )}
            </section>
          ))}
        </div>
      )}
      {erro && (
        <p role="alert" className="mt-3">
          {erro}
        </p>
      )}
    </Janela>
  )
}
export function AcaoConectarNumero({ abrir }: { abrir: () => void }) {
  const { session } = rota.useRouteContext()
  const { data: painel } = useSuspenseQuery(painelNumerosQuery(session.user.id))
  if (!painel.servidor.configurado) return null
  return (
    <Acao tipo="primary" onClick={abrir}>
      <Plus size={17} /> Conectar número
    </Acao>
  )
}

export function Numeros({
  abrirCatalogo,
  pedirCatalogo,
  fecharCatalogo,
}: {
  abrirCatalogo: boolean
  pedirCatalogo: () => void
  fecharCatalogo: () => void
}) {
  const { session } = rota.useRouteContext()
  const { data: painel } = useSuspenseQuery(painelNumerosQuery(session.user.id))
  const busca = rota.useSearch()
  const [pareamento, setPareamento] = useState<{
    numero: NumeroPainel
    automatico: boolean
  } | null>(() => {
    const numero = painel.numeros.find((n) => n.id === busca.numero)
    return numero ? { numero, automatico: false } : null
  })
  const cache = useQueryClient()
  const [ocupado, setOcupado] = useState('')
  const [erro, setErro] = useState('')
  const [progresso, setProgresso] = useState({ id: '', texto: '' })
  const ativo = useRef(true)
  const sincronizando = useRef(false)
  useEffect(() => {
    ativo.current = true
    return () => {
      ativo.current = false
    }
  }, [])
  async function sincronizar(n: NumeroPainel) {
    if (ocupado || sincronizando.current) return
    sincronizando.current = true
    setOcupado(n.id)
    setErro('')
    setProgresso({ id: n.id, texto: 'Sincronizando conversas…' })
    try {
      while (ativo.current) {
        const r = await sincronizarConversasFn({ data: n.id })
        const contagem = `${r.chats} ${r.chats === 1 ? 'conversa sincronizada' : 'conversas sincronizadas'} · ${r.mensagens} ${r.mensagens === 1 ? 'mensagem nova' : 'mensagens novas'}.`
        setProgresso({
          id: n.id,
          texto: `${r.pendente ? 'Sincronizando.' : 'Sincronização concluída.'} ${contagem}`,
        })
        if (!r.pendente) break
        // O limite por pessoa permite 60 escritas por minuto. Cada continuação
        // recebe uma nova invocação, inclusive ao voltar para o cartão.
        await new Promise((resolve) => setTimeout(resolve, 1200))
      }
      await invalidarNumeros(cache)
    } catch {
      setProgresso({
        id: n.id,
        texto:
          'A sincronização foi interrompida. Clique em Sincronizar conversas para retomar.',
      })
    } finally {
      sincronizando.current = false
      setOcupado('')
    }
  }
  async function desconectar(n: NumeroPainel) {
    if (ocupado) return
    setOcupado(n.id)
    setErro('')
    try {
      await desconectarNumeroFn({ data: n.id })
      await invalidarNumeros(cache)
    } catch {
      setErro('Não foi possível confirmar a desconexão. Tente de novo.')
    } finally {
      setOcupado('')
    }
  }
  const servidor = <ServidorUazapi servidor={painel.servidor} />
  if (!painel.servidor.configurado) {
    return (
      <>
        <div className="mb-4">
          <EmptyState
            icon={Smartphone}
            title="Configure o servidor para conectar números"
            action={
              <Acao
                onClick={() =>
                  document.getElementById('endereco-servidor-uazapi')?.focus()
                }
              >
                Configurar servidor
              </Acao>
            }
          />
        </div>
        {servidor}
      </>
    )
  }
  return (
    <>
      {servidor}
      {painel.numeros.length === 0 && (
        <EmptyState
          icon={Smartphone}
          title="Nenhum número conectado"
          description="Escolha uma instância que já existe no servidor ou crie uma nova e leia o QR Code."
          action={
            <Acao tipo="primary" onClick={pedirCatalogo}>
              <Plus size={17} /> Conectar o primeiro número
            </Acao>
          }
        />
      )}
      {painel.numeros.map((n) => (
        <article
          className={`card numcard n-${n.setorId === 'pos' ? 'pos' : 'com'}`}
          key={n.id}
        >
          <span className="ni">
            <Smartphone size={24} />
          </span>
          <div>
            <h3>
              {n.nome}{' '}
              <span className={`status ${classes[n.estado]}`}>
                <span className="dot" />
                {rotulos[n.estado]}
              </span>
            </h3>
            <div className="ph">{n.telefone}</div>
            {n.sincronizando && (
              <div className="st" role="status">
                Sincronizando histórico
              </div>
            )}
            {progresso.id === n.id && (
              <p className="st" role="status">
                {progresso.texto}
              </p>
            )}
            <div className="numroute">
              <span className="kvl">Setor</span>
              <b>{painel.setores.find((s) => s.id === n.setorId)?.nome}</b>
              <span className="kvl">Funil padrão</span>
              <b>{painel.funis.find((f) => f.id === n.funilPadraoId)?.nome}</b>
            </div>
          </div>
          <div className="acts">
            {n.estado === 'conectado' ? (
              <>
                <Acao disabled={!!ocupado} onClick={() => sincronizar(n)}>
                  <RefreshCw size={16} /> Sincronizar conversas
                </Acao>
                <Acao disabled={!!ocupado} onClick={() => desconectar(n)}>
                  Desconectar
                </Acao>
              </>
            ) : (
              <Acao
                tipo="primary"
                onClick={() => setPareamento({ numero: n, automatico: false })}
              >
                <RefreshCw size={16} />
                Reconectar
              </Acao>
            )}
          </div>
        </article>
      ))}
      {erro && <p role="alert">{erro}</p>}
      <p className="connection-note">
        <LockKeyhole size={13} />A conexão usa a uazapi. O celular do número
        precisa ficar com internet.
      </p>
      {abrirCatalogo && (
        <Catalogo
          painel={painel}
          usuario={session.user.id}
          fechar={fecharCatalogo}
          parear={(numero) => setPareamento({ numero, automatico: true })}
        />
      )}
      {pareamento && (
        <Conectar
          key={pareamento.numero.id}
          numero={
            painel.numeros.find((n) => n.id === pareamento.numero.id) ??
            pareamento.numero
          }
          automatico={pareamento.automatico}
          usuario={session.user.id}
          fechar={() => setPareamento(null)}
        />
      )}
    </>
  )
}
