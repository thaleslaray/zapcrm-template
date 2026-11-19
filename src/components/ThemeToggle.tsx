import { Moon, Sun } from 'lucide-react'
import { useTheme } from 'next-themes'
import { useEffect, useState } from 'react'

export default function ThemeToggle({
  comTexto = false,
}: {
  comTexto?: boolean
}) {
  const { resolvedTheme, setTheme } = useTheme()
  const [montado, setMontado] = useState(false)
  useEffect(() => setMontado(true), [])
  const escuro = montado && resolvedTheme === 'dark'
  const nome = escuro ? 'Mudar para o modo claro' : 'Mudar para o modo escuro'
  const Icone = escuro ? Sun : Moon
  return (
    <button
      type="button"
      className={comTexto ? 'li' : 'rail-btn'}
      aria-label={nome}
      title={nome}
      onClick={() => setTheme(escuro ? 'light' : 'dark')}
    >
      <Icone size={21} aria-hidden />
      {comTexto && (
        <>
          Tema escuro
          <span className={escuro ? 'switch on' : 'switch'} />
        </>
      )}
    </button>
  )
}
