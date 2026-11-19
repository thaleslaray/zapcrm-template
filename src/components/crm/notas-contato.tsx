import { MoreHorizontal, Plus } from 'lucide-react'
import { useState } from 'react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { Input } from '#/components/ui/input'
import type { PainelCarteira } from '#/lib/carteira-leitura-tipos'
import { Acao, Avatar, Janela } from './pecas'
import { useGravarNota } from './usar-nota'

type Nota = PainelCarteira['notas'][number]
const dataNota = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'America/Sao_Paulo',
})

export function NotasContato({
  contatoId,
  notas,
}: {
  contatoId: string
  notas: Nota[]
}) {
  const [texto, setTexto] = useState('')
  const [acao, setAcao] = useState<{ nota: Nota; apagar: boolean } | null>(null)
  const [edicao, setEdicao] = useState('')
  const { criar, gravar, ocupado, erro, limparErro } = useGravarNota(contatoId)
  function fechar() {
    if (!ocupado) {
      setAcao(null)
      limparErro()
    }
  }
  function alterar(nota: Nota, apagar: boolean) {
    limparErro()
    setEdicao(nota.texto)
    setAcao({ nota, apagar })
  }
  async function confirmar() {
    if (!acao) return
    const alvo = { id: acao.nota.id, contatoId }
    const ok = await gravar(
      acao.apagar
        ? { tipo: 'apagarNota', ...alvo }
        : { tipo: 'editarNota', ...alvo, texto: edicao },
    )
    if (ok) setAcao(null)
  }
  return (
    <div className="pbloc">
      <div className="plabel">
        Notas <span className="muted">{notas.length}</span>
      </div>
      <div className="notes">
        {notas.map((item) => (
          <div className="notei" key={item.id}>
            <p className="whitespace-pre-wrap break-words">{item.texto}</p>
            <div className="by">
              <Avatar nome={item.autorNome || 'Equipe'} tamanho={18} />
              <span>
                {item.autorNome || 'Equipe'} · {dataNota.format(item.criadoEm)}
              </span>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="lk ml-auto"
                    aria-label="Opções da nota"
                    disabled={ocupado}
                  >
                    <MoreHorizontal size={16} />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => alterar(item, false)}>
                    Editar nota
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => alterar(item, true)}>
                    Apagar nota
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        ))}
      </div>
      <form
        className="newnote"
        onSubmit={async (e) => {
          e.preventDefault()
          if (texto.trim() && (await criar(texto))) setTexto('')
        }}
      >
        <Input
          className="field min-w-0"
          aria-label="Nova nota"
          placeholder="Escrever uma nota…"
          value={texto}
          disabled={ocupado}
          maxLength={4000}
          onChange={(e) => setTexto(e.target.value)}
        />
        <Acao
          tipo="primary"
          type="submit"
          aria-label="Salvar nota"
          disabled={ocupado || !texto.trim()}
        >
          <Plus size={16} />
        </Acao>
      </form>
      {!acao && erro && <p role="alert">{erro}</p>}
      {acao && (
        <Janela
          pequena
          titulo={acao.apagar ? 'Apagar nota?' : 'Editar nota'}
          onClose={fechar}
          rodape={
            <Acao
              tipo={acao.apagar ? 'warn' : 'primary'}
              disabled={ocupado || (!acao.apagar && !edicao.trim())}
              onClick={() => void confirmar()}
            >
              {acao.apagar ? 'Apagar nota' : 'Salvar alteração'}
            </Acao>
          }
        >
          {acao.apagar ? (
            <p>{acao.nota.texto}</p>
          ) : (
            <label htmlFor="editar-texto-nota">
              Texto da nota
              <Input
                id="editar-texto-nota"
                value={edicao}
                maxLength={4000}
                disabled={ocupado}
                onChange={(e) => setEdicao(e.target.value)}
              />
            </label>
          )}
          {erro && <p role="alert">{erro}</p>}
        </Janela>
      )}
    </div>
  )
}
