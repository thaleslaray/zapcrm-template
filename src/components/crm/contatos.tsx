import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { getRouteApi } from '@tanstack/react-router'
import { ArrowDownUp, UserPlus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Skeleton } from '#/components/ui/skeleton'
import type {
  ContatoCarteira,
  FiltrosContatos,
  ListaCarteira,
} from '#/lib/carteira-leitura-tipos'
import { contatosQuery } from '#/lib/carteira-queries'
import { nomeDoContato, telefoneParaExibir } from '#/lib/telefone'
import {
  corDaMarca,
  dataRelativa,
  EtiquetaCarteira,
  enderecoDoContato,
  valorEmReais,
} from './carteira-pecas'
import { ContatoNovo } from './contato-novo'
import { Acao, Avatar, Busca, Filtro } from './pecas'

const app = getRouteApi('/_app')

function negociosAbertos(contato: ContatoCarteira) {
  if (!contato.abertos.length)
    return <span className="muted">Nenhum aberto</span>
  return contato.abertos.map((n) => (
    <span
      className="dealpill"
      key={n.id}
      style={corDaMarca('--pc', n.funilCor)}
    >
      <b>{n.funilNome}</b>
      <span className="stage" style={corDaMarca('--c', n.etapaCor)}>
        <span className="dot" />
        {n.etapaNome}
      </span>
    </span>
  ))
}

function destino(contato: ContatoCarteira, dados: ListaCarteira) {
  const numero = dados.numeros.find((n) => n.id === contato.conversa?.numeroId)
  return enderecoDoContato(contato.id, {
    conversa: contato.conversa?.id,
    funil: numero?.funilPadraoId,
  })
}

export function Contatos() {
  const { session } = app.useRouteContext()
  const [busca, setBusca] = useState('')
  const [filtros, setFiltros] = useState<FiltrosContatos>({})
  const [novo, setNovo] = useState(false)
  useEffect(() => {
    const atraso = setTimeout(
      () =>
        setFiltros((f) => {
          const termo = busca.trim() || undefined
          return termo === f.busca ? f : { ...f, busca: termo }
        }),
      250,
    )
    return () => clearTimeout(atraso)
  }, [busca])
  const consulta = useQuery({
    ...contatosQuery(session.user.id, filtros),
    placeholderData: keepPreviousData,
  })
  const dados = consulta.data
  function filtrar(
    campo: 'etapaId' | 'responsavelId' | 'etiquetaId',
    valor: string,
  ) {
    setFiltros((f) => ({ ...f, [campo]: valor || undefined }))
  }
  function ordenar(campo: 'valor' | 'ultima') {
    setFiltros((f) => ({
      ...f,
      ordem: campo,
      direcao:
        (f.ordem ?? 'ultima') === campo && (f.direcao ?? 'desc') === 'desc'
          ? 'asc'
          : 'desc',
    }))
  }
  function ordemDaColuna(campo: 'valor' | 'ultima') {
    if ((filtros.ordem ?? 'ultima') !== campo) return 'none'
    return filtros.direcao === 'asc' ? 'ascending' : 'descending'
  }
  const filtrado = !!(
    filtros.busca ||
    filtros.etapaId ||
    filtros.responsavelId ||
    filtros.etiquetaId
  )

  return (
    <div className="page">
      <div className="page-head">
        <h1>Contatos</h1>
        {dados && (
          <span className="sum">
            <b>{dados.contatos.length}</b>{' '}
            {dados.contatos.length === 1 ? 'contato' : 'contatos'}
          </span>
        )}
        <span className="sp" />
        <div className="ctl">
          <Busca nome="Buscar contato" value={busca} onChange={setBusca} />
          <Filtro
            nome="Etapa"
            valor={filtros.etapaId ?? ''}
            onChange={(v) => filtrar('etapaId', v)}
            todos="Todas as etapas"
            opcoes={(dados?.etapas ?? []).map((e) => [e.id, e.nome])}
          />
          <Filtro
            nome="Etiqueta"
            valor={filtros.etiquetaId ?? ''}
            onChange={(v) => filtrar('etiquetaId', v)}
            todos="Etiquetas"
            opcoes={(dados?.etiquetas ?? []).map((e) => [e.id, e.nome])}
          />
          <Filtro
            nome="Responsável"
            valor={filtros.responsavelId ?? ''}
            onChange={(v) => filtrar('responsavelId', v)}
            todos="Responsável"
            opcoes={(dados?.pessoas ?? []).map((e) => [e.id, e.nome])}
          />
          <Acao tipo="primary" disabled={!dados} onClick={() => setNovo(true)}>
            <UserPlus size={17} />
            Novo contato
          </Acao>
        </div>
      </div>
      <div className="page-body" aria-busy={consulta.isFetching}>
        {consulta.isError ? (
          <div className="empty-list" role="alert">
            <p>Não foi possível carregar</p>
            <Acao onClick={() => void consulta.refetch()}>Tentar de novo</Acao>
          </div>
        ) : !dados ? (
          <Skeleton className="m-5 h-28" aria-label="Carregando contatos" />
        ) : (
          <>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>Telefone</th>
                  <th>Empresa</th>
                  <th>Negócios abertos</th>
                  <th>Responsável</th>
                  <th className="r" aria-sort={ordemDaColuna('valor')}>
                    <button
                      type="button"
                      className="sortable"
                      onClick={() => ordenar('valor')}
                    >
                      Valor em aberto <ArrowDownUp size={13} />
                    </button>
                  </th>
                  <th>Etiquetas</th>
                  <th aria-sort={ordemDaColuna('ultima')}>
                    <button
                      type="button"
                      className="sortable"
                      onClick={() => ordenar('ultima')}
                    >
                      Última conversa <ArrowDownUp size={13} />
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {dados.contatos.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <div className="nmcell">
                        <Avatar
                          nome={nomeDoContato(c)}
                          contatoId={c.id}
                          tamanho={30}
                        />
                        <a href={destino(c, dados)}>{nomeDoContato(c)}</a>
                      </div>
                    </td>
                    <td className="tnum">{telefoneParaExibir(c) ?? '—'}</td>
                    <td className="cocell">{c.empresa ?? '—'}</td>
                    <td className="dl-cell">{negociosAbertos(c)}</td>
                    <td>
                      {c.responsavelNome ? (
                        <span className="owner" title={c.responsavelNome}>
                          <Avatar nome={c.responsavelNome} tamanho={22} />
                          {c.responsavelNome.split(' ')[0]}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="r money">
                      {c.valorCentavos ? valorEmReais(c.valorCentavos) : '—'}
                    </td>
                    <td className="tg">
                      <div className="tags">
                        {c.etiquetas.length
                          ? c.etiquetas.map((e) => (
                              <EtiquetaCarteira key={e.id} etiqueta={e} />
                            ))
                          : '—'}
                      </div>
                    </td>
                    <td className="tnum muted">
                      {c.conversa?.ultimaMensagemEm
                        ? dataRelativa(c.conversa.ultimaMensagemEm)
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="clist">
              {dados.contatos.map((c) => (
                <a className="crow" key={c.id} href={destino(c, dados)}>
                  <Avatar nome={nomeDoContato(c)} contatoId={c.id} />
                  <span className="mid">
                    <span className="nm">{nomeDoContato(c)}</span>
                    <span className="co">{c.empresa}</span>
                    <span className="ln">{negociosAbertos(c)}</span>
                  </span>
                  <span className="rt">
                    <span className="money">
                      {c.valorCentavos ? valorEmReais(c.valorCentavos) : '—'}
                    </span>
                    {c.responsavelNome && (
                      <span title={c.responsavelNome}>
                        <Avatar nome={c.responsavelNome} tamanho={22} />
                        <span className="sr-only">{c.responsavelNome}</span>
                      </span>
                    )}
                  </span>
                </a>
              ))}
            </div>
            {!dados.contatos.length && (
              <div className="empty-list">
                <p>
                  {filtros.busca
                    ? `Nada encontrado para “${filtros.busca}”`
                    : filtrado
                      ? 'Nenhum contato com estes filtros.'
                      : 'Nenhum contato cadastrado.'}
                </p>
                {filtrado && (
                  <Acao
                    onClick={() => {
                      setBusca('')
                      setFiltros({})
                    }}
                  >
                    Limpar busca
                  </Acao>
                )}
              </div>
            )}
          </>
        )}
      </div>
      {novo && dados && (
        <ContatoNovo dados={dados} fechar={() => setNovo(false)} />
      )}
    </div>
  )
}
