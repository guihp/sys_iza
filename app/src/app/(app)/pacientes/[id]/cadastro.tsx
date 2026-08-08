'use client'

import { useState, useTransition } from 'react'
import { idadeEmAnos } from '@/domain/clinical/prontuario'
import { formatarTelefone } from '@/lib/phone'
import { BOTAO_PRINCIPAL, CAMPO } from '../campos'
import { salvarCadastro } from './acoes-cadastro'
import type { PacienteCadastro } from './tipos'

/**
 * Cadastro — pág. 1 identificação. Equipe inteira edita (policy 0004).
 */
export function FormularioCadastro({
  paciente,
  hojeISO,
}: {
  paciente: PacienteCadastro
  hojeISO: string
}) {
  const [erro, setErro] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [pendente, iniciar] = useTransition()
  const [nascimento, setNascimento] = useState(paciente.nascimento ?? '')

  const idade = nascimento ? idadeEmAnos(nascimento, hojeISO) : null

  return (
    <form
      className="space-y-6"
      onSubmit={(evento) => {
        evento.preventDefault()
        setErro(null)
        setOk(null)
        const dados = new FormData(evento.currentTarget)
        iniciar(async () => {
          const resultado = await salvarCadastro(dados)
          if (!resultado.ok) {
            setErro(resultado.erro)
            return
          }
          setOk('Cadastro salvo.')
        })
      }}
    >
      <input type="hidden" name="pacienteId" value={paciente.id} />

      {erro ? (
        <p role="alert" className="rounded-lg border border-red-600/40 bg-red-500/10 px-3 py-2 text-sm text-red-700">
          {erro}
        </p>
      ) : null}
      {ok ? (
        <p role="status" className="rounded-lg border border-emerald-600/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700">
          {ok}
        </p>
      ) : null}

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 font-serif text-lg sm:col-span-2">Identificação</legend>

        <label className="block space-y-1 sm:col-span-2">
          <span className="text-sm text-texto/80">Nome completo</span>
          <input name="nome_completo" required defaultValue={paciente.nome_completo} className={CAMPO} />
        </label>

        <label className="block space-y-1">
          <span className="text-sm text-texto/80">Como prefere ser chamado(a)</span>
          <input
            name="como_prefere_ser_chamado"
            defaultValue={paciente.como_prefere_ser_chamado ?? ''}
            className={CAMPO}
          />
        </label>

        <label className="block space-y-1">
          <span className="text-sm text-texto/80">Data de nascimento</span>
          <input
            name="nascimento"
            type="date"
            value={nascimento}
            onChange={(e) => setNascimento(e.target.value)}
            className={CAMPO}
          />
          {idade != null ? (
            <span className="block text-xs text-texto/50">{idade} anos</span>
          ) : null}
        </label>

        <label className="block space-y-1">
          <span className="text-sm text-texto/80">Sexo</span>
          <select name="sexo" defaultValue={paciente.sexo ?? ''} className={CAMPO}>
            <option value="">Não informado</option>
            <option value="feminino">Feminino</option>
            <option value="masculino">Masculino</option>
            <option value="outro">Outro</option>
          </select>
        </label>

        <label className="block space-y-1">
          <span className="text-sm text-texto/80">Telefone</span>
          <input
            name="telefone"
            defaultValue={paciente.telefone ? formatarTelefone(paciente.telefone) : ''}
            placeholder="(11) 98765-4321"
            className={CAMPO}
          />
        </label>

        <label className="block space-y-1">
          <span className="text-sm text-texto/80">CPF</span>
          <input name="cpf" defaultValue={paciente.cpf ?? ''} className={CAMPO} />
        </label>

        <label className="block space-y-1">
          <span className="text-sm text-texto/80">Nacionalidade</span>
          <input name="nacionalidade" defaultValue={paciente.nacionalidade ?? ''} className={CAMPO} />
        </label>

        <label className="block space-y-1">
          <span className="text-sm text-texto/80">Naturalidade</span>
          <input name="naturalidade" defaultValue={paciente.naturalidade ?? ''} className={CAMPO} />
        </label>

        <label className="block space-y-1">
          <span className="text-sm text-texto/80">E-mail</span>
          <input
            name="email"
            type="email"
            defaultValue={paciente.email ?? ''}
            className={CAMPO}
          />
        </label>

        <label className="block space-y-1">
          <span className="text-sm text-texto/80">Profissão</span>
          <input name="profissao" defaultValue={paciente.profissao ?? ''} className={CAMPO} />
        </label>

        <label className="block space-y-1 sm:col-span-2">
          <span className="text-sm text-texto/80">Endereço</span>
          <input name="endereco" defaultValue={paciente.endereco ?? ''} className={CAMPO} />
        </label>

        <label className="block space-y-1 sm:col-span-2">
          <span className="text-sm text-texto/80">Como me conheceu</span>
          <input name="lead_source" defaultValue={paciente.lead_source ?? ''} className={CAMPO} />
        </label>
      </fieldset>

      <fieldset className="grid gap-4 md:grid-cols-3">
        <legend className="mb-2 font-serif text-lg md:col-span-3">Contato de emergência</legend>
        <label className="block space-y-1">
          <span className="text-sm text-texto/80">Nome</span>
          <input
            name="contato_emergencia_nome"
            defaultValue={paciente.contato_emergencia_nome ?? ''}
            className={CAMPO}
          />
        </label>
        <label className="block space-y-1">
          <span className="text-sm text-texto/80">Parentesco</span>
          <input
            name="contato_emergencia_parentesco"
            defaultValue={paciente.contato_emergencia_parentesco ?? ''}
            className={CAMPO}
          />
        </label>
        <label className="block space-y-1">
          <span className="text-sm text-texto/80">Telefone</span>
          <input
            name="contato_emergencia_telefone"
            defaultValue={paciente.contato_emergencia_telefone ?? ''}
            className={CAMPO}
          />
        </label>
      </fieldset>

      <label className="block space-y-1">
        <span className="text-sm text-texto/80">Observações de cadastro</span>
        <textarea
          name="observacoes"
          rows={3}
          defaultValue={paciente.observacoes ?? ''}
          className={CAMPO}
        />
      </label>

      <div className="flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            name="aceita_whatsapp"
            defaultChecked={paciente.aceita_whatsapp}
            className="size-4 accent-acento"
          />
          Aceita WhatsApp
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            name="aceita_email"
            defaultChecked={paciente.aceita_email}
            className="size-4 accent-acento"
          />
          Aceita e-mail
        </label>
      </div>

      <button type="submit" disabled={pendente} className={BOTAO_PRINCIPAL}>
        {pendente ? 'Salvando…' : 'Salvar cadastro'}
      </button>
    </form>
  )
}
