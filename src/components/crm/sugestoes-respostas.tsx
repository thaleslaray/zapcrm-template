import { useQuery } from '@tanstack/react-query'
import { respostasQuery } from '#/lib/catalogos-queries'

export function SugestoesRespostas({
  usuario,
  termo,
  escolher,
}: {
  usuario: string
  termo: string
  escolher: (texto: string) => void
}) {
  const consulta = useQuery(respostasQuery(usuario))
  const opcoes = consulta.data?.filter((r) =>
    r.atalho
      .toLocaleLowerCase('pt-BR')
      .startsWith(termo.toLocaleLowerCase('pt-BR')),
  )
  if (!consulta.isError && !consulta.isPending && !opcoes?.length) return null
  return (
    <fieldset
      className="qr-pop max-h-64 overflow-y-auto"
      aria-label="Respostas rápidas"
    >
      <div className="h">Respostas rápidas</div>
      {consulta.isPending && <span role="status">Carregando…</span>}
      {consulta.isError && (
        <div role="alert">
          Não foi possível carregar.{' '}
          <button
            type="button"
            className="lk"
            onClick={() => void consulta.refetch()}
          >
            Tentar de novo
          </button>
        </div>
      )}
      {opcoes?.map((r) => (
        <button
          key={r.id}
          type="button"
          className="qr-item w-full text-left"
          onClick={(e) => {
            escolher(r.texto)
            e.currentTarget.form
              ?.querySelector<HTMLInputElement>('input[aria-label="Mensagem"]')
              ?.focus()
          }}
        >
          <code>{r.atalho}</code>
          <span>{r.texto}</span>
        </button>
      ))}
    </fieldset>
  )
}
