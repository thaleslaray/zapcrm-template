import { LogOut } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { authClient } from '#/lib/auth-client'

export function Sair() {
  const [saindo, setSaindo] = useState(false)
  async function sair() {
    setSaindo(true)
    try {
      const resultado = await authClient.signOut()
      if (resultado.error) throw new Error()
      window.location.assign('/login')
    } catch {
      setSaindo(false)
      toast.error('Não foi possível sair. Tente de novo.')
    }
  }
  return (
    <button className="li" type="button" disabled={saindo} onClick={sair}>
      <LogOut size={20} />
      {saindo ? 'Saindo…' : 'Sair'}
    </button>
  )
}
