import { useQueryClient } from '@tanstack/react-query'
import { Server } from 'lucide-react'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { Field } from '#/components/app/field'
import { Input } from '#/components/ui/input'
import type { painelNumerosFn } from '#/lib/wa-numeros-fns'
import { invalidarNumeros } from '#/lib/wa-numeros-queries'
import { removerServidorFn, salvarServidorFn } from '#/lib/wa-servidor-fns'
import { Acao, Janela } from './pecas'

const dataLocal = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'America/Sao_Paulo',
})

type Operacao = 'salvar' | 'remover'

export function ServidorUazapi({
  servidor,
}: {
  servidor: Awaited<ReturnType<typeof painelNumerosFn>>['servidor']
}) {
  const cache = useQueryClient()
  const endereco = useRef<HTMLInputElement>(null)
  const token = useRef<HTMLInputElement>(null)
  const emAndamento = useRef(false)
  const [ocupado, setOcupado] = useState(false)
  const [confirmacao, setConfirmacao] = useState<Operacao | null>(null)
  const [erro, setErro] = useState('')
  const [trocando, setTrocando] = useState(false)
  // Cadastro feito pela tela fica recolhido: o próximo passo é conectar números.
  const formulario = servidor.salvoEm === null || trocando

  async function executar(operacao: Operacao, confirmar = false) {
    if (emAndamento.current) return
    emAndamento.current = true
    setOcupado(true)
    setErro('')
    try {
      const resposta =
        operacao === 'salvar'
          ? await salvarServidorFn({
              data: {
                endereco: endereco.current?.value ?? '',
                token: token.current?.value ?? '',
                confirmar,
              },
            })
          : await removerServidorFn({ data: { confirmar } })
      if (resposta.erro) {
        setConfirmacao(null)
        setErro(resposta.erro)
      } else if (resposta.confirmacaoNecessaria) {
        setConfirmacao(operacao)
      } else {
        setConfirmacao(null)
        if (token.current) token.current.value = ''
        if (endereco.current) endereco.current.value = ''
        setTrocando(false)
        await invalidarNumeros(cache)
        toast.success(
          operacao === 'salvar'
            ? 'Servidor conectado. Agora conecte um número.'
            : 'Configuração do servidor removida.',
        )
      }
    } catch {
      setConfirmacao(null)
      setErro(
        'Não foi possível confirmar a alteração. Consulte o estado do servidor antes de tentar novamente.',
      )
    } finally {
      emAndamento.current = false
      setOcupado(false)
    }
  }
  return (
    <section
      aria-labelledby="titulo-servidor-uazapi"
      className="card mb-5 grid gap-4 p-4 sm:p-5"
    >
      <div className="flex min-w-0 items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-[var(--brand-soft)] text-[var(--brand)]">
          <Server size={20} aria-hidden="true" />
        </span>
        <div className="grid min-w-0 gap-0.5">
          <h3 id="titulo-servidor-uazapi" className="text-base font-semibold">
            Servidor uazapi
          </h3>
          <p className="break-all text-sm">
            {servidor.configurado
              ? `Conectado a ${servidor.host}`
              : 'Não configurado'}
          </p>
          {servidor.salvoEm !== null && (
            <p className="break-words text-xs text-muted-foreground">
              Salvo por {servidor.salvoPor} em{' '}
              <time dateTime={new Date(servidor.salvoEm).toISOString()}>
                {dataLocal.format(servidor.salvoEm)}
              </time>
            </p>
          )}
          {servidor.configurado && servidor.salvoEm === null && (
            <p className="text-xs text-muted-foreground">
              Configurado nos segredos do Worker.
            </p>
          )}
        </div>
      </div>
      {!formulario && (
        <div className="flex flex-wrap items-center gap-2 border-t border-[var(--line)] pt-4">
          <Acao onClick={() => setTrocando(true)}>Trocar servidor</Acao>
          <Acao
            tipo="quiet"
            onClick={() => {
              setErro('')
              setConfirmacao('remover')
            }}
          >
            Remover configuração
          </Acao>
        </div>
      )}
      <form
        hidden={!formulario}
        method="post"
        onSubmit={(event) => {
          event.preventDefault()
          void executar('salvar')
        }}
      >
        <fieldset
          className="grid gap-4 border-t border-[var(--line)] pt-4 sm:grid-cols-2"
          disabled={ocupado}
        >
          <Field id="endereco-servidor-uazapi" label="Endereço do servidor">
            <Input
              id="endereco-servidor-uazapi"
              ref={endereco}
              required
              inputMode="url"
              autoCapitalize="none"
              spellCheck={false}
              autoComplete="off"
              placeholder="https://seu-servidor.uazapi.com"
            />
          </Field>
          <Field id="token-servidor-uazapi" label="Token de administração">
            <Input
              id="token-servidor-uazapi"
              ref={token}
              type="password"
              required
              autoComplete="new-password"
            />
          </Field>
          <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
            <Acao type="submit" tipo="primary">
              {ocupado && !confirmacao
                ? 'Testando servidor…'
                : 'Salvar servidor'}
            </Acao>
            {trocando && (
              <Acao
                tipo="quiet"
                onClick={() => {
                  setErro('')
                  setTrocando(false)
                }}
              >
                Cancelar
              </Acao>
            )}
          </div>
        </fieldset>
      </form>
      {erro && (
        <p role="alert" className="text-sm text-destructive">
          {erro}
        </p>
      )}
      {confirmacao && (
        <Janela
          pequena
          titulo={
            confirmacao === 'salvar'
              ? 'Trocar servidor?'
              : 'Remover a configuração?'
          }
          onClose={() => {
            if (!emAndamento.current) setConfirmacao(null)
          }}
          rodape={
            <Acao
              tipo="warn"
              disabled={ocupado}
              onClick={() => executar(confirmacao, true)}
            >
              {confirmacao === 'salvar'
                ? 'Trocar servidor'
                : 'Remover servidor'}
            </Acao>
          }
        >
          {confirmacao === 'remover' && (
            <p>
              O ZapCRM voltará a usar o servidor definido nos segredos do
              Worker, se houver.
            </p>
          )}
          <p>
            Os números cadastrados serão desconectados e precisarão ser
            religados. Os contatos, as conversas e as mensagens serão
            preservados. Anexos que ainda não foram baixados podem ficar
            indisponíveis.
          </p>
        </Janela>
      )}
    </section>
  )
}
