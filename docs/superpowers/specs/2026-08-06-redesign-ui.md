# Redesign da interface — spec visual

Extraído dos mockups aprovados pelo Gui em 2026-08-06. **Os mockups são imagens
que não estão disponíveis para quem implementa** — este documento é a única
fonte. Onde ele for omisso, siga o padrão já estabelecido no projeto e registre
a decisão no relatório, em vez de inventar em silêncio.

Regra geral: o desenho é **editorial e sóbrio**. Serifada nos títulos e em todo
número que importa, sem-serifa em rótulo e texto de apoio, muito espaço em
branco, borda fina em tudo, nenhuma sombra pesada, nenhum gradiente.

---

## 1. Tokens

`app/src/app/globals.css` já tem a estrutura de tema (claro/escuro por
`data-tema`). **Mantenha o mecanismo** — só ajuste valores e acrescente tokens.

### Claro (é o tema dos mockups)

| Token | Valor | Uso |
|---|---|---|
| `--color-fundo` | `#F7F4F0` | fundo da página e da sidebar |
| `--color-superficie` | `#FFFFFF` | cartão, linha de tabela, campo |
| `--color-superficie-2` | `#FCFAF7` | contêiner de coluna do kanban, caixa de prévia |
| `--color-texto` | `#2E2A28` | texto principal |
| `--color-texto-suave` | `#8A8078` | rótulo, legenda, texto de apoio |
| `--color-acento` | `#B8935F` | rótulo de seção, número em destaque, ponto ativo |
| `--color-acento-suave` | `#EFE3D4` | preenchimento de bloco da agenda, chip |
| `--color-linha` | `#E8E1DA` | toda borda |
| `--color-solido` | `#1A1614` | botão primário (fundo) |
| `--color-solido-texto` | `#FAF7F3` | botão primário (texto) |
| `--color-alerta` | `#B8935F` | "58 dias em atraso" |

**A cor de acento muda de rosa (`#C09999`) para dourado (`#B8935F`).** Os
mockups são dourados; o rosa atual não aparece em lugar nenhum.

### Escuro

Mantenha os valores atuais (`#14110F` / `#EDE7E1` / `#C8A97E` / `#2C2622` /
`#1C1815`) e derive os tokens novos na mesma chave: `--color-superficie-2`
levemente acima da superfície, `--color-solido` claro com texto escuro
(inverte), `--color-acento-suave` como dourado a ~15% sobre o fundo.

### Tipografia

- `--font-serif`: manter Georgia. Usada em: título de página, nome de paciente,
  nome de procedimento, número de KPI, valor monetário grande, título de coluna
  do kanban, dia do mês na agenda.
- Sem-serifa (padrão do sistema): todo o resto.
- **Rótulo miúdo** — o padrão mais repetido do desenho: `text-[10px]`,
  `uppercase`, `tracking-[0.12em]`, cor `texto-suave`. Usado em cabeçalho de
  tabela, rótulo de KPI, "GESTÃO", "MENSAGEM", "COMO A PACIENTE RECEBE".
- **Rótulo de seção da página**: mesmo estilo, mas cor `acento`
  ("PIPELINE CLÍNICO", "SEMANA CLÍNICA", "REATIVAÇÃO", "CATÁLOGO CLÍNICO",
  "AUTOMAÇÃO").

### Forma

- Raio de cartão e de campo: `12px`. Raio de botão e de chip: **pílula total**.
- Borda: sempre `1px solid var(--color-linha)`. Sem sombra em nenhum elemento.
- Respiro entre blocos: `24px`. Dentro de cartão: `16px`.

---

## 2. Primitivas

Crie em `app/src/components/ui/` como componentes tipados e reutilizáveis. Toda
página abaixo depende deles; não repita estilo solto.

- **`<Pilula>`** — três variantes:
  - `solida`: fundo `solido`, texto `solido-texto`, uppercase, `text-[11px]`,
    `tracking-[0.1em]`, padding `10px 20px`. Ex.: NOVO LEAD, HOJE, WhatsApp,
    NOVO PROCEDIMENTO.
  - `contorno`: fundo transparente, borda `linha`, texto `texto`. Ex.: ESCURO,
    Semana anterior, Editar, Desativar, Agendar, Desligar envio.
  - `suave`: fundo `superficie-2`, sem borda, texto `texto-suave`. Ex.: SALVO.
- **`<Cartao>`** — superfície branca, borda, raio 12.
- **`<RotuloMiudo>`** — o rótulo uppercase descrito acima.
- **`<Kpi>`** — rótulo miúdo em cima, número serifado `text-[32px]` no meio,
  sublegenda `text-[11px]` suave embaixo. Alinhado à esquerda dentro da própria
  coluna. Aparecem em linha de 3, à direita do cabeçalho da página.
- **`<Avatar>`** — círculo 32px, fundo `acento-suave`, iniciais em
  `text-[11px]` cor `acento`. Duas letras, do primeiro e do último nome.
- **`<Tabela>`** — cabeçalho com rótulo miúdo e borda embaixo; linhas separadas
  por borda; sem zebra; última linha sem borda.
- **`<EstadoVazio>`** — **importante**: o banco está vazio e vai continuar
  vazio. Toda lista, coluna, tabela e grade precisa de um estado vazio decente:
  uma frase curta em `texto-suave`, centralizada, e quando fizer sentido um
  botão de ação. Nunca deixe área em branco sem explicação. Os KPIs mostram
  `0` ou `—`, nunca `NaN` nem esqueleto de carregamento eterno.

---

## 3. Casca (`app-shell.tsx`)

Layout de duas colunas ocupando a viewport inteira.

### Sidebar — largura fixa `256px`

**Precisa ser fixa na tela: hoje ela rola junto com o conteúdo, e é bug
relatado.** Use `h-screen sticky top-0` na coluna (ou `fixed` + `padding-left`
no conteúdo), com `overflow-y-auto` só no miolo da navegação. Ao rolar a página,
a sidebar não se move.

Fundo `fundo`, borda à direita `linha`. De cima para baixo:

1. Filete dourado horizontal, `40px × 2px`, cor `acento`, margem embaixo `16px`.
2. `Dra. Izadora Barros` — serifada, `text-[22px]`, `leading-tight`.
3. `ESTÉTICA AVANÇADA · CRO SP 173735` — rótulo miúdo, quebra em duas linhas.
4. Espaço `32px`.
5. `GESTÃO` — rótulo miúdo.
6. Itens de navegação, `8px` entre eles. Cada item:
   - ponto de `6px` à esquerda (`texto-suave` inativo, `acento` ativo),
   - rótulo `text-[14px]`,
   - contador à direita, `text-[11px]`, `texto-suave` — **omitido quando zero**,
   - **ativo**: fundo `superficie`, borda `linha`, raio 12, padding `10px 14px`.
   - Ordem: Funil, Agenda, Retornos, Procedimentos, Mensagens, Google Agenda.
   - `Procedimentos`, `Mensagens` e `Google Agenda` continuam **exclusivos da
     `dra`** — a regra de papel de `itensDeNavegacao(role)` não muda.
   - Contadores: Funil = leads ativos (todos menos `paciente` e `descartado`);
     Agenda = consultas de hoje, rotulada `N hoje`; Retornos = vencidos;
     Mensagens = templates ativos.
7. Empurrado para o rodapé (`mt-auto`):
   - **Cartão de meta**: `Cartao`, dentro — `META DO MÊS` (rótulo miúdo),
     valor serifado `text-[28px]`, barra de progresso `4px` (trilho `linha`,
     preenchimento `acento`), e `68% alcançado · 9 dias restantes` em
     `text-[11px]` suave. Com o banco vazio: `R$ 0`, barra zerada,
     `0% alcançado · N dias restantes`.
   - **Rodapé de usuário**: `Avatar` + nome + papel por extenso
     (`dra` → "Doutora", `secretaria` → "Secretária") em `text-[11px]` suave.

### Barra superior do conteúdo

Altura ~`72px`, borda embaixo `linha`, `24px` de padding lateral.

- **Busca** à esquerda: campo pílula, borda `linha`, fundo `superficie`,
  largura ~`290px`, ícone de círculo `12px` à esquerda, placeholder
  `Buscar paciente, telefone ou procedimento`.
  Busca em nome, telefone (comparando **normalizado em E.164**, para
  `(11) 98765-4321` achar quem está gravado como `+5511987654321`) e nome de
  procedimento. Resultado em painel flutuante abaixo do campo, agrupado por
  tipo. Sem resultado: "Nada encontrado para …".
- **À direita**, nesta ordem: data de hoje por extenso e capitalizada
  (`Quinta, 6 de agosto`, fuso da clínica, via `datetime.ts`); `Pilula contorno`
  de tema com rótulo `ESCURO` no claro e `CLARO` no escuro (reaproveite o
  `theme-toggle` existente, só troque a aparência); `Pilula solida` **NOVO
  LEAD**, que abre o formulário de novo paciente.

### Cabeçalho de página (repete em toda tela)

Bloco à esquerda: rótulo de seção em `acento`; título serifado `text-[40px]`;
descrição em `texto-suave`, `max-w-[52ch]`.
Bloco à direita: linha de 3 `<Kpi>`, `48px` entre eles, alinhado ao topo.

---

## 4. Telas

### 4.1 Dashboard — rota nova `/` (destino do login)

**Hoje o login manda para `/crm`; passa a mandar para `/`.** Ajuste o
`redirect` da raiz e o destino pós-login.

- Rótulo `VISÃO GERAL`, título `Bom dia, Dra. Izadora` — a saudação varia com a
  hora no fuso da clínica (bom dia < 12h, boa tarde < 18h, boa noite).
  Descrição: resumo do dia.
- KPIs do cabeçalho: `ATENDIMENTOS HOJE`, `LEADS ATIVOS`, `RETORNOS VENCIDOS`.
- Corpo, em duas colunas (`2fr 1fr`):
  - **Agenda de hoje** — lista das consultas de hoje: horário, `Avatar`, nome,
    procedimento, status. Vazio: "Nenhuma consulta hoje."
  - **Precisa de atenção** — retornos vencidos, no máximo 5, com botão
    `Agendar`. Vazio: "Nenhum retorno vencido."
  - Abaixo, largura cheia: **Funil resumido** — os 7 estágios como barra
    horizontal proporcional, com contagem. Vazio: barra apagada e
    "Nenhuma paciente cadastrada ainda."

### 4.2 Funil — `/crm`

Rótulo `PIPELINE CLÍNICO`, título `Funil de pacientes`, descrição:
"Arraste o cartão para mudar o estágio. Leads que não seguiram adiante vão para
Descartado — o prontuário do paciente permanece salvo."
KPIs: `LEADS ATIVOS` (+N esta semana), `CONVERSÃO` (lead → paciente),
`TICKET MÉDIO` (últimos 30 dias).

- Colunas em rolagem horizontal, largura `300px`, `20px` entre elas.
  **A rolagem horizontal é só da faixa de colunas** — o cabeçalho da página e a
  sidebar não se movem.
- Contêiner da coluna: fundo `superficie-2`, borda, raio 12, padding 16.
- Cabeçalho da coluna: ponto + nome serifado `text-[17px]` + contagem em chip
  suave à direita; abaixo, `R$ X em potencial` em `text-[11px]` suave (soma do
  preço do procedimento de interesse das pacientes da coluna).
- Cartão: `Cartao`, padding 14, `10px` entre cartões. Dentro: `Avatar` + nome
  serifado + origem (`lead_source`) em rótulo miúdo; procedimento serifado
  `text-[15px]`; rodapé com preço e tempo relativo (`há 2 h`, `há 3 dias`,
  `ontem`) em `text-[11px]` suave. Sem procedimento definido: `A definir`.
- Arrasto continua funcionando, e o `<select>` "Mover para" continua existindo —
  **não remova**: a API de arrasto do HTML não funciona em toque nem por
  teclado, e a Dra. usa tablet.
- Coluna vazia: "Nenhuma paciente neste estágio."

### 4.3 Agenda — `/agenda`

Rótulo `SEMANA CLÍNICA`, título `Agenda`, descrição:
"Clique num horário livre para marcar. Horário ocupado ou fora do expediente é
recusado com o motivo — a conferência acontece no servidor, não só na tela."
KPIs: `ATENDIMENTOS` (nesta semana), `OCUPAÇÃO` (% da grade útil), `HOJE`
(na cadeira).

- Linha de navegação: `Pilula contorno` "← Semana anterior", `Pilula solida`
  "HOJE", `Pilula contorno` "Próxima semana →". À direita, o intervalo por
  extenso: `3 de agosto a 9 de agosto de 2026`.
- Grade de 7 colunas (segunda a domingo) + coluna de horas à esquerda (`64px`).
  Cabeçalho: nome do dia em rótulo miúdo, data serifada `text-[15px]`.
  **Coluna de hoje** com fundo `acento-suave` a ~40% no cabeçalho e na grade.
  Domingo e faixas fora do expediente: fundo levemente mais escuro que o fundo.
- Linhas de hora de 08:00 a 20:00, altura `68px` por hora, borda entre elas.
- Bloco de consulta: posicionado e dimensionado pelo horário real, fundo
  `acento-suave`, borda `#D9C4A8`, raio 8, padding 8. Dentro: `08:00 — 10:00`
  em `text-[10px]` suave, nome serifado `text-[13px]`, procedimento
  `text-[11px]` suave.
- **Legenda no rodapé**, sempre visível: três amostras quadradas de `10px` com
  rótulo — `Atendimento confirmado`, `Horário livre`, `Fora do expediente`.
- **Cadastro pela agenda (pedido explícito):** clicar num horário livre abre um
  painel lateral que permite **tanto escolher paciente existente quanto criar
  uma nova ali mesmo** (nome, telefone, origem), escolher procedimento e
  confirmar. Criar a paciente e a consulta tem que ser uma coisa só do ponto de
  vista de quem usa: se a consulta falhar por conflito, **a paciente recém
  criada não pode ficar órfã** — ou as duas acontecem, ou nenhuma. Trate isso
  explicitamente e escreva teste; se precisar de função no Postgres para a
  atomicidade, escreva a migration e avise.
  O conflito de horário continua sendo decidido no servidor pelo domínio que já
  existe, e a mensagem de recusa aparece no painel.
- Semana vazia: a grade aparece normalmente, só sem blocos.

### 4.4 Retornos — `/retornos`

Rótulo `REATIVAÇÃO`, título `Retornos`, descrição:
"Quem já passou do retorno e quem vence nos próximos 30 dias. Conta o
atendimento mais recente de cada paciente — quem voltou sai da lista sozinho."
KPIs: `VENCIDOS` (aguardando contato), `PRÓXIMOS 30 DIAS` (a vencer),
`CONTATADAS` (nesta rodada).

- Filtros em chip: `vencidos N`, `a vencer N`, `todos N`. O ativo é
  `Pilula contorno` com borda e texto `acento` e ponto à esquerda; os outros,
  suaves. Estado na URL (`?filtro=vencidos`), para recarregar não perder.
- Tabela — colunas `PACIENTE`, `ÚLTIMO PROCEDIMENTO`, `ATENDIDA EM`, `RETORNO`,
  e ações à direita sem rótulo:
  - Paciente: `Avatar` + nome serifado + telefone formatado `(11) 98277-9034`.
  - Último procedimento: nome serifado + `ciclo de 5 meses` suave (derivado do
    intervalo de retorno em dias: < 60 dias mostra em dias, senão em meses
    arredondados).
  - Atendida em: `9 jan 26`.
  - Retorno: `58 dias em atraso` em `alerta` quando vencido, ou
    `vence em 12 dias` em `texto-suave`; abaixo, `previsto 9 jun 26` em
    `text-[11px]` suave.
  - Ações: `Pilula solida` **WhatsApp** e `Pilula contorno` **Agendar**.
    O WhatsApp abre `https://wa.me/<E.164 sem +>` em aba nova, com texto
    pré-preenchido a partir do template `retorno`/`whatsapp` já renderizado.
    **Ele não dispara envio pela Evolution** — é a secretária falando na mão.
    Deixe isso claro no `title` do botão.
- Vazio: "Ninguém para reativar agora." com a explicação de que a fila enche
  sozinha conforme os atendimentos vencem.

### 4.5 Procedimentos — `/configuracoes/procedimentos`

Rótulo `CATÁLOGO CLÍNICO`, título `Procedimentos`, descrição:
"Duração e preço padrão de cada procedimento, e em quantos dias ele gera um
retorno. Procedimento sem retorno não entra na fila de reativação."
KPIs: `ATIVOS` (no catálogo), `TICKET MÉDIO` (preço padrão),
`GERAM RETORNO` (alimentam reativação).

- **Coluna nova `categoria`** na tabela `procedures` — texto, opcional. Aparece
  sob o nome, em rótulo miúdo. Valores dos mockups: Diagnóstico, Injetáveis,
  Bioestimulação, Hidratação profunda, Sustentação, Rejuvenescimento.
  Escreva a migration `0009_*.sql` e **avise; não aplique**.
- Tabela — `PROCEDIMENTO`, `DURAÇÃO`, `PREÇO`, `RETORNO`, ações:
  - Nome serifado `text-[17px]` + categoria embaixo.
  - Duração `60 min`. Preço `R$ 1.800,00`, e `Sem custo` quando zero.
  - Retorno: ponto `acento` + `120 dias`; sem retorno, ponto apagado +
    `Sem retorno` em suave.
  - Ações: `Editar` e `Desativar`, ambos `Pilula contorno`.
- Rodapé da tabela, dentro do mesmo cartão: à esquerda, em `texto-suave`,
  "Novos procedimentos aparecem no funil e na agenda imediatamente."; à direita,
  `Pilula solida` **NOVO PROCEDIMENTO**.
- O catálogo semeado tem 4 itens; os mockups mostram 7. **Não semeie os outros
  3** — a decisão foi banco vazio. A tela tem que ficar correta com 4.

### 4.6 Mensagens — `/configuracoes/mensagens`

Rótulo `AUTOMAÇÃO`, título `Mensagens`, descrição — reproduza literalmente,
inclusive o `{{nome}}` colorido em `acento` no meio da frase:
"O texto de cada lembrete automático. Escreva `{{nome}}` onde o nome da paciente
deve entrar — a prévia mostra como a mensagem chega. Para parar um envio, use
Desligar: o texto fica guardado."

Duas colunas (`320px` + resto), `24px` de intervalo.

- **Esquerda** — rótulo miúdo `GATILHOS` e a lista dos 5, em cartão cada:
  título serifado `text-[17px]`, badge `ATIVO`/`DESLIGADO` em rótulo miúdo cor
  `acento` no canto superior direito, descrição em `text-[12px]` suave, e os
  canais em `text-[11px]` suave (`WhatsApp · E-mail`).
  Selecionado: borda `acento` e fundo `superficie`.
  Títulos e descrições exatos:
  | Gatilho | Título | Descrição | Canais |
  |---|---|---|---|
  | `confirmacao` | Confirmação da véspera | Às 09:00 do dia anterior à consulta. | WhatsApp · E-mail |
  | `vespera_curta` | Lembrete do dia | Três horas antes da consulta. Só WhatsApp — e-mail não chega a tempo. | WhatsApp |
  | `pos_procedimento` | Cuidados pós-procedimento | 24 horas depois do atendimento registrado. | WhatsApp |
  | `avaliacao` | Como está o resultado | Sete dias depois do atendimento. | WhatsApp |
  | `retorno` | Retorno chegando | Sete dias antes do vencimento do retorno. | WhatsApp · E-mail |
- **Direita** — um bloco por canal do gatilho selecionado. Cada bloco:
  - cabeçalho: ponto + nome do canal serifado `text-[20px]`, e
    `Pilula contorno` **Desligar envio** / **Ligar envio** à direita;
  - só para e-mail: rótulo `ASSUNTO` + campo de uma linha;
  - rótulo `MENSAGEM` + textarea de ~5 linhas, raio 12, borda;
  - linha `Variáveis:` seguida de chips clicáveis que inserem no cursor —
    apenas as variáveis que **aquele gatilho** realmente recebe;
  - caixa de prévia: fundo `acento-suave`, raio 12, rótulo miúdo
    `COMO A PACIENTE RECEBE` e, abaixo, o texto renderizado com dados de
    exemplo. No e-mail, assunto em cima em negrito e corpo embaixo;
  - rodapé: `Pilula suave` com `SALVO` / `SALVAR` e a frase
    "Texto sincronizado com os envios." em `text-[11px]` suave.
- Mantenha o que a Task 13 já fez de validação e aviso de variável desconhecida
  — só re-vista.

### 4.7 Google Agenda — `/configuracoes/google`

Só re-vista com o desenho novo. **A troca para OAuth ficou para depois**
(decisão do Gui em 2026-08-06); o conteúdo continua sendo estado + instruções.

---

## 5. Restrições que continuam valendo

- Next **16.3.0**; middleware é `src/proxy.ts`. Arquivo `'use server'` só
  exporta função async — constante e helper puro vão em módulo separado.
- Tailwind **v4** (tokens por `@theme`, sem `tailwind.config.js`).
- Interface toda em **português do Brasil**. Fuso `America/Sao_Paulo` sempre via
  `src/lib/datetime.ts`.
- Papéis são exatamente `dra` e `secretaria`. Prontuário é só leitura para a
  secretária. Telas de configuração são exclusivas da `dra`, com `notFound()` na
  rota e o item ausente do menu.
- Nenhum segredo no browser; só `NEXT_PUBLIC_*`.
- `pnpm`, nunca `npm install`.
- `pnpm test`, `pnpm exec tsc --noEmit`, `pnpm lint` e `pnpm build` passando
  antes de cada commit. Hoje são **397 testes offline** — nenhum pode quebrar.
- Migration nova: escrever o arquivo e **avisar**, nunca aplicar.
- O `theme-toggle` usa `useSyncExternalStore` de propósito: `useState` +
  `useEffect` quebra a regra `react-hooks/set-state-in-effect` do lint. Não
  "simplifique" de volta.

## 6. Acessibilidade — não é opcional

- Toda ação é `<button>` ou `<a>` de verdade, alcançável por teclado, com foco
  visível (anel `acento`).
- O arrasto do kanban **sempre** tem o equivalente por `<select>`.
- Contraste mínimo AA: `texto-suave` sobre `fundo` precisa passar; se não
  passar, escureça o token em vez de aceitar.
- Ícone sozinho leva `aria-label`. Erro vai em `role="alert"`, confirmação em
  `role="status"`.
