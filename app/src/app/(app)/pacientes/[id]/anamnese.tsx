'use client'

import { useRef, type ReactNode } from 'react'
import { StatusAutosave } from '@/components/ui/status-autosave'
import { useAutosaveForm } from '@/hooks/use-autosave'
import { CAMPO } from '../campos'
import { salvarAnamnese } from './acoes-clinico'
import type { AnamneseLinha } from './tipos'

function Check({
  name,
  label,
  defaultChecked,
}: {
  name: string
  label: string
  defaultChecked?: boolean
}) {
  return (
    <label className="flex items-center gap-2 text-sm text-texto/80">
      <input
        type="checkbox"
        name={name}
        defaultChecked={defaultChecked}
        className="size-4 accent-acento"
      />
      {label}
    </label>
  )
}

function Grupo({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <fieldset className="space-y-3 rounded-xl border border-linha p-4">
      <legend className="px-1 font-serif text-lg">{titulo}</legend>
      {children}
    </fieldset>
  )
}

function SimNao({
  name,
  label,
  valor,
}: {
  name: string
  label: string
  valor: boolean | null | undefined
}) {
  const atual =
    valor === true ? 'sim' : valor === false ? 'nao' : ''
  return (
    <label className="block space-y-1">
      <span className="text-sm text-texto/80">{label}</span>
      <select name={name} defaultValue={atual} className={CAMPO}>
        <option value="">Não informado</option>
        <option value="sim">Sim</option>
        <option value="nao">Não</option>
      </select>
    </label>
  )
}

/**
 * Anamnese completa — págs. 1–2 do PDF. Só a Dra. grava.
 * Autosave com debounce (~400ms) após cada alteração.
 */
export function FormularioAnamnese({
  pacienteId,
  anamnese,
  somenteLeitura,
}: {
  pacienteId: string
  anamnese: AnamneseLinha | null
  somenteLeitura: boolean
}) {
  const formRef = useRef<HTMLFormElement>(null)
  const a = anamnese

  const { status, erro, marcarAlterado } = useAutosaveForm({
    enabled: !somenteLeitura,
    save: async () => {
      if (!formRef.current) {
        return { ok: false, erro: 'Formulário indisponível para salvar.' }
      }
      return salvarAnamnese(new FormData(formRef.current))
    },
  })

  if (somenteLeitura) {
    return (
      <p className="rounded-xl border border-linha p-4 text-sm text-texto/60">
        A anamnese é preenchida somente pela Dra. Aqui você consulta o que já foi
        registrado.
        {!a ? ' Ainda não há anamnese nesta ficha.' : null}
      </p>
    )
  }

  return (
    <form
      ref={formRef}
      className="space-y-6"
      onSubmit={(evento) => evento.preventDefault()}
      onChange={marcarAlterado}
    >
      <input type="hidden" name="pacienteId" value={pacienteId} />

      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-texto/50">Alterações são salvas automaticamente.</p>
        <StatusAutosave status={status} erro={erro} />
      </div>

      {erro && status === 'error' ? (
        <p role="alert" className="rounded-lg border border-red-600/40 bg-red-500/10 px-3 py-2 text-sm text-red-700">
          {erro}
        </p>
      ) : null}

      <Grupo titulo="Queixa e motivação">
        <label className="block space-y-1">
          <span className="text-sm text-texto/80">Queixa principal / o que trouxe hoje</span>
          <textarea
            name="queixa_principal"
            rows={3}
            defaultValue={a?.queixa_principal ?? ''}
            className={CAMPO}
          />
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block space-y-1">
            <span className="text-sm text-texto/80">
              Impacto na autoconfiança{' '}
              <span className="text-texto/50">(ex.: 0–10 ou notas)</span>
            </span>
            <input
              name="autoconfianca_rosto"
              type="text"
              defaultValue={a?.autoconfianca_rosto ?? ''}
              className={CAMPO}
            />
          </label>
          <SimNao
            name="rosto_cansado"
            label="Rosto parece cansado mesmo dormindo bem?"
            valor={a?.rosto_cansado}
          />
        </div>
        <label className="block space-y-1">
          <span className="text-sm text-texto/80">O que mais incomoda no rosto</span>
          <textarea
            name="incomodo_rosto"
            rows={2}
            defaultValue={a?.incomodo_rosto ?? ''}
            className={CAMPO}
          />
        </label>
      </Grupo>

      <Grupo titulo="Procedimentos estéticos prévios">
        <div className="grid gap-2 sm:grid-cols-2">
          <Check name="prev_botox" label="Botox / toxina" defaultChecked={a?.prev_botox} />
          <Check
            name="prev_acido_hialuronico"
            label="Ácido hialurônico"
            defaultChecked={a?.prev_acido_hialuronico}
          />
          <Check
            name="prev_bioestimulador"
            label="Bioestimulador"
            defaultChecked={a?.prev_bioestimulador}
          />
          <Check name="prev_fios" label="Fios" defaultChecked={a?.prev_fios} />
          <Check name="prev_pmma" label="PMMA" defaultChecked={a?.prev_pmma} />
          <Check name="prev_cirurgia" label="Cirurgia" defaultChecked={a?.prev_cirurgia} />
          <Check name="prev_outros" label="Outros" defaultChecked={a?.prev_outros} />
        </div>
        <label className="block space-y-1">
          <span className="text-sm text-texto/80">Outros (detalhe)</span>
          <input name="prev_outros_texto" defaultValue={a?.prev_outros_texto ?? ''} className={CAMPO} />
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block space-y-1">
            <span className="text-sm text-texto/80">Último procedimento</span>
            <input
              name="ultimo_procedimento"
              defaultValue={a?.ultimo_procedimento ?? ''}
              className={CAMPO}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-sm text-texto/80">Região do último procedimento</span>
            <input
              name="ultimo_procedimento_regiao"
              defaultValue={a?.ultimo_procedimento_regiao ?? ''}
              className={CAMPO}
            />
          </label>
        </div>
      </Grupo>

      <Grupo titulo="Histórico médico">
        <label className="block space-y-1">
          <span className="text-sm text-texto/80">Tratamento médico atual</span>
          <textarea
            name="tratamento_medico_atual"
            rows={2}
            defaultValue={a?.tratamento_medico_atual ?? ''}
            className={CAMPO}
          />
        </label>
        <label className="block space-y-1">
          <span className="text-sm text-texto/80">
            Medicação contínua (incl. anticoncepcional / suplementos)
          </span>
          <textarea
            name="medicacao_continua"
            rows={2}
            defaultValue={a?.medicacao_continua ?? ''}
            className={CAMPO}
          />
        </label>
        <label className="block space-y-1">
          <span className="text-sm text-texto/80">
            Alergias (medicamentos, látex, metais, picada de abelha, outras)
          </span>
          <textarea name="alergias" rows={2} defaultValue={a?.alergias ?? ''} className={CAMPO} />
        </label>
      </Grupo>

      <Grupo titulo="Doenças">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <Check name="doenca_diabetes" label="Diabetes" defaultChecked={a?.doenca_diabetes} />
          <Check
            name="doenca_hipertensao"
            label="Hipertensão"
            defaultChecked={a?.doenca_hipertensao}
          />
          <Check name="doenca_cardiaca" label="Cardíaca" defaultChecked={a?.doenca_cardiaca} />
          <Check name="doenca_autoimune" label="Autoimune" defaultChecked={a?.doenca_autoimune} />
          <Check name="doenca_tireoide" label="Tireoide" defaultChecked={a?.doenca_tireoide} />
          <Check name="doenca_hepatica" label="Hepática" defaultChecked={a?.doenca_hepatica} />
          <Check name="doenca_renal" label="Renal" defaultChecked={a?.doenca_renal} />
          <Check
            name="doenca_coagulacao"
            label="Coagulação"
            defaultChecked={a?.doenca_coagulacao}
          />
          <Check
            name="doenca_osteoporose"
            label="Osteoporose"
            defaultChecked={a?.doenca_osteoporose}
          />
          <Check
            name="doenca_asma_bronquite"
            label="Asma / bronquite"
            defaultChecked={a?.doenca_asma_bronquite}
          />
          <Check name="doenca_epilepsia" label="Epilepsia" defaultChecked={a?.doenca_epilepsia} />
          <Check name="doenca_cancer" label="Câncer" defaultChecked={a?.doenca_cancer} />
          <Check name="doenca_outra" label="Outra" defaultChecked={a?.doenca_outra} />
        </div>
        <label className="block space-y-1">
          <span className="text-sm text-texto/80">Outra doença (detalhe)</span>
          <input
            name="doenca_outra_texto"
            defaultValue={a?.doenca_outra_texto ?? ''}
            className={CAMPO}
          />
        </label>
      </Grupo>

      <Grupo titulo="Hábitos e pele declarada">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block space-y-1">
            <span className="text-sm text-texto/80">Gestante ou amamentando</span>
            <select
              name="gestacao_amamentacao"
              defaultValue={a?.gestacao_amamentacao ?? ''}
              className={CAMPO}
            >
              <option value="">Não informado</option>
              <option value="nao">Não</option>
              <option value="gestante">Gestante</option>
              <option value="amamentando">Amamentando</option>
            </select>
          </label>
          <SimNao name="fuma" label="Fuma" valor={a?.fuma} />
          <SimNao name="alcool_frequente" label="Álcool frequente" valor={a?.alcool_frequente} />
          <label className="block space-y-1">
            <span className="text-sm text-texto/80">Sono</span>
            <select name="sono" defaultValue={a?.sono ?? ''} className={CAMPO}>
              <option value="">Não informado</option>
              <option value="bom">Bom</option>
              <option value="regular">Regular</option>
              <option value="ruim">Ruim</option>
            </select>
          </label>
          <label className="block space-y-1">
            <span className="text-sm text-texto/80">Pele declarada</span>
            <select name="pele_declarada" defaultValue={a?.pele_declarada ?? ''} className={CAMPO}>
              <option value="">Não informado</option>
              <option value="seca">Seca</option>
              <option value="oleosa">Oleosa</option>
              <option value="mista">Mista</option>
              <option value="sensivel">Sensível</option>
            </select>
          </label>
        </div>
        <label className="block space-y-1">
          <span className="text-sm text-texto/80">Ingere água com frequência</span>
          <input name="ingere_agua" defaultValue={a?.ingere_agua ?? ''} className={CAMPO} />
        </label>
        <label className="block space-y-1">
          <span className="text-sm text-texto/80">Exercícios físicos</span>
          <input
            name="exercicios_fisicos"
            defaultValue={a?.exercicios_fisicos ?? ''}
            className={CAMPO}
          />
        </label>
        <label className="block space-y-1">
          <span className="text-sm text-texto/80">Boa alimentação</span>
          <input
            name="boa_alimentacao"
            defaultValue={a?.boa_alimentacao ?? ''}
            className={CAMPO}
          />
        </label>
      </Grupo>

      <Grupo titulo="O que mais incomoda na pele">
        <div className="grid gap-2 sm:grid-cols-2">
          <Check name="incomoda_flacidez" label="Flacidez" defaultChecked={a?.incomoda_flacidez} />
          <Check name="incomoda_linhas" label="Linhas" defaultChecked={a?.incomoda_linhas} />
          <Check name="incomoda_manchas" label="Manchas" defaultChecked={a?.incomoda_manchas} />
          <Check name="incomoda_poros" label="Poros" defaultChecked={a?.incomoda_poros} />
          <Check
            name="incomoda_falta_vico"
            label="Falta de viço"
            defaultChecked={a?.incomoda_falta_vico}
          />
          <Check name="incomoda_outro" label="Outro" defaultChecked={a?.incomoda_outro} />
        </div>
        <label className="block space-y-1">
          <span className="text-sm text-texto/80">Outro (detalhe)</span>
          <input
            name="incomoda_outro_texto"
            defaultValue={a?.incomoda_outro_texto ?? ''}
            className={CAMPO}
          />
        </label>
      </Grupo>

      <Grupo titulo="Cuidados e reações">
        <div className="grid gap-4 sm:grid-cols-2">
          <SimNao
            name="protetor_solar_diario"
            label="Protetor solar diário"
            valor={a?.protetor_solar_diario}
          />
          <SimNao
            name="roacutan_retinoides"
            label="Roacutan / retinoides"
            valor={a?.roacutan_retinoides}
          />
          <SimNao
            name="reacao_cosmeticos_procedimentos"
            label="Reação a cosméticos ou procedimentos"
            valor={a?.reacao_cosmeticos_procedimentos}
          />
        </div>
        <label className="block space-y-1">
          <span className="text-sm text-texto/80">Ácidos / fórmulas / cosméticos prescritos</span>
          <textarea
            name="acidos_cosmeticos"
            rows={2}
            defaultValue={a?.acidos_cosmeticos ?? ''}
            className={CAMPO}
          />
        </label>
        <label className="block space-y-1">
          <span className="text-sm text-texto/80">Detalhe da reação (se Sim)</span>
          <textarea
            name="reacao_detalhe"
            rows={2}
            defaultValue={a?.reacao_detalhe ?? ''}
            className={CAMPO}
          />
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block space-y-1">
            <span className="text-sm text-texto/80">Médico(s) assistente(s) — nome</span>
            <input
              name="medico_assistente_nome"
              defaultValue={a?.medico_assistente_nome ?? ''}
              className={CAMPO}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-sm text-texto/80">Telefone do médico</span>
            <input
              name="medico_assistente_telefone"
              defaultValue={a?.medico_assistente_telefone ?? ''}
              className={CAMPO}
            />
          </label>
        </div>
      </Grupo>
    </form>
  )
}
