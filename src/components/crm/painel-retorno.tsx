import { Calendar, Clock } from 'lucide-react'
import { useState } from 'react'
import { Input } from '#/components/ui/input'
import type {
  NumeroCarteira,
  RetornoCarteira,
} from '#/lib/carteira-leitura-tipos'
import {
  diaLocal,
  horaLocal,
  instanteLocal,
  useRelogioRetornos,
} from './horario-retorno'
import { Acao, Janela } from './pecas'
import { useRetorno } from './usar-retorno'

type Dados = {
  contatoId: string
  numeroId?: string
  numeros: NumeroCarteira[]
  retorno: RetornoCarteira | null
}

function EditorRetorno({
  contatoId,
  numeroId,
  numeros,
  retorno,
  fechar,
}: Dados & { fechar: () => void }) {
  const [id] = useState(() => retorno?.id ?? crypto.randomUUID())
  const [data, setData] = useState(() =>
    diaLocal(retorno?.marcadoPara ?? Date.now()),
  )
  const [hora, setHora] = useState(() =>
    retorno ? horaLocal(retorno.marcadoPara) : '09:00',
  )
  const [motivo, setMotivo] = useState(retorno?.motivo ?? '')
  const [canal, setCanal] = useState(
    retorno?.numeroId ?? numeroId ?? numeros[0]?.id ?? '',
  )
  const { gravar, erro, salvando } = useRetorno()
  return (
    <Janela
      pequena
      titulo={retorno ? 'Alterar retorno' : 'Marcar retorno'}
      onClose={() => {
        if (!salvando) fechar()
      }}
      rodape={
        <Acao
          tipo="primary"
          type="submit"
          form="agendar-retorno"
          disabled={salvando}
        >
          Salvar
        </Acao>
      }
    >
      <form
        id="agendar-retorno"
        className="formgrid"
        onSubmit={async (event) => {
          event.preventDefault()
          const ok = await gravar({
            tipo: 'retorno',
            acao: retorno ? 'alterar' : 'marcar',
            id,
            contatoId,
            numeroId: canal,
            marcadoPara: instanteLocal(data, hora),
            motivo,
          })
          if (ok) fechar()
        }}
      >
        {!numeroId && !retorno && numeros.length > 1 && (
          <label>
            Número da empresa
            <select
              className="select"
              value={canal}
              onChange={(e) => setCanal(e.target.value)}
            >
              {numeros.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.nome}
                </option>
              ))}
            </select>
          </label>
        )}
        <label htmlFor="retorno-data">
          Data
          <Input
            id="retorno-data"
            type="date"
            required
            value={data}
            onChange={(e) => setData(e.target.value)}
          />
        </label>
        <label htmlFor="retorno-hora">
          Hora
          <Input
            id="retorno-hora"
            type="time"
            required
            value={hora}
            onChange={(e) => setHora(e.target.value)}
          />
        </label>
        <label htmlFor="retorno-motivo">
          Motivo
          <Input
            id="retorno-motivo"
            required
            maxLength={500}
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
          />
        </label>
        {erro && <p role="alert">{erro}</p>}
      </form>
    </Janela>
  )
}

export function PainelRetorno(dados: Dados) {
  const [aberto, setAberto] = useState(false)
  const { retorno } = dados
  const agora = useRelogioRetornos(retorno ? [retorno.marcadoPara] : [])
  const atraso = retorno && retorno.marcadoPara < agora
  return (
    <div className="pbloc">
      <div className="plabel">
        Próximo retorno
        <button
          type="button"
          className="lk"
          disabled={!dados.numeros.length}
          onClick={() => setAberto(true)}
        >
          {retorno ? 'Alterar' : 'Marcar'}
        </button>
      </div>
      {retorno ? (
        <div className={`ret ${atraso ? 'late-r' : ''}`}>
          <span className="ri">
            {atraso ? <Clock size={18} /> : <Calendar size={18} />}
          </span>
          <div>
            <b>
              {atraso && 'Atrasado · '}
              {new Date(retorno.marcadoPara).toLocaleDateString('pt-BR', {
                timeZone: 'America/Sao_Paulo',
              })}{' '}
              · {horaLocal(retorno.marcadoPara)}
            </b>
            <span>{retorno.motivo}</span>
          </div>
        </div>
      ) : (
        <span className="muted">
          {dados.numeros.length
            ? 'Nenhum retorno marcado.'
            : 'É preciso um número da empresa para marcar um retorno.'}
        </span>
      )}
      {aberto && <EditorRetorno {...dados} fechar={() => setAberto(false)} />}
    </div>
  )
}
