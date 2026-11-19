import { useSuspenseQuery } from '@tanstack/react-query'
import { Copy, EllipsisVertical, Mail, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Input } from '#/components/ui/input'
import { alterarEquipeFn } from '#/lib/empresa-fns'
import { equipeQuery } from '#/lib/empresa-queries'
import type { listarEquipe } from '#/lib/equipe'
import {
  FormularioEmpresa,
  rotaEmpresa,
  type SecaoEditavel,
} from './config-formulario'
import { Acao, Avatar, IconeBotao } from './pecas'

type EquipeDados = Awaited<ReturnType<typeof listarEquipe>>
type Pessoa = EquipeDados['pessoas'][number]
type Convite = EquipeDados['convites'][number]
type Edicao =
  | { tipo: 'convidar' }
  | { tipo: 'editarPessoa'; pessoa: Pessoa }
  | { tipo: 'cancelarConvite'; convite: Convite }
type RetornoEquipe = Awaited<ReturnType<typeof alterarEquipeFn>>

function Direitos({
  papel,
  setores,
  opcoes,
}: {
  papel: Pessoa['papel']
  setores: string[]
  opcoes: EquipeDados['setores']
}) {
  return (
    <span className="secchips">
      {papel === 'gestor' ? (
        <span className="role g">Gestor · todos os setores</span>
      ) : (
        <>
          <span className="role cfg-papel-vendedor">Vendedor</span>
          {setores.length ? (
            opcoes
              .filter((s) => setores.includes(s.id))
              .map((s) => (
                <span key={s.id} className="role">
                  {s.nome}
                </span>
              ))
          ) : (
            <span className="role">Sem setor</span>
          )}
        </>
      )}
    </span>
  )
}

function EditarEquipe({
  edicao,
  opcoes,
  fechar,
  informar,
}: {
  edicao: Edicao
  opcoes: EquipeDados['setores']
  fechar: () => void
  informar: (res: RetornoEquipe) => void
}) {
  const pessoa = edicao.tipo === 'editarPessoa' ? edicao.pessoa : undefined
  const [id] = useState(() => pessoa?.id ?? crypto.randomUUID())
  const [email, setEmail] = useState('')
  const [papel, setPapel] = useState<Pessoa['papel']>(
    pessoa?.papel ?? 'vendedor',
  )
  const [setores, setSetores] = useState<string[]>(pessoa?.setores ?? [])
  const [remover, setRemover] = useState(false)
  const cancelar = edicao.tipo === 'cancelarConvite'
  const titulo = cancelar
    ? 'Cancelar convite?'
    : remover
      ? 'Remover pessoa?'
      : pessoa
        ? 'Editar pessoa'
        : 'Convidar pessoa'
  return (
    <FormularioEmpresa
      titulo={titulo}
      fechar={fechar}
      acao={cancelar ? 'Cancelar convite' : remover ? 'Remover' : 'Salvar'}
      exclusao={cancelar || remover}
      gravar={async () => {
        const resultado = await alterarEquipeFn({
          data:
            edicao.tipo === 'cancelarConvite'
              ? { tipo: 'cancelarConvite', id: edicao.convite.id }
              : remover
                ? { tipo: 'removerPessoa', id }
                : pessoa
                  ? { tipo: 'editarPessoa', id, papel, setores }
                  : { tipo: 'convidar', id, email, papel, setores },
        })
        informar(resultado)
      }}
    >
      {edicao.tipo === 'cancelarConvite' ? (
        <p>Cancelar o convite de {edicao.convite.email}?</p>
      ) : remover ? (
        <p>{pessoa?.nome} perderá o acesso a esta instalação.</p>
      ) : (
        <>
          {pessoa ? (
            <p>
              {pessoa.nome}
              <br />
              <span className="muted">{pessoa.email}</span>
            </p>
          ) : (
            <label htmlFor="convite-email">
              E-mail
              <Input
                id="convite-email"
                type="email"
                autoComplete="off"
                required
                maxLength={254}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
          )}
          <label>
            Papel
            <select
              aria-label="Papel"
              className="select"
              value={papel}
              onChange={(e) =>
                setPapel(e.target.value === 'gestor' ? 'gestor' : 'vendedor')
              }
            >
              <option value="vendedor">Vendedor</option>
              <option value="gestor">Gestor</option>
            </select>
          </label>
          {papel === 'gestor' ? (
            <p className="muted">O gestor vê todos os setores.</p>
          ) : (
            <fieldset className="config-vinculos">
              <legend>Setores</legend>
              {opcoes.length === 0 && (
                <p className="muted">Nenhum setor cadastrado.</p>
              )}
              {opcoes.map((s) => (
                <label key={s.id}>
                  <input
                    type="checkbox"
                    checked={setores.includes(s.id)}
                    onChange={(e) =>
                      setSetores(
                        e.target.checked
                          ? [...setores, s.id]
                          : setores.filter((id) => id !== s.id),
                      )
                    }
                  />
                  {s.nome}
                </label>
              ))}
            </fieldset>
          )}
          {pessoa && (
            <Acao tipo="ghost" onClick={() => setRemover(true)}>
              <Trash2 size={16} />
              Remover pessoa
            </Acao>
          )}
        </>
      )}
    </FormularioEmpresa>
  )
}

export function Equipe({ criando, fechar }: SecaoEditavel) {
  const { session } = rotaEmpresa.useRouteContext()
  const { data } = useSuspenseQuery(equipeQuery(session.user.id))
  const [edicao, editar] = useState<Edicao | null>(null)
  const [aviso, informar] = useState<RetornoEquipe | null>(null)
  const [copia, setCopia] = useState('')
  const alvo: Edicao | null = criando ? { tipo: 'convidar' } : edicao
  return (
    <>
      {aviso && (
        <div className="card mb-3 grid gap-2 p-3" role="status">
          <p>{aviso.mensagem}</p>
          {aviso.endereco && (
            <>
              <label htmlFor="convite-endereco">
                Endereço de entrada
                <Input
                  id="convite-endereco"
                  readOnly
                  value={aviso.endereco}
                  onFocus={(e) => e.currentTarget.select()}
                />
              </label>
              <Acao
                className="justify-self-start btn-sm"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(aviso.endereco ?? '')
                    setCopia('Endereço copiado.')
                  } catch {
                    setCopia('Selecione e copie o endereço acima.')
                  }
                }}
              >
                <Copy size={15} />
                Copiar endereço
              </Acao>
              {copia && <span>{copia}</span>}
            </>
          )}
        </div>
      )}
      <div className="card cfg-equipe">
        {data.pessoas.map((p) => (
          <div className="lrow cfg-membro" key={p.id}>
            <Avatar nome={p.nome} tamanho={36} />
            <div className="nm">
              <span className="cfg-nome">
                {p.nome}
                {p.id === session.user.id && (
                  <span className="muted"> (você)</span>
                )}
              </span>
              <div className="sub cfg-email">
                {p.papel === 'vendedor' && (
                  <span className="cfg-papel-compacto">Vendedor · </span>
                )}
                {p.email}
              </div>
            </div>
            <Direitos
              papel={p.papel}
              setores={p.setores}
              opcoes={data.setores}
            />
            <IconeBotao
              nome={`Editar pessoa ${p.nome}`}
              onClick={() => editar({ tipo: 'editarPessoa', pessoa: p })}
            >
              <EllipsisVertical size={18} />
            </IconeBotao>
          </div>
        ))}
      </div>
      {data.convites.length > 0 && (
        <section className="mt-5">
          <h3 className="mb-2">Convites pendentes</h3>
          <div className="card cfg-equipe">
            {data.convites.map((c) => (
              <div key={c.id} className="lrow">
                <Mail size={18} />
                <div className="nm">{c.email}</div>
                <Direitos
                  papel={c.papel}
                  setores={c.setores}
                  opcoes={data.setores}
                />
                <IconeBotao
                  nome={`Cancelar convite de ${c.email}`}
                  onClick={() =>
                    editar({ tipo: 'cancelarConvite', convite: c })
                  }
                >
                  <Trash2 size={16} />
                </IconeBotao>
              </div>
            ))}
          </div>
        </section>
      )}
      {alvo && (
        <EditarEquipe
          edicao={alvo}
          opcoes={data.setores}
          informar={(resultado) => {
            setCopia('')
            informar(resultado)
          }}
          fechar={() => {
            editar(null)
            fechar()
          }}
        />
      )}
    </>
  )
}
