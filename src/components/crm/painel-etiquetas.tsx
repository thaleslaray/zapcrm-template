import { useQueryClient } from '@tanstack/react-query'
import { Plus, X } from 'lucide-react'
import { useRef, useState } from 'react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import type { PainelCarteira } from '#/lib/carteira-leitura-tipos'
import { alterarCatalogoFn } from '#/lib/catalogos-fns'
import { invalidarCatalogo } from '#/lib/catalogos-queries'
import { EtiquetaCarteira } from './carteira-pecas'

export function PainelEtiquetas({ dados }: { dados: PainelCarteira }) {
  const cache = useQueryClient()
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState('')
  const enviando = useRef(false)
  const restantes = dados.etiquetas.filter(
    (e) => !dados.etiquetasContato.some((atual) => atual.id === e.id),
  )
  async function vincular(id: string, presente: boolean) {
    if (enviando.current) return
    enviando.current = true
    setOcupado(true)
    setErro('')
    try {
      await alterarCatalogoFn({
        data: {
          tipo: 'vincularEtiqueta',
          id,
          contatoId: dados.contato.id,
          presente,
        },
      })
      await invalidarCatalogo(cache, 'etiquetas')
    } catch {
      setErro('Não foi possível confirmar a alteração. Tente de novo.')
    } finally {
      enviando.current = false
      setOcupado(false)
    }
  }
  return (
    <div className="pbloc">
      <div className="plabel">Etiquetas</div>
      <div className="tags">
        {dados.etiquetasContato.map((e) => (
          <EtiquetaCarteira key={e.id} etiqueta={e}>
            <button
              type="button"
              disabled={ocupado}
              aria-label={`Remover etiqueta ${e.nome}`}
              onClick={() => void vincular(e.id, false)}
            >
              <X size={12} />
            </button>
          </EtiquetaCarteira>
        ))}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="addtag"
              aria-label="Adicionar etiqueta"
              disabled={ocupado}
            >
              <Plus size={14} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuLabel>Adicionar etiqueta</DropdownMenuLabel>
            {restantes.map((e) => (
              <DropdownMenuItem
                key={e.id}
                onSelect={() => void vincular(e.id, true)}
              >
                <EtiquetaCarteira etiqueta={e} />
              </DropdownMenuItem>
            ))}
            {!restantes.length && (
              <DropdownMenuItem disabled>
                Nenhuma etiqueta disponível.
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {erro && <p role="alert">{erro}</p>}
    </div>
  )
}
