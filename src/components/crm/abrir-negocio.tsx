import { useState } from 'react'
import type { PainelCarteira } from '#/lib/carteira-leitura-tipos'
import { Acao, Janela } from './pecas'

export function AbrirNegocio({
  dados,
  usuarioId,
  funilInicial,
  abrir,
  fechar,
  ocupado,
  erro,
}: {
  dados: PainelCarteira
  usuarioId: string
  funilInicial?: string
  abrir: (funilId: string, responsavelId: string) => Promise<void>
  fechar: () => void
  ocupado: boolean
  erro: string
}) {
  const [funilId, setFunilId] = useState(
    funilInicial ?? dados.funis[0]?.id ?? '',
  )
  const [responsavelId, setResponsavelId] = useState(usuarioId)
  const setorId = dados.funis.find((f) => f.id === funilId)?.setorId
  const pessoas = dados.pessoas.filter(
    (p) =>
      (dados.gestor || p.id === usuarioId) &&
      (p.papel === 'gestor' || (setorId && p.setorIds.includes(setorId))),
  )
  const escolhido = pessoas.some((p) => p.id === responsavelId)
    ? responsavelId
    : ''
  return (
    <Janela
      pequena
      titulo="Novo negócio"
      onClose={() => {
        if (!ocupado) fechar()
      }}
      rodape={
        <Acao
          tipo="primary"
          form="abrir-negocio"
          type="submit"
          disabled={ocupado || !escolhido}
        >
          Abrir negócio
        </Acao>
      }
    >
      <form
        id="abrir-negocio"
        className="formgrid"
        onSubmit={async (event) => {
          event.preventDefault()
          await abrir(funilId, escolhido)
        }}
      >
        <label>
          Funil
          <select
            className="select"
            value={funilId}
            onChange={(event) => {
              setFunilId(event.target.value)
              setResponsavelId(usuarioId)
            }}
            disabled={ocupado}
            required
          >
            {dados.funis.map((f) => (
              <option key={f.id} value={f.id}>
                {f.nome}
              </option>
            ))}
          </select>
        </label>
        <label>
          Responsável
          <select
            className="select"
            value={escolhido}
            onChange={(event) => setResponsavelId(event.target.value)}
            disabled={ocupado}
            required
          >
            {!escolhido && <option value="">Escolha uma pessoa</option>}
            {pessoas.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nome}
              </option>
            ))}
          </select>
        </label>
        {erro && <p role="alert">{erro}</p>}
      </form>
    </Janela>
  )
}
