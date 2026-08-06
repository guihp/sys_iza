import { describe, expect, it } from 'vitest'
import { estadoDoGoogle } from '@/app/(app)/configuracoes/google/estado'

/**
 * A tela precisa dizer "ligada" exatamente quando a sincronia vai acontecer, e
 * precisa fazer isso sem carregar a chave privada para o HTML.
 */
describe('estadoDoGoogle', () => {
  const completo = {
    GOOGLE_SERVICE_ACCOUNT_EMAIL: 'agenda@x.iam.gserviceaccount.com',
    GOOGLE_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n',
    GOOGLE_CALENDAR_ID: 'izadora@clinicaizadora.com.br',
  }

  it('está desligada quando não há credencial', () => {
    expect(estadoDoGoogle({})).toEqual({ ligada: false })
  })

  it('está desligada quando falta qualquer uma das três', () => {
    for (const faltante of Object.keys(completo)) {
      expect(estadoDoGoogle({ ...completo, [faltante]: undefined }), faltante).toEqual({
        ligada: false,
      })
    }
  })

  it('mostra a agenda e a conta de serviço, nunca a chave privada', () => {
    const estado = estadoDoGoogle(completo)
    expect(estado).toEqual({
      ligada: true,
      contaDeServico: 'agenda@x.iam.gserviceaccount.com',
      calendarId: 'izadora@clinicaizadora.com.br',
    })
    expect(JSON.stringify(estado)).not.toContain('PRIVATE KEY')
  })
})
