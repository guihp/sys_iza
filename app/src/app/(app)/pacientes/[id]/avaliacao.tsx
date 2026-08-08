'use client'

import { useState, useTransition, type ReactNode } from 'react'
import { BOTAO_PRINCIPAL, CAMPO } from '../campos'
import { salvarAvaliacao } from './acoes-clinico'
import type { AvaliacaoLinha } from './tipos'

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

/**
 * Avaliação de pele + exame físico — pág. 3. Só a Dra. grava.
 */
export function FormularioAvaliacao({
  pacienteId,
  avaliacao,
  somenteLeitura,
}: {
  pacienteId: string
  avaliacao: AvaliacaoLinha | null
  somenteLeitura: boolean
}) {
  const [erro, setErro] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [pendente, iniciar] = useTransition()
  const a = avaliacao

  if (somenteLeitura) {
    return (
      <p className="rounded-xl border border-linha p-4 text-sm text-texto/60">
        A avaliação é preenchida somente pela Dra.
        {!a ? ' Ainda não há avaliação nesta ficha.' : null}
      </p>
    )
  }

  return (
    <form
      className="space-y-6"
      onSubmit={(evento) => {
        evento.preventDefault()
        setErro(null)
        setOk(null)
        iniciar(async () => {
          const resultado = await salvarAvaliacao(new FormData(evento.currentTarget))
          if (!resultado.ok) {
            setErro(resultado.erro)
            return
          }
          setOk('Avaliação salva.')
        })
      }}
    >
      <input type="hidden" name="pacienteId" value={pacienteId} />

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

      <Grupo titulo="Pigmentação">
        <div className="grid gap-2 sm:grid-cols-3">
          <Check name="pig_melasma_manchas" label="Melasma / manchas" defaultChecked={a?.pig_melasma_manchas} />
          <Check name="pig_hipopigmentacao" label="Hipopigmentação" defaultChecked={a?.pig_hipopigmentacao} />
          <Check name="pig_sardas" label="Sardas" defaultChecked={a?.pig_sardas} />
        </div>
      </Grupo>

      <Grupo titulo="Vasculares">
        <div className="grid gap-2 sm:grid-cols-3">
          <Check name="vas_eritema" label="Eritema" defaultChecked={a?.vas_eritema} />
          <Check name="vas_telangiectasias" label="Telangiectasias" defaultChecked={a?.vas_telangiectasias} />
          <Check name="vas_hematoma" label="Hematoma" defaultChecked={a?.vas_hematoma} />
        </div>
      </Grupo>

      <Grupo titulo="Lesões">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <Check name="les_acne" label="Acne" defaultChecked={a?.les_acne} />
          <Check name="les_comedoes" label="Comedões" defaultChecked={a?.les_comedoes} />
          <Check name="les_verrugas" label="Verrugas" defaultChecked={a?.les_verrugas} />
          <Check name="les_nodulos" label="Nódulos" defaultChecked={a?.les_nodulos} />
          <Check name="les_feridas_ulceras" label="Feridas / úlceras" defaultChecked={a?.les_feridas_ulceras} />
          <Check name="les_descamacao" label="Descamação" defaultChecked={a?.les_descamacao} />
        </div>
      </Grupo>

      <Grupo titulo="Cicatrizes">
        <div className="grid gap-2 sm:grid-cols-3">
          <Check name="cic_atrofica" label="Atrófica" defaultChecked={a?.cic_atrofica} />
          <Check name="cic_hipertrofica" label="Hipertrófica" defaultChecked={a?.cic_hipertrofica} />
          <Check name="cic_queloide" label="Quelóide" defaultChecked={a?.cic_queloide} />
        </div>
      </Grupo>

      <Grupo titulo="Classificação da pele">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <label className="block space-y-1">
            <span className="text-sm text-texto/80">Biótipo</span>
            <select name="biotipo" defaultValue={a?.biotipo ?? ''} className={CAMPO}>
              <option value="">—</option>
              <option value="normal">Normal</option>
              <option value="seca">Seca</option>
              <option value="oleosa">Oleosa</option>
              <option value="mista">Mista</option>
            </select>
          </label>
          <label className="block space-y-1">
            <span className="text-sm text-texto/80">Hidratação</span>
            <select name="hidratacao" defaultValue={a?.hidratacao ?? ''} className={CAMPO}>
              <option value="">—</option>
              <option value="adequada">Adequada</option>
              <option value="desidratada">Desidratada</option>
            </select>
          </label>
          <label className="block space-y-1">
            <span className="text-sm text-texto/80">Espessura</span>
            <select name="espessura" defaultValue={a?.espessura ?? ''} className={CAMPO}>
              <option value="">—</option>
              <option value="fina">Fina</option>
              <option value="normal">Normal</option>
              <option value="espessa">Espessa</option>
            </select>
          </label>
          <label className="block space-y-1">
            <span className="text-sm text-texto/80">Fototipo Fitzpatrick</span>
            <select name="fototipo" defaultValue={a?.fototipo ?? ''} className={CAMPO}>
              <option value="">—</option>
              {['I', 'II', 'III', 'IV', 'V', 'VI'].map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-1">
            <span className="text-sm text-texto/80">Cor da pele</span>
            <select name="cor_pele" defaultValue={a?.cor_pele ?? ''} className={CAMPO}>
              <option value="">—</option>
              <option value="branca">Branca</option>
              <option value="parda">Parda</option>
              <option value="preta">Preta</option>
            </select>
          </label>
          <label className="block space-y-1">
            <span className="text-sm text-texto/80">Acne</span>
            <select name="acne" defaultValue={a?.acne ?? ''} className={CAMPO}>
              <option value="">—</option>
              <option value="ausente">Ausente</option>
              <option value="I">Grau I</option>
              <option value="II">Grau II</option>
              <option value="III">Grau III</option>
            </select>
          </label>
          <label className="block space-y-1">
            <span className="text-sm text-texto/80">Glogau</span>
            <select name="glogau" defaultValue={a?.glogau ?? ''} className={CAMPO}>
              <option value="">—</option>
              <option value="leve">Leve</option>
              <option value="moderado">Moderado</option>
              <option value="avancado">Avançado</option>
              <option value="severo">Severo</option>
            </select>
          </label>
        </div>
      </Grupo>

      <Grupo titulo="Textura">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <Check name="textura_lisa" label="Lisa" defaultChecked={a?.textura_lisa} />
          <Check name="textura_aspera" label="Áspera" defaultChecked={a?.textura_aspera} />
          <Check name="textura_flacida" label="Flácida" defaultChecked={a?.textura_flacida} />
          <Check name="textura_rugas_finas" label="Rugas finas" defaultChecked={a?.textura_rugas_finas} />
        </div>
      </Grupo>

      <Grupo titulo="Rugas">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <Check name="rugas_dinamicas" label="Dinâmicas" defaultChecked={a?.rugas_dinamicas} />
          <Check name="rugas_estaticas" label="Estáticas" defaultChecked={a?.rugas_estaticas} />
          <Check name="rugas_superficiais" label="Superficiais" defaultChecked={a?.rugas_superficiais} />
          <Check name="rugas_profundas" label="Profundas" defaultChecked={a?.rugas_profundas} />
        </div>
      </Grupo>

      <Grupo titulo="Exame físico">
        <label className="block space-y-1">
          <span className="text-sm text-texto/80">Estado geral</span>
          <textarea name="estado_geral" rows={2} defaultValue={a?.estado_geral ?? ''} className={CAMPO} />
        </label>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block space-y-1">
            <span className="text-sm text-texto/80">Peso (kg)</span>
            <input
              name="peso_kg"
              type="number"
              min={0}
              step="0.1"
              defaultValue={a?.peso_kg ?? ''}
              className={CAMPO}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-sm text-texto/80">Altura (m)</span>
            <input
              name="altura_m"
              type="number"
              min={0}
              step="0.01"
              defaultValue={a?.altura_m ?? ''}
              className={CAMPO}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-sm text-texto/80">FC (bpm)</span>
            <input
              name="fc_bpm"
              type="number"
              min={0}
              step={1}
              defaultValue={a?.fc_bpm ?? ''}
              className={CAMPO}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-sm text-texto/80">PA (mmHg)</span>
            <input name="pa_mmhg" defaultValue={a?.pa_mmhg ?? ''} placeholder="120/80" className={CAMPO} />
          </label>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block space-y-1">
            <span className="text-sm text-texto/80">Ritmo / volume respiratório</span>
            <input
              name="ritmo_respiratorio"
              defaultValue={a?.ritmo_respiratorio ?? ''}
              className={CAMPO}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-sm text-texto/80">Andar</span>
            <select name="marcha" defaultValue={a?.marcha ?? ''} className={CAMPO}>
              <option value="">—</option>
              <option value="normal">Normal</option>
              <option value="dificuldade">Dificuldade</option>
              <option value="cadeirante">Cadeirante</option>
            </select>
          </label>
        </div>
        <label className="block space-y-1">
          <span className="text-sm text-texto/80">Músculos da mastigação</span>
          <textarea
            name="musculos_mastigacao"
            rows={2}
            defaultValue={a?.musculos_mastigacao ?? ''}
            className={CAMPO}
          />
        </label>
      </Grupo>

      <button type="submit" disabled={pendente} className={BOTAO_PRINCIPAL}>
        {pendente ? 'Salvando…' : 'Salvar avaliação'}
      </button>
    </form>
  )
}
