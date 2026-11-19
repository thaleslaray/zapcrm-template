import { useSuspenseQuery } from '@tanstack/react-query'
import {
  ArrowRight,
  Check,
  GripVertical,
  Layers,
  Pencil,
  Plus,
  Smartphone,
  X,
} from 'lucide-react'
import { type CSSProperties, useState } from 'react'
import { estruturaQuery } from '#/lib/empresa-queries'
import type { Estrutura } from '#/lib/estrutura'
import { corDaMarca } from './carteira-pecas'
import {
  type EdicaoEstrutura,
  EditarEstrutura,
} from './config-estrutura-formularios'
import { rotaEmpresa, type SecaoEditavel } from './config-formulario'
import { Acao, Avatar, IconeBotao } from './pecas'

function Numero({ numero }: { numero: Estrutura['numeros'][number] }) {
  return (
    <>
      <span className="nummark" style={{ '--nc': numero.cor } as CSSProperties}>
        {numero.nome}
      </span>{' '}
      <span className="muted tnum">{numero.telefone}</span>
    </>
  )
}

export function Setores({ criando, fechar }: SecaoEditavel) {
  const { session } = rotaEmpresa.useRouteContext()
  const { data } = useSuspenseQuery(estruturaQuery(session.user.id))
  const [edicao, editar] = useState<EdicaoEstrutura | null>(null)
  const alvo: EdicaoEstrutura | null = criando ? { tipo: 'setor' } : edicao
  return (
    <>
      {data.setores.length === 0 && (
        <p className="empty-list">Nenhum setor cadastrado.</p>
      )}
      <div className="sectgrid">
        {data.setores.map((s) => {
          const funis = data.funis.filter((f) => f.setorId === s.id)
          const numeros = data.numeros.filter((n) => n.setorId === s.id)
          const pessoas = data.pessoas.filter(
            (p) => p.papel === 'gestor' || p.setorId === s.id,
          )
          return (
            <article className="card sectcard" key={s.id}>
              <div className="sh">
                <span
                  className="si"
                  style={corDaMarca('--pc', funis[0]?.cor ?? 'var(--brand)')}
                >
                  <Layers size={20} />
                </span>
                <div>
                  <h3>{s.nome}</h3>
                  <span className="muted">
                    {s.abertos}{' '}
                    {s.abertos === 1 ? 'negócio aberto' : 'negócios abertos'}
                  </span>
                </div>
                <IconeBotao
                  nome={`Editar setor ${s.nome}`}
                  onClick={() => editar({ tipo: 'setor', item: s })}
                >
                  <Pencil size={16} />
                </IconeBotao>
              </div>
              <dl>
                <dt>Números</dt>
                <dd>
                  {!numeros.length && 'Nenhum número conectado.'}
                  {numeros.map((n) => (
                    <div key={n.id}>
                      <Numero numero={n} />{' '}
                      {n.estado === 'desconectado' && (
                        <span className="status down">
                          <span className="dot" />
                          Desconectado
                        </span>
                      )}
                    </div>
                  ))}
                </dd>
                <dt>Funil</dt>
                <dd>
                  {!funis.length && 'Nenhum funil cadastrado.'}
                  {funis.map((f) => {
                    const etapas = data.etapas.filter(
                      (e) => e.funilId === f.id,
                    ).length
                    return (
                      <div key={f.id}>
                        <a
                          href={`/app/configuracoes?secao=funis&funil=${encodeURIComponent(f.id)}`}
                        >
                          <span
                            className="pipemark"
                            style={corDaMarca('--pc', f.cor)}
                          >
                            {f.nome}
                          </span>
                        </a>{' '}
                        <span className="muted">
                          {etapas} {etapas === 1 ? 'etapa' : 'etapas'}
                        </span>
                      </div>
                    )
                  })}
                </dd>
                <dt>Pessoas</dt>
                <dd className="pp">
                  {!pessoas.length && 'Nenhuma pessoa vinculada.'}
                  {pessoas.map((p) => (
                    <span
                      className={`person ${p.papel === 'gestor' ? 'muted' : ''}`}
                      key={p.id}
                    >
                      <Avatar nome={p.nome} tamanho={24} />
                      {p.nome}
                      {p.papel === 'gestor' && ' · gestor'}
                    </span>
                  ))}
                </dd>
              </dl>
            </article>
          )
        })}
      </div>
      {alvo && (
        <EditarEstrutura
          edicao={alvo}
          dados={data}
          fechar={() => {
            editar(null)
            fechar()
          }}
        />
      )}
    </>
  )
}

const coresPadrao = [
  ['Cinza-azulado', '#64748b'],
  ['Azul', '#2563eb'],
  ['Âmbar', '#d97706'],
  ['Violeta', '#7c3aed'],
  ['Verde', '#16a34a'],
  ['Vermelho-tijolo', '#b4472a'],
  ['Céu', '#0284c7'],
  ['Ciano', '#0891b2'],
  ['Âmbar-escuro', '#b45309'],
] as const

export function FunisEtapas({
  inicial,
  criando,
  fechar,
}: SecaoEditavel & { inicial?: string }) {
  const { session } = rotaEmpresa.useRouteContext()
  const { data } = useSuspenseQuery(estruturaQuery(session.user.id))
  const [id, selecionar] = useState(inicial)
  const [edicao, editar] = useState<EdicaoEstrutura | null>(null)
  const alvo: EdicaoEstrutura | null = criando ? { tipo: 'funil' } : edicao
  const funil = data.funis.find((f) => f.id === id) ?? data.funis[0]
  const etapas = data.etapas.filter((e) => e.funilId === funil?.id)
  const numeros = data.numeros.filter((n) => n.funilPadraoId === funil?.id)
  const primeiraAberta = etapas.find((e) => !e.fechamento)
  const posVenda = data.funis.find((f) => f.id === 'pos')
  const inicioPosVenda = data.etapas.find(
    (e) => e.funilId === posVenda?.id && !e.fechamento,
  )
  return (
    <>
      {!funil ? (
        <p className="empty-list">Nenhum funil cadastrado.</p>
      ) : (
        <>
          <div
            className="seg pipeseg cfg-funis-abas"
            role="tablist"
            aria-label="Funis"
          >
            {data.funis.map((f) => (
              <button
                type="button"
                key={f.id}
                role="tab"
                aria-selected={f.id === funil.id}
                className={f.id === funil.id ? 'on' : ''}
                style={corDaMarca('--pc', f.cor)}
                onClick={() => selecionar(f.id)}
              >
                <span className="dot" />
                {f.nome}
              </button>
            ))}
          </div>
          <div className="card">
            <div className="lrow fhead">
              <span className="sub">Entra por</span>
              {numeros.length === 0 && (
                <span className="muted">Nenhum número conectado</span>
              )}
              {numeros.map((n) => (
                <span key={n.id}>
                  <Numero numero={n} />
                </span>
              ))}
              <span className="sub sector-title">
                Setor {data.setores.find((s) => s.id === funil.setorId)?.nome}
              </span>
              {data.numeros.some((n) => n.setorId === funil.setorId) && (
                <IconeBotao
                  nome="Definir número de entrada"
                  onClick={() => editar({ tipo: 'entrada', funil })}
                >
                  <Smartphone size={16} />
                </IconeBotao>
              )}
              <IconeBotao
                nome={`Editar funil ${funil.nome}`}
                onClick={() => editar({ tipo: 'funil', item: funil })}
              >
                <Pencil size={16} />
              </IconeBotao>
            </div>
            {etapas.map((e, i) => (
              <fieldset
                className="lrow"
                aria-label={`Etapa ${e.nome}`}
                key={e.id}
                onDragOver={(ev) => {
                  if (
                    ev.dataTransfer.types.includes('application/x-zapcrm-etapa')
                  )
                    ev.preventDefault()
                }}
                onDrop={(ev) => {
                  ev.preventDefault()
                  const origem = etapas.find(
                    (item) =>
                      item.id ===
                      ev.dataTransfer.getData('application/x-zapcrm-etapa'),
                  )
                  if (origem && origem.id !== e.id)
                    editar({
                      tipo: 'ordem',
                      item: origem,
                      etapas,
                      destino: i + 1,
                    })
                }}
              >
                <button
                  className="grip"
                  type="button"
                  aria-label={`Mover etapa ${e.nome}`}
                  title="Alterar posição"
                  draggable
                  onDragStart={(ev) => {
                    ev.dataTransfer.setData('application/x-zapcrm-etapa', e.id)
                    ev.dataTransfer.effectAllowed = 'move'
                  }}
                  onClick={() => editar({ tipo: 'ordem', item: e, etapas })}
                >
                  <GripVertical size={18} />
                </button>
                <span className="dot" style={corDaMarca('--c', e.cor)} />
                <div className="nm">
                  {e.nome}
                  <div className="sub">
                    {e.id === primeiraAberta?.id &&
                      'Primeira etapa aberta · conversa nova entra aqui · '}
                    {e.negocios} {e.negocios === 1 ? 'negócio' : 'negócios'}
                  </div>
                </div>
                <span
                  className={`closemark ${e.fechamento === 'sucesso' ? 'win' : e.fechamento === 'perda' ? 'loss' : ''}`}
                >
                  {e.fechamento ? (
                    <>
                      {e.fechamento === 'sucesso' ? (
                        <Check size={13} />
                      ) : (
                        <X size={13} />
                      )}
                      <span className="fx">Fechamento · </span>
                      {e.fechamento}
                    </>
                  ) : (
                    <span className="muted">Etapa aberta</span>
                  )}
                </span>
                <div className="swatches">
                  {coresPadrao.map(([nome, cor]) => (
                    <button
                      type="button"
                      key={cor}
                      className={cor === e.cor.toLowerCase() ? 'on' : ''}
                      style={corDaMarca('--c', cor)}
                      aria-label={`${nome} para a etapa ${e.nome}`}
                      title={nome}
                      onClick={() =>
                        editar({ tipo: 'etapa', item: e, funil, novaCor: cor })
                      }
                    />
                  ))}
                </div>
                <IconeBotao
                  nome={`Editar etapa ${e.nome}`}
                  onClick={() => editar({ tipo: 'etapa', item: e, funil })}
                >
                  <Pencil size={16} />
                </IconeBotao>
              </fieldset>
            ))}
            <div className="lrow">
              <Acao
                tipo="quiet"
                className="btn-sm"
                onClick={() => editar({ tipo: 'etapa', funil })}
              >
                <Plus size={15} />
                Nova etapa
              </Acao>
            </div>
          </div>
          {funil.id === 'vendas' &&
            inicioPosVenda &&
            etapas.some((e) => e.fechamento === 'sucesso') && (
              <p className="connection-note">
                <ArrowRight size={13} />
                Ao marcar {etapas.find((e) => e.fechamento === 'sucesso')?.nome}
                , o ZapCRM cria o negócio no {posVenda?.nome}, em{' '}
                {inicioPosVenda.nome}, sem repetir o valor.
              </p>
            )}
        </>
      )}
      {alvo && (
        <EditarEstrutura
          edicao={alvo}
          dados={data}
          selecionar={selecionar}
          fechar={() => {
            editar(null)
            fechar()
          }}
        />
      )}
    </>
  )
}
