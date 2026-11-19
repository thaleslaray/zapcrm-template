import { useQueryClient } from '@tanstack/react-query'
import { getRouteApi } from '@tanstack/react-router'
import { type ReactNode, useId, useRef, useState } from 'react'
import { invalidarEmpresa } from '#/lib/empresa-queries'
import { Acao, Janela } from './pecas'

export type SecaoEditavel = { criando: boolean; fechar: () => void }
export const rotaEmpresa = getRouteApi('/_app/app/configuracoes')

export function FormularioEmpresa({
  titulo,
  gravar,
  concluir,
  fechar,
  children,
  acao = 'Salvar',
  exclusao = false,
}: {
  titulo: string
  gravar: () => Promise<unknown>
  concluir?: () => void
  fechar: () => void
  children: ReactNode
  acao?: string
  exclusao?: boolean
}) {
  const cache = useQueryClient()
  const formId = useId()
  const ocupado = useRef(false)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  async function salvar() {
    if (ocupado.current) return
    ocupado.current = true
    setErro('')
    setSalvando(true)
    try {
      await gravar()
      await invalidarEmpresa(cache)
      concluir?.()
      fechar()
    } catch (e) {
      const mensagem = e instanceof Error ? e.message : ''
      const regraDaEquipe =
        /^(?:Sem acesso$|Entre (?:novamente|para acessar)|A equipe |A pessoa |A lista de etapas |O cadastro anterior |O funil |Escolha |Confira |Esta (?:pessoa|etapa) |Este (?:setor|funil) |Setor indisponível |Só é possível |Mantenha |Informe um e-mail )/
      setErro(
        regraDaEquipe.test(mensagem)
          ? mensagem
          : 'Não foi possível confirmar a alteração. Tente de novo.',
      )
    } finally {
      ocupado.current = false
      setSalvando(false)
    }
  }
  return (
    <Janela
      pequena
      titulo={titulo}
      onClose={() => {
        if (!ocupado.current) fechar()
      }}
      rodape={
        <Acao
          tipo={exclusao ? 'warn' : 'primary'}
          disabled={salvando}
          type="submit"
          form={formId}
        >
          {acao}
        </Acao>
      }
    >
      <form
        id={formId}
        onSubmit={(e) => {
          e.preventDefault()
          void salvar()
        }}
      >
        <fieldset className="formgrid" disabled={salvando}>
          {children}
        </fieldset>
        {erro && (
          <p className="mt-3" role="alert">
            {erro}
          </p>
        )}
      </form>
    </Janela>
  )
}
