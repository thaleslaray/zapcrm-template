import { setResponseStatus } from '@tanstack/react-start/server'

export function exigirLogin(): never {
  setResponseStatus(401)
  throw new Error('Entre para acessar a equipe.')
}
