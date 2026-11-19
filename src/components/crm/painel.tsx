import { useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import {
  BriefcaseBusiness,
  Check,
  ChevronDown,
  ChevronRight,
  History,
  Pencil,
  Plus,
  Trash2,
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
import { Input } from '#/components/ui/input'
import { executarComandoFn } from '#/lib/carteira-comandos'
import type { ComandoCarteira } from '#/lib/carteira-escrita'
import type {
  PainelCarteira,
  ResumoNegocio,
} from '#/lib/carteira-leitura-tipos'
import { invalidarCarteira } from '#/lib/carteira-queries'
import {
  nomeDoContato,
  nomeSemTelefone,
  telefoneParaExibir,
} from '#/lib/telefone'
import { AbrirNegocio } from './abrir-negocio'
import { corDaMarca, valorEmReais } from './carteira-pecas'
import { NotasContato } from './notas-contato'
import { PainelEtiquetas } from './painel-etiquetas'
import { PainelRetorno } from './painel-retorno'
import { Acao, Avatar, IconeBotao, Janela } from './pecas'

function valor(centavos: number | null) {
  return centavos === null ? '—' : valorEmReais(centavos)
}
function data(ms: number) {
  return new Date(ms).toLocaleDateString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
  })
}
function Marcas({ negocio: n }: { negocio: ResumoNegocio }) {
  const resultado =
    n.fechamento === 'sucesso'
      ? 'Ganho'
      : n.fechamento === 'perda'
        ? 'Perdido'
        : null
  return (
    <>
      <span className="pipemark" style={corDaMarca('--pc', n.funilCor)}>
        {n.funilNome}
      </span>
      <span className="stage" style={corDaMarca('--c', n.etapaCor)}>
        <span className="dot" />
        {n.etapaNome}
        {resultado && resultado !== n.etapaNome && ` · ${resultado}`}
      </span>
    </>
  )
}
type Executar = (comando: ComandoCarteira) => Promise<boolean>

function Editar({
  dados,
  fechar,
  executar,
  ocupado,
  erro,
  duplicado,
}: {
  dados: PainelCarteira
  fechar: () => void
  executar: Executar
  ocupado: boolean
  erro: string
  duplicado: string | null
}) {
  const c = dados.contato,
    n = dados.principal
  const nomeOriginal = nomeSemTelefone(c.nome, c.telefone)
  const telefoneOriginal = telefoneParaExibir(c) ?? ''
  const [nome, setNome] = useState(nomeOriginal ?? ''),
    [empresa, setEmpresa] = useState(c.empresa ?? ''),
    [telefone, setTelefone] = useState(telefoneOriginal)
  const [montante, setMontante] = useState(
    n?.valorCentavos != null
      ? (n.valorCentavos / 100).toLocaleString('pt-BR', { useGrouping: false })
      : '',
  )
  const [erroValor, setErroValor] = useState('')
  const podeEditarValor = Boolean(n && !n.origem && n.fechadoEm === null)
  async function salvar() {
    const texto = montante.trim()
    const monetario = /^(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d{1,2})?$/
    if (podeEditarValor && texto && !monetario.test(texto)) {
      setErroValor('Informe o valor em reais, com até duas casas decimais.')
      return
    }
    const centavos = texto
      ? Math.round(Number(texto.replaceAll('.', '').replace(',', '.')) * 100)
      : null
    if (
      await executar({
        tipo: 'editarContato',
        contatoId: c.id,
        nome:
          nomeSemTelefone(nome.trim(), telefone) ?? telefone.replace(/\D/g, ''),
        empresa,
        telefone:
          telefone === telefoneOriginal && c.telefone ? c.telefone : telefone,
        negocio:
          podeEditarValor && n
            ? { id: n.id, valorCentavos: centavos }
            : undefined,
      })
    )
      fechar()
  }
  return (
    <Janela
      pequena
      titulo="Editar contato"
      onClose={() => {
        if (!ocupado) fechar()
      }}
      rodape={
        <Acao
          tipo="primary"
          type="submit"
          form="editar-contato"
          disabled={ocupado}
        >
          Salvar
        </Acao>
      }
    >
      <form
        id="editar-contato"
        className="formgrid"
        onSubmit={(e) => {
          e.preventDefault()
          void salvar()
        }}
      >
        <label htmlFor="editar-nome">
          Nome
          <Input
            id="editar-nome"
            required={!!nomeOriginal}
            maxLength={150}
            value={nome}
            onChange={(e) => setNome(e.target.value)}
          />
        </label>
        <label htmlFor="editar-empresa">
          Empresa
          <Input
            id="editar-empresa"
            maxLength={180}
            value={empresa}
            onChange={(e) => setEmpresa(e.target.value)}
          />
        </label>
        <label htmlFor="editar-telefone">
          Telefone
          <Input
            id="editar-telefone"
            type="tel"
            required
            maxLength={32}
            value={telefone}
            onChange={(e) => setTelefone(e.target.value)}
          />
        </label>
        {podeEditarValor && (
          <label htmlFor="editar-valor">
            Valor do negócio (R$)
            <Input
              id="editar-valor"
              inputMode="decimal"
              maxLength={18}
              value={montante}
              onChange={(e) => {
                setErroValor('')
                setMontante(e.target.value)
              }}
            />
          </label>
        )}
        {(erroValor || erro) && <p role="alert">{erroValor || erro}</p>}
        {duplicado && (
          <Link
            to="/app/conversas"
            search={{ contato: duplicado, painel: true }}
          >
            Abrir contato existente
          </Link>
        )}
      </form>
    </Janela>
  )
}

export function Painel({
  dados,
  usuarioId,
  conversaId,
  fechar,
  selecionarFunil,
}: {
  dados: PainelCarteira
  usuarioId: string
  conversaId?: string
  fechar: () => void
  selecionarFunil: (id: string) => void
}) {
  const navegar = useNavigate(),
    cache = useQueryClient()
  const [dialogo, setDialogo] = useState<'editar' | 'apagar' | 'abrir' | null>(
      null,
    ),
    [historico, setHistorico] = useState(false)
  const [ocupado, setOcupado] = useState(false),
    [erro, setErro] = useState(''),
    [duplicado, setDuplicado] = useState<string | null>(null)
  const emCurso = useRef(false),
    pedidos = useRef(new Map<string, string>()),
    outros = useRef<HTMLDivElement>(null)
  const c = dados.contato,
    n = dados.principal
  const nome = nomeDoContato(c)
  const conversa = dados.conversas.find(
    (v) => v.id === (conversaId ?? dados.conversaAtivaId),
  )
  const numero = dados.numeros.find((item) => item.id === conversa?.numeroId)
  const etapas = dados.etapas.filter((e) => e.funilId === n?.funilId)
  const setorId = dados.funis.find((f) => f.id === n?.funilId)?.setorId
  const idx = etapas.findIndex((e) => e.id === n?.etapaId)
  const responsavel = dados.pessoas.find((p) => p.id === n?.responsavelId)
  async function executar(comando: ComandoCarteira) {
    if (emCurso.current) return false
    emCurso.current = true
    setOcupado(true)
    setErro('')
    setDuplicado(null)
    try {
      const resposta = await executarComandoFn({ data: comando })
      if (!resposta.ok) {
        setErro(resposta.mensagem)
        setDuplicado(resposta.existenteId ?? null)
        return false
      }
      if (comando.tipo === 'apagarContato')
        await navegar({ to: '/app/contatos' })
      await invalidarCarteira(cache)
      const pos = resposta.posVenda
      if (pos)
        toast(`Negócio criado no Pós-venda · ${pos.etapa}`, {
          duration: 10000,
          action: {
            label: 'Ver',
            onClick: () => {
              if (pos.podeAbrir)
                void navegar({
                  to: '/app/funil',
                  search: { funil: pos.funilId },
                })
              else outros.current?.scrollIntoView({ block: 'center' })
            },
          },
        })
      return true
    } catch {
      setErro('Não foi possível confirmar a alteração. Tente de novo.')
      return false
    } finally {
      emCurso.current = false
      setOcupado(false)
    }
  }
  const semNegocioAberto = (!n || n.fechadoEm !== null) && !dados.outros.length
  async function abrir(funilId: string, responsavelId?: string) {
    let id = pedidos.current.get(funilId)
    if (!id) {
      id = crypto.randomUUID()
      pedidos.current.set(funilId, id)
    }
    if (
      await executar({
        tipo: 'abrirNegocio',
        id,
        contatoId: c.id,
        funilId,
        responsavelId,
      })
    ) {
      setDialogo(null)
      pedidos.current.delete(funilId)
      selecionarFunil(funilId)
    }
  }
  function modal(tipo: typeof dialogo) {
    setErro('')
    setDuplicado(null)
    setDialogo(tipo)
  }
  const totalConversas = dados.conversas.length
  return (
    <aside className="panel" aria-label="Painel do contato">
      <div className="panel-head">
        <IconeBotao nome="Fechar painel" onClick={fechar}>
          <X size={20} />
        </IconeBotao>
        <h2>Dados do contato</h2>
        <Acao tipo="quiet" className="btn-sm" onClick={() => modal('editar')}>
          <Pencil size={14} />
          Editar
        </Acao>
      </div>
      <div className="panel-body">
        <div className="pbloc ident">
          <Avatar nome={nome} contatoId={c.id} tamanho={88} />
          <h3>{nome}</h3>
          <div className="co">{c.empresa}</div>
          <div className="ph">{telefoneParaExibir(c)}</div>
          {numero && (
            <div className="acts">
              <span
                className="nummark"
                style={{ '--nc': numero.cor } as import('react').CSSProperties}
              >
                {numero.nome}
              </span>
              {numero.telefone && (
                <span className="muted">· conversa pelo {numero.telefone}</span>
              )}
            </div>
          )}
        </div>
        {n ? (
          <div
            className="pbloc dealbloc"
            style={corDaMarca('--pc', n.funilCor)}
          >
            <div className="plabel">
              Negócio neste setor{' '}
              <span className="pipemark">{n.funilNome}</span>
            </div>
            {n.origem ? (
              <div className="origin">
                <BriefcaseBusiness size={16} />
                <div>
                  <b>
                    Venda ganha{' '}
                    {n.origem.fechadoEm && `em ${data(n.origem.fechadoEm)}`} ·{' '}
                    {n.origem.responsavelNome ?? 'Sem responsável'}
                  </b>
                  <span>
                    Valor da venda {valor(n.origem.valorCentavos)} · já contado
                    em Vendas
                  </span>
                </div>
              </div>
            ) : (
              <>
                <div className="bigval">{valor(n.valorCentavos)}</div>
                <div className="valsub">Aberto em {data(n.criadoEm)}</div>
              </>
            )}
            <div className="trail-now">
              <span className="stage" style={corDaMarca('--c', n.etapaCor)}>
                <span className="dot" />
                {n.etapaNome}
              </span>
              <span className="muted">
                passo {idx + 1} de {etapas.length}
              </span>
            </div>
            <div
              className="trail"
              aria-hidden="true"
              style={{
                ...corDaMarca('--c', n.etapaCor),
                gridTemplateColumns: `repeat(${etapas.length},1fr)`,
              }}
            >
              {etapas.map((e, i) => (
                <span key={e.id} className={i <= idx ? 'done' : ''} />
              ))}
            </div>
            <div className="trail-labels">
              {etapas.map((e) => (
                <button
                  type="button"
                  key={e.id}
                  className={e.id === n.etapaId ? 'cur' : ''}
                  style={corDaMarca('--c', e.cor)}
                  aria-label={`Mover para ${e.nome}`}
                  disabled={
                    ocupado || n.fechadoEm !== null || e.id === n.etapaId
                  }
                  onClick={() =>
                    void executar({
                      tipo: 'moverNegocio',
                      negocioId: n.id,
                      etapaId: e.id,
                    })
                  }
                >
                  <span className="dot" />
                  {e.nome}
                  {e.fechamento && (
                    <span className="ck">
                      {e.fechamento === 'sucesso' ? (
                        <Check size={11} />
                      ) : (
                        <X size={11} />
                      )}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="pbloc nodeal">
            <div className="plabel">Negócio neste setor</div>
            <p>Nenhum negócio aberto neste funil.</p>
          </div>
        )}
        <div className="pbloc" ref={outros}>
          <div className="plabel">
            Outros negócios abertos
            {!semNegocioAberto && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button type="button" className="lk" disabled={ocupado}>
                    <Plus size={13} />
                    Novo negócio
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuLabel>Novo negócio em…</DropdownMenuLabel>
                  {dados.funis.map((f) => (
                    <DropdownMenuItem
                      key={f.id}
                      onSelect={() => void abrir(f.id)}
                    >
                      {f.nome}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
          {dados.outros.length ? (
            dados.outros.map((o) => (
              <div className="orow" key={o.chave}>
                <Marcas negocio={o} />
                <span className="muted">{o.responsavelNome}</span>
              </div>
            ))
          ) : (
            <span className="muted">Nenhum em outro setor.</span>
          )}
          {erro && !dialogo && <p role="alert">{erro}</p>}
        </div>
        <div className="pbloc">
          <button
            type="button"
            className="histhead"
            aria-expanded={historico}
            onClick={() => setHistorico(!historico)}
          >
            <History size={17} />
            <span>
              <b>Histórico de negócios</b>
              <span>
                {dados.historico.length}{' '}
                {dados.historico.length === 1
                  ? 'negócio fechado'
                  : 'negócios fechados'}
              </span>
            </span>
            {historico ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
          </button>
          {historico && (
            <ol className="hist">
              {dados.historico.map((item) => (
                <li key={item.chave}>
                  <div className="hl1">
                    <Marcas negocio={item} />
                    <span className="hv money">
                      {valor(item.valorCentavos)}
                    </span>
                  </div>
                  <span className="hl2">
                    {item.fechadoEm && data(item.fechadoEm)} ·{' '}
                    {item.responsavelNome ?? 'Sem responsável'}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
        <PainelEtiquetas dados={dados} key={c.id} />
        <div className="pbloc">
          <div className="plabel">Responsável neste setor</div>
          <div className="kv">
            {n?.responsavelNome && (
              <Avatar nome={n.responsavelNome} tamanho={36} />
            )}
            <div>
              <b>{n?.responsavelNome ?? 'Sem responsável'}</b>
              {responsavel && (
                <span>
                  {responsavel.papel === 'gestor' ? 'Gestor' : 'Vendedor'}
                </span>
              )}
            </div>
            {semNegocioAberto && (
              <Acao
                className="btn-sm"
                disabled={ocupado || !dados.funis.length}
                onClick={() => modal('abrir')}
              >
                <Plus size={13} /> Novo negócio
              </Acao>
            )}
            {n && n.fechadoEm === null && dados.gestor && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Acao className="btn-sm" disabled={ocupado}>
                    Trocar
                  </Acao>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {dados.pessoas
                    .filter(
                      (p) =>
                        p.papel === 'gestor' ||
                        (setorId && p.setorIds.includes(setorId)),
                    )
                    .map((p) => (
                      <DropdownMenuItem
                        key={p.id}
                        onSelect={() =>
                          void executar({
                            tipo: 'trocarResponsavel',
                            negocioId: n.id,
                            responsavelId: p.id,
                          })
                        }
                      >
                        {p.nome}
                      </DropdownMenuItem>
                    ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>
        <PainelRetorno
          key={conversa?.id ?? c.id}
          contatoId={c.id}
          numeroId={conversa?.numeroId ?? n?.numeroId ?? undefined}
          numeros={dados.numeros}
          retorno={dados.retorno}
        />
        <NotasContato contatoId={c.id} notas={dados.notas} />
        {dados.gestor && (
          <div className="pbloc">
            <Acao onClick={() => modal('apagar')}>
              <Trash2 size={15} />
              Apagar contato
            </Acao>
          </div>
        )}
      </div>
      {dialogo === 'abrir' && (
        <AbrirNegocio
          dados={dados}
          usuarioId={usuarioId}
          funilInicial={n?.funilId ?? numero?.funilPadraoId}
          abrir={abrir}
          fechar={() => modal(null)}
          ocupado={ocupado}
          erro={erro}
        />
      )}
      {dialogo === 'editar' && (
        <Editar
          dados={dados}
          fechar={() => modal(null)}
          executar={executar}
          ocupado={ocupado}
          erro={erro}
          duplicado={duplicado}
        />
      )}
      {dialogo === 'apagar' && (
        <Janela
          pequena
          titulo="Apagar contato?"
          onClose={() => {
            if (!ocupado) modal(null)
          }}
          rodape={
            <Acao
              tipo="warn"
              disabled={ocupado}
              onClick={() =>
                void executar({
                  tipo: 'apagarContato',
                  contatoId: c.id,
                  conversas: totalConversas,
                  negocios: dados.totalNegocios,
                })
              }
            >
              Apagar contato
            </Acao>
          }
        >
          <p>
            Apagar {nome} também remove {totalConversas}{' '}
            {totalConversas === 1 ? 'conversa' : 'conversas'} e{' '}
            {dados.totalNegocios}{' '}
            {dados.totalNegocios === 1 ? 'negócio' : 'negócios'}, incluindo
            mensagens, arquivos, notas e retornos.
          </p>
          {erro && <p role="alert">{erro}</p>}
        </Janela>
      )}
    </aside>
  )
}
