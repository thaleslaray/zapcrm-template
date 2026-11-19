import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { getRouteApi } from '@tanstack/react-router'
import { Pencil, Trash2 } from 'lucide-react'
import { useRef, useState } from 'react'
import { Input } from '#/components/ui/input'
import { Textarea } from '#/components/ui/textarea'
import type { Marca } from '#/lib/carteira-leitura-tipos'
import type { ComandoCatalogo } from '#/lib/catalogos'
import { alterarCatalogoFn } from '#/lib/catalogos-fns'
import {
  etiquetasGestaoQuery,
  invalidarCatalogo,
  respostasQuery,
} from '#/lib/catalogos-queries'
import { EtiquetaCarteira } from './carteira-pecas'
import { Acao, IconeBotao, Janela } from './pecas'

type Resposta = { id: string; atalho: string; texto: string }
type Edicao =
  | { tipo: 'etiquetas'; item?: Marca }
  | { tipo: 'respostas'; item?: Resposta }
type Dialogo = Edicao & { apagar?: boolean }
type Props = { criando: boolean; fechar: () => void }
const rota = getRouteApi('/_app/app/configuracoes')

function Formulario({
  edicao,
  fechar,
}: {
  edicao: Dialogo
  fechar: () => void
}) {
  const cache = useQueryClient()
  const [id] = useState(() => edicao.item?.id ?? crypto.randomUUID())
  const [nome, setNome] = useState(
    edicao.tipo === 'etiquetas' ? (edicao.item?.nome ?? '') : '',
  )
  const [cor, setCor] = useState(
    edicao.tipo === 'etiquetas' ? (edicao.item?.cor ?? '#0f766e') : '',
  )
  const [atalho, setAtalho] = useState(
    edicao.tipo === 'respostas' ? (edicao.item?.atalho ?? '') : '',
  )
  const [texto, setTexto] = useState(
    edicao.tipo === 'respostas' ? (edicao.item?.texto ?? '') : '',
  )
  const [apagar, setApagar] = useState(edicao.apagar ?? false)
  const envio = useRef(false)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  const etiqueta = edicao.tipo === 'etiquetas'
  const nomeItem = etiqueta ? 'etiqueta' : 'resposta'
  const titulo = apagar
    ? `Apagar ${nomeItem}?`
    : `${edicao.item ? 'Editar' : 'Nova'} ${nomeItem}`
  async function salvar() {
    if (envio.current) return
    envio.current = true
    setSalvando(true)
    setErro('')
    const comando: ComandoCatalogo = apagar
      ? { tipo: etiqueta ? 'apagarEtiqueta' : 'apagarResposta', id }
      : etiqueta
        ? {
            tipo: edicao.item ? 'editarEtiqueta' : 'criarEtiqueta',
            id,
            nome,
            cor,
          }
        : {
            tipo: edicao.item ? 'editarResposta' : 'criarResposta',
            id,
            atalho,
            texto,
          }
    try {
      await alterarCatalogoFn({ data: comando })
      await invalidarCatalogo(cache, edicao.tipo)
      fechar()
    } catch (e) {
      const mensagem = e instanceof Error ? e.message : ''
      setErro(
        /^(Esse cadastro|O cadastro anterior|Use um atalho|Escolha uma cor|Confira os campos|Esta (etiqueta|resposta))/.test(
          mensagem,
        )
          ? mensagem
          : 'Não foi possível confirmar a alteração. Tente de novo.',
      )
    } finally {
      envio.current = false
      setSalvando(false)
    }
  }
  return (
    <Janela
      pequena
      titulo={titulo}
      onClose={() => {
        if (!envio.current) fechar()
      }}
      rodape={
        <Acao
          tipo={apagar ? 'warn' : 'primary'}
          type="submit"
          form="form-catalogo"
          disabled={salvando}
        >
          {apagar ? 'Apagar' : 'Salvar'}
        </Acao>
      }
    >
      <form
        id="form-catalogo"
        className="formgrid"
        onSubmit={(e) => {
          e.preventDefault()
          void salvar()
        }}
      >
        {apagar ? (
          <p>
            {etiqueta
              ? `Apagar a etiqueta “${nome}” também a remove dos contatos.`
              : `Apagar a resposta rápida ${atalho}?`}
          </p>
        ) : etiqueta ? (
          <>
            <label htmlFor="catalogo-nome">
              Nome
              <Input
                id="catalogo-nome"
                required
                maxLength={80}
                value={nome}
                onChange={(e) => setNome(e.target.value)}
              />
            </label>
            <label htmlFor="catalogo-cor">
              Cor
              <Input
                id="catalogo-cor"
                type="color"
                value={cor}
                onChange={(e) => setCor(e.target.value)}
              />
            </label>
          </>
        ) : (
          <>
            <label htmlFor="catalogo-atalho">
              Atalho
              <Input
                id="catalogo-atalho"
                required
                placeholder="/ola"
                maxLength={50}
                value={atalho}
                onChange={(e) => setAtalho(e.target.value)}
              />
            </label>
            <label htmlFor="catalogo-texto">
              Texto
              <Textarea
                id="catalogo-texto"
                required
                rows={4}
                maxLength={16000}
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
              />
            </label>
          </>
        )}
        {edicao.tipo === 'respostas' && edicao.item && !apagar && (
          <Acao
            tipo="ghost"
            type="button"
            disabled={salvando}
            onClick={() => {
              setErro('')
              setApagar(true)
            }}
          >
            <Trash2 size={16} />
            Apagar resposta
          </Acao>
        )}
        {erro && <p role="alert">{erro}</p>}
      </form>
    </Janela>
  )
}

export function Etiquetas({ criando, fechar }: Props) {
  const { session } = rota.useRouteContext()
  const { data } = useSuspenseQuery(etiquetasGestaoQuery(session.user.id))
  const [edicao, editar] = useState<Dialogo | null>(null)
  const alvo = criando ? { tipo: 'etiquetas' as const } : edicao
  return (
    <>
      {data.length === 0 ? (
        <p className="empty-list">Nenhuma etiqueta cadastrada.</p>
      ) : (
        <div className="card">
          {data.map((e) => (
            <div className="lrow" key={e.id}>
              <EtiquetaCarteira etiqueta={e} />
              <div className="nm" />
              <span className="sub tnum">
                {e.contatos} {e.contatos === 1 ? 'contato' : 'contatos'}
              </span>
              <IconeBotao
                nome={`Renomear ${e.nome}`}
                onClick={() => editar({ tipo: 'etiquetas', item: e })}
              >
                <Pencil size={16} />
              </IconeBotao>
              <IconeBotao
                nome={`Apagar ${e.nome}`}
                onClick={() =>
                  editar({ tipo: 'etiquetas', item: e, apagar: true })
                }
              >
                <Trash2 size={16} />
              </IconeBotao>
            </div>
          ))}
        </div>
      )}
      {alvo && (
        <Formulario
          edicao={alvo}
          fechar={() => {
            editar(null)
            fechar()
          }}
        />
      )}
    </>
  )
}

export function Respostas({ criando, fechar }: Props) {
  const { session } = rota.useRouteContext()
  const { data } = useSuspenseQuery(respostasQuery(session.user.id))
  const [edicao, editar] = useState<Dialogo | null>(null)
  const alvo = criando ? { tipo: 'respostas' as const } : edicao
  return (
    <>
      {data.length === 0 ? (
        <p className="empty-list">Nenhuma resposta rápida cadastrada.</p>
      ) : (
        <div className="card">
          {data.map((r) => (
            <div className="lrow" key={r.id}>
              <span className="mono break-all">{r.atalho}</span>
              <div className="nm resposta whitespace-pre-wrap wrap-anywhere">
                {r.texto}
              </div>
              <IconeBotao
                nome={`Editar ${r.atalho}`}
                onClick={() => editar({ tipo: 'respostas', item: r })}
              >
                <Pencil size={16} />
              </IconeBotao>
            </div>
          ))}
        </div>
      )}
      {alvo && (
        <Formulario
          edicao={alvo}
          fechar={() => {
            editar(null)
            fechar()
          }}
        />
      )}
    </>
  )
}
