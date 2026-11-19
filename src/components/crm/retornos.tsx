import { useQuery } from '@tanstack/react-query'
import { getRouteApi } from '@tanstack/react-router'
import { Check, Clock, History, MessageCircle } from 'lucide-react'
import { type CSSProperties, useState } from 'react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { agendaQuery } from '#/lib/carteira-queries'
import type { ComandoRetorno } from '#/lib/retornos-escrita'
import type { ItemAgenda } from '#/lib/retornos-leitura'
import { corDaMarca, dataBreve, enderecoDoContato } from './carteira-pecas'
import { AguardandoCarteira } from './estado-carteira'
import {
  diaLocal,
  emDias,
  horaLocal,
  useRelogioRetornos,
} from './horario-retorno'
import { Acao, Avatar, Filtro } from './pecas'
import { useRetorno } from './usar-retorno'

const rota = getRouteApi('/_app/app/retornos')
const titulos = [
  'Atrasados',
  'Hoje',
  'Amanhã',
  'Próximos dias',
  'Feitos',
] as const
const dataExtensa = new Intl.DateTimeFormat('pt-BR', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  timeZone: 'America/Sao_Paulo',
})

function LinhaRetorno({ item: r, dia }: { item: ItemAgenda; dia: string }) {
  const { gravar, salvando, erro } = useRetorno()
  const [pendente, setPendente] = useState<ComandoRetorno | null>(null)
  const base = {
    tipo: 'retorno' as const,
    id: r.id,
    contatoId: r.contatoId,
    numeroId: r.numeroId,
  }
  async function enviar(c: ComandoRetorno) {
    setPendente(c)
    if (await gravar(c)) setPendente(null)
  }
  function adiar(destino: 'hora' | 'amanha' | 'segunda') {
    const agora = Date.now()
    const semana = new Date(`${diaLocal(agora)}T12:00:00Z`).getUTCDay()
    const marcadoPara =
      destino === 'hora'
        ? agora + 3600000
        : emDias(
            agora,
            destino === 'amanha' ? 1 : (8 - semana) % 7 || 7,
            '09:00',
          )
    void enviar({ ...base, acao: 'adiar', marcadoPara })
  }
  return (
    <div className={`item${r.feitoEm !== null ? ' done' : ''}`}>
      <div className="when">
        {horaLocal(r.marcadoPara)}
        <small>{dia}</small>
      </div>
      <Avatar nome={r.nome} />
      <div className="min-w-0">
        <div className="nm">
          {r.nome}
          <span>{r.empresa}</span>
        </div>
        <div className="why">{r.motivo}</div>
        <div className="meta2">
          {r.responsavelNome && (
            <Avatar nome={r.responsavelNome} tamanho={18} />
          )}
          {r.responsavelNome ?? 'Sem responsável'}
          {r.etapaCor && (
            <span className="stage" style={corDaMarca('--c', r.etapaCor)}>
              <span className="dot" />
              {r.etapaNome}
            </span>
          )}
          <span
            className="nummark"
            style={{ '--nc': r.numeroCor } as CSSProperties}
          >
            {r.numeroNome}
          </span>
        </div>
      </div>
      <div className="acts">
        {r.feitoEm !== null ? (
          <Acao
            tipo="quiet"
            className="btn-sm"
            disabled={salvando}
            onClick={() => void enviar({ ...base, acao: 'desfazer' })}
          >
            Desfazer
          </Acao>
        ) : (
          <>
            <Acao
              tipo="primary"
              className="btn-sm"
              disabled={salvando}
              onClick={() => void enviar({ ...base, acao: 'feito' })}
            >
              <Check size={15} />
              Feito
            </Acao>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Acao className="btn-sm" disabled={salvando}>
                  <History size={14} />
                  Adiar
                </Acao>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Adiar para…</DropdownMenuLabel>
                <DropdownMenuItem onSelect={() => adiar('hora')}>
                  Daqui a 1 hora
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => adiar('amanha')}>
                  Amanhã, 9h
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => adiar('segunda')}>
                  Próxima segunda, 9h
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <a
              className="btn btn-sm btn-ghost"
              href={enderecoDoContato(r.contatoId, {
                conversa: r.conversaId ?? undefined,
              })}
            >
              <MessageCircle size={14} />
              {r.conversaId ? 'Abrir conversa' : 'Abrir contato'}
            </a>
          </>
        )}
      </div>
      {erro && (
        <div className="col-span-full" role="alert">
          {erro}{' '}
          {pendente && (
            <button
              className="lk"
              type="button"
              onClick={() => void enviar(pendente)}
            >
              Tentar de novo
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export function Retornos() {
  const { session } = rota.useRouteContext()
  const consulta = useQuery(agendaQuery(session.user.id))
  const [pessoa, setPessoa] = useState('')
  const agenda = consulta.data
  const itens = (agenda?.itens ?? []).filter(
    (r) => !pessoa || r.responsavelId === pessoa,
  )
  const agora = useRelogioRetornos(
    itens.filter((r) => r.feitoEm === null).map((r) => r.marcadoPara),
  )
  if (consulta.isError)
    return (
      <div className="empty-list" role="alert">
        <p>Não foi possível carregar</p>
        <Acao onClick={() => void consulta.refetch()}>Tentar de novo</Acao>
      </div>
    )
  if (!agenda) return <AguardandoCarteira />
  const hoje = diaLocal(agora),
    amanha = diaLocal(emDias(agora, 1, '12:00'))
  const grupos: ItemAgenda[][] = titulos.map(() => [])
  for (const item of itens) {
    const dia = diaLocal(item.marcadoPara)
    const grupo =
      item.feitoEm !== null
        ? 4
        : item.marcadoPara < agora
          ? 0
          : dia === hoje
            ? 1
            : dia === amanha
              ? 2
              : 3
    grupos[grupo].push(item)
  }
  return (
    <div className="page">
      <div className="page-head">
        <h1>Retornos</h1>
        <span className="sum">
          <b className="late-summary">
            {grupos[0].length}{' '}
            {grupos[0].length === 1 ? 'atrasado' : 'atrasados'}
          </b>{' '}
          · <b>{grupos[1].length}</b> para hoje · {dataExtensa.format(agora)}
        </span>
        <span className="sp" />
        {agenda.gestor && (
          <div className="ctl">
            <Filtro
              nome="Pessoa"
              todos="Toda a equipe"
              valor={pessoa}
              onChange={setPessoa}
              opcoes={agenda.pessoas.map((p) => [p.id, p.nome])}
            />
          </div>
        )}
      </div>
      <div className="page-body">
        <div className="agenda">
          {grupos.map(
            (lista, i) =>
              lista.length > 0 && (
                <section
                  className={`grp ${i === 0 ? 'lateg' : ''}`}
                  key={titulos[i]}
                  aria-label={titulos[i]}
                >
                  <h2>
                    {i === 0 && <Clock size={16} />} {titulos[i]}{' '}
                    <span className="c">{lista.length}</span>
                  </h2>
                  <div className="items card">
                    {lista.map((r) => (
                      <LinhaRetorno
                        key={r.id}
                        item={r}
                        dia={
                          diaLocal(r.marcadoPara) === hoje
                            ? 'hoje'
                            : diaLocal(r.marcadoPara) === amanha
                              ? 'amanhã'
                              : dataBreve(r.marcadoPara)
                        }
                      />
                    ))}
                  </div>
                </section>
              ),
          )}
          {!itens.length && (
            <div className="empty-list">
              <p>
                {pessoa
                  ? 'Nenhum retorno para esta pessoa.'
                  : 'Nenhum retorno marcado.'}
              </p>
              {pessoa && (
                <Acao onClick={() => setPessoa('')}>Limpar filtro</Acao>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
