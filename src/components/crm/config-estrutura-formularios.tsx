import { Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Input } from '#/components/ui/input'
import { alterarEstruturaFn } from '#/lib/empresa-fns'
import type { ComandoEstrutura, Estrutura } from '#/lib/estrutura'
import { FormularioEmpresa } from './config-formulario'
import { Acao } from './pecas'

type Setor = Estrutura['setores'][number]
type Funil = Estrutura['funis'][number]
type Etapa = Estrutura['etapas'][number]
export type EdicaoEstrutura =
  | { tipo: 'setor'; item?: Setor }
  | { tipo: 'funil'; item?: Funil }
  | { tipo: 'etapa'; item?: Etapa; funil: Funil; novaCor?: string }
  | { tipo: 'ordem'; item: Etapa; etapas: Etapa[]; destino?: number }
  | { tipo: 'entrada'; funil: Funil }

function EditarOrdem({
  edicao,
  fechar,
}: {
  edicao: Extract<EdicaoEstrutura, { tipo: 'ordem' }>
  fechar: () => void
}) {
  const { item, etapas } = edicao
  const [posicao, escolher] = useState(
    edicao.destino ?? etapas.findIndex((e) => e.id === item.id) + 1,
  )
  function gravar() {
    const ids = etapas.map((e) => e.id).filter((id) => id !== item.id)
    ids.splice(posicao - 1, 0, item.id)
    return alterarEstruturaFn({
      data: { tipo: 'ordenarEtapas', funilId: item.funilId, ids },
    })
  }
  return (
    <FormularioEmpresa
      titulo={`Mover etapa ${item.nome}`}
      gravar={gravar}
      fechar={fechar}
    >
      <label>
        Posição
        <select
          aria-label="Posição"
          className="select"
          value={posicao}
          onChange={(e) => escolher(Number(e.target.value))}
        >
          {etapas.map((etapa, i) => (
            <option key={etapa.id} value={i + 1}>
              {i + 1} · {etapa.nome}
            </option>
          ))}
        </select>
      </label>
    </FormularioEmpresa>
  )
}

function NumeroDeEntrada({
  funil,
  dados,
  fechar,
}: {
  funil: Funil
  dados: Estrutura
  fechar: () => void
}) {
  const numeros = dados.numeros.filter((n) => n.setorId === funil.setorId)
  const [numeroId, escolher] = useState(
    numeros.find((n) => n.funilPadraoId !== funil.id)?.id ??
      numeros[0]?.id ??
      '',
  )
  return (
    <FormularioEmpresa
      titulo="Definir número de entrada"
      fechar={fechar}
      gravar={() =>
        alterarEstruturaFn({
          data: { tipo: 'definirFunilPadrao', numeroId, funilId: funil.id },
        })
      }
    >
      <label>
        Número
        <select
          aria-label="Número"
          required
          className="select"
          value={numeroId}
          onChange={(e) => escolher(e.target.value)}
        >
          {numeros.map((n) => (
            <option key={n.id} value={n.id}>
              {n.nome}
              {n.telefone ? ` · ${n.telefone}` : ''}
            </option>
          ))}
        </select>
      </label>
      <p>As novas conversas deste número entrarão no funil {funil.nome}.</p>
    </FormularioEmpresa>
  )
}

export function EditarEstrutura({
  edicao,
  dados,
  fechar,
  selecionar,
}: {
  edicao: EdicaoEstrutura
  dados: Estrutura
  fechar: () => void
  selecionar?: (id: string) => void
}) {
  if (edicao.tipo === 'ordem')
    return <EditarOrdem edicao={edicao} fechar={fechar} />
  if (edicao.tipo === 'entrada')
    return (
      <NumeroDeEntrada funil={edicao.funil} dados={dados} fechar={fechar} />
    )
  return (
    <CadastroEstrutura
      edicao={edicao}
      dados={dados}
      fechar={fechar}
      selecionar={selecionar}
    />
  )
}

function CadastroEstrutura({
  edicao,
  dados,
  fechar,
  selecionar,
}: {
  edicao: Exclude<EdicaoEstrutura, { tipo: 'ordem' | 'entrada' }>
  dados: Estrutura
  fechar: () => void
  selecionar?: (id: string) => void
}) {
  const { tipo, item } = edicao
  const [id] = useState(() => item?.id ?? crypto.randomUUID())
  const [nome, setNome] = useState(item?.nome ?? '')
  const [cor, setCor] = useState(
    edicao.tipo === 'etapa'
      ? (edicao.novaCor ?? edicao.item?.cor ?? '#64748b')
      : edicao.tipo === 'funil'
        ? (edicao.item?.cor ?? '#0f766e')
        : '',
  )
  const [setorId, setSetorId] = useState(
    (edicao.tipo === 'funil' && edicao.item?.setorId) ||
      dados.setores[0]?.id ||
      '',
  )
  const [fechamento, setFechamento] = useState<Etapa['fechamento']>(
    edicao.tipo === 'etapa' ? (edicao.item?.fechamento ?? null) : null,
  )
  const [apagar, setApagar] = useState(false)
  const emUso = edicao.tipo === 'etapa' && !!edicao.item?.negocios
  function comando(): ComandoEstrutura {
    if (apagar)
      return {
        tipo:
          tipo === 'setor'
            ? 'apagarSetor'
            : tipo === 'funil'
              ? 'apagarFunil'
              : 'apagarEtapa',
        id,
      }
    switch (edicao.tipo) {
      case 'setor':
        return { tipo: item ? 'editarSetor' : 'criarSetor', id, nome }
      case 'funil':
        return {
          tipo: item ? 'editarFunil' : 'criarFunil',
          id,
          nome,
          cor,
          setorId,
        }
      case 'etapa':
        return {
          tipo: item ? 'editarEtapa' : 'criarEtapa',
          id,
          nome,
          cor,
          fechamento,
          funilId: edicao.funil.id,
        }
    }
  }
  return (
    <FormularioEmpresa
      titulo={
        apagar
          ? `Apagar ${tipo}?`
          : `${item ? 'Editar' : tipo === 'etapa' ? 'Nova' : 'Novo'} ${tipo}`
      }
      fechar={fechar}
      acao={apagar ? 'Apagar' : 'Salvar'}
      exclusao={apagar}
      gravar={() => alterarEstruturaFn({ data: comando() })}
      concluir={() => {
        if (tipo === 'funil' && !apagar) selecionar?.(id)
      }}
    >
      {apagar ? (
        <p>Confirma a exclusão de “{item?.nome}”?</p>
      ) : (
        <>
          <label htmlFor="estrutura-nome">
            Nome
            <Input
              id="estrutura-nome"
              required
              maxLength={100}
              value={nome}
              onChange={(e) => setNome(e.target.value)}
            />
          </label>
          {edicao.tipo === 'funil' && (
            <label>
              Setor
              <select
                aria-label="Setor"
                className="select"
                required
                value={setorId}
                disabled={!!item}
                onChange={(e) => setSetorId(e.target.value)}
              >
                {dados.setores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.nome}
                  </option>
                ))}
              </select>
            </label>
          )}
          {tipo !== 'setor' && (
            <label htmlFor="estrutura-cor">
              Cor
              <Input
                id="estrutura-cor"
                type="color"
                value={cor}
                onChange={(e) => setCor(e.target.value)}
              />
            </label>
          )}
          {edicao.tipo === 'etapa' && (
            <label>
              Fechamento
              <select
                aria-label="Fechamento"
                className="select"
                value={fechamento ?? ''}
                onChange={(e) => {
                  const valor = e.target.value
                  setFechamento(
                    valor === 'sucesso' || valor === 'perda' ? valor : null,
                  )
                }}
              >
                <option value="">Etapa aberta</option>
                <option value="sucesso">Sucesso</option>
                <option value="perda">Perda</option>
              </select>
            </label>
          )}
          {item && (
            <Acao tipo="ghost" disabled={emUso} onClick={() => setApagar(true)}>
              <Trash2 size={16} />
              Apagar {tipo}
            </Acao>
          )}
          {emUso && (
            <p className="muted">
              Esta etapa tem negócios e não pode ser apagada.
            </p>
          )}
        </>
      )}
    </FormularioEmpresa>
  )
}
