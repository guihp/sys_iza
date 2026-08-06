# Sistema Clínica Izadora — Design

**Data:** 2026-08-05
**Cliente:** Dra. Izadora Barros — CRO SP 173735
**Domínio:** Harmonização Orofacial (HOF)

## 1. Objetivo

Substituir a ficha de papel e o controle manual de pacientes por um sistema web único que cobre:

- Prontuário eletrônico completo (as 6 páginas da ficha atual)
- CRM de leads até paciente recorrente
- Agenda de consultas
- Lembretes automáticos por WhatsApp e e-mail
- Inbox de conversas do WhatsApp (alimentada pelo n8n)
- Fotos clínicas com comparador antes/depois
- Financeiro com cálculo de imposto e lucro real

Critério de sucesso: a clínica opera um dia inteiro de atendimento sem tocar em papel, exceto a ficha impressa que o paciente assina.

## 2. Decisões tomadas

| Tema | Decisão |
|---|---|
| Usuários | Apenas equipe da clínica (Dra. + secretária). Paciente não tem login. |
| Hospedagem | VPS própria (já roda n8n e Evolution) + Supabase |
| Chat | n8n recebe e a IA atende; grava em tabelas do sistema. O sistema lê e envia pela Evolution. |
| Lembretes | WhatsApp + e-mail, disparados direto pelo sistema na Evolution |
| Prontuário | Digital, impresso para assinatura à caneta |
| Ficha impressa | Redesenho premium mantendo a identidade visual atual |
| Fotos | Galeria + comparador antes/depois com barra deslizante |
| Funil | Lead → Contato → Agendado → Compareceu → Paciente → Retorno |
| Agenda | Completa, com sincronia opcional com Google Calendar |
| Permissões | Secretária lê o prontuário mas não edita |
| Financeiro | Completo, incluindo impostos e lucro real |
| Tema | Claro e escuro, alternável |
| Primeira entrega | Fundação + CRM + Agenda + Lembretes |

## 3. Arquitetura

### 3.1 Stack

- **Front + API:** Next.js 15 (App Router), TypeScript, Tailwind CSS, shadcn/ui
- **Banco / Auth / Storage:** Supabase (Postgres, RLS, Realtime, buckets privados)
- **Infra:** Docker Compose na VPS, mesma rede interna do n8n e da Evolution
- **E-mail:** Resend
- **PDF:** Playwright (Chromium headless) renderizando HTML com CSS de impressão

Alternativas descartadas: Vercel (obrigaria expor a Evolution na internet pública e não sustenta o worker contínuo de lembretes); Postgres cru sem Supabase (perderia RLS, Auth e Storage prontos).

### 3.2 Processos

| Serviço | Responsabilidade |
|---|---|
| `web` | Interface e rotas de API do Next.js |
| `worker` | Cron a cada 5 min: apura lembretes vencidos, dispara, registra resultado |
| `pdf` | Chromium headless para gerar as fichas em PDF |

### 3.3 Fluxo do chat

```
Paciente → WhatsApp → Evolution → n8n (IA atende) → INSERT em wa_messages
                                                          ↓ Supabase Realtime
                              Inbox do sistema ─ envia → Evolution API → Paciente
                                                          ↓
                                                    INSERT outbound
```

O sistema define o schema; o n8n é produtor. Envio sempre pelo backend — a API key da Evolution nunca chega ao browser. Mensagens enviadas pelo sistema entram na mesma tabela, mantendo um histórico único por contato.

Vínculo mensagem↔paciente por número de telefone normalizado (E.164). Número desconhecido cria um lead automaticamente no estágio "Lead".

## 4. Modelo de dados

### 4.1 Pessoas e acesso

- `profiles` — usuário da equipe, papel (`dra` | `secretaria`), vinculado ao Supabase Auth
- `patients` — pessoa única em todo o ciclo, com `stage` (lead | contato | agendado | compareceu | paciente | retorno | descartado), `lead_source` (o campo "Como me conheceu" da ficha), dados pessoais, contato de emergência, profissão, consentimento LGPD
- `audit_log` — append-only: ator, ação, entidade, registro, IP, timestamp

Uma tabela só para lead e paciente, sem conversão: o lead que vira paciente mantém histórico, mensagens e origem.

### 4.2 Clínico

- `anamneses` — queixa principal, escala de autoconfiança 0–10, procedimentos estéticos prévios, tratamento médico atual, medicação contínua, alergias, doenças, gestação/amamentação, hábitos (fumo, álcool, água, exercício, alimentação, sono), perfil de pele declarado, uso de ácidos e retinoides, reações prévias, médicos assistentes
- `skin_assessments` — pigmentação, alterações vasculares, lesões, cicatrizes, biótipo, hidratação, espessura, fototipo Fitzpatrick I–VI, cor da pele, textura, grau de acne, Glogau, tipo de rugas; e o exame físico: estado geral, peso, altura, frequência cardíaca, pressão arterial, ritmo respiratório, marcha, músculos da mastigação
- `botox_plans` + `botox_plan_items` — músculo, diluição por seringa, quantidade de unidades, total de unidades
- `filler_plans` + `filler_plan_items` — produto, região, camada, técnica, quantidade em ml
- `attendance_records` — data da aplicação, região tratada, produto utilizado, quantidade/unidades, lote, evolução e intercorrências, assinatura do paciente e do cirurgião-dentista
- `consents` — termo de consentimento com versão do texto, PDF assinado escaneado

### 4.3 Produtos e rastreabilidade

- `products` — nome comercial, marca, tipo (toxina | preenchedor | bioestimulador | outro)
- `product_batches` — lote ou número de série, data de validade, quantidade

Lote entra por seleção de um cadastro, não por digitação livre a cada atendimento. O sistema alerta lote vencido ou perto de vencer.

### 4.4 Agenda e CRM

- `procedures` — catálogo: nome, duração em minutos, preço, `default_return_interval_days`
- `appointments` — paciente, procedimento, início, fim, status (agendado | confirmado | compareceu | faltou | cancelado), origem
- `reminder_jobs` — fila de lembretes, com chave de idempotência
- `google_calendar_links` — vínculo opcional evento↔consulta

### 4.5 Retorno (3 níveis)

O retorno é configurável em três níveis, do mais genérico ao mais específico:

1. **Padrão do procedimento** — `procedures.default_return_interval_days`, editável nas configurações
2. **Ajuste no atendimento** — ao registrar o procedimento como realizado, `attendance_records.return_due_date` já vem preenchido com o padrão e a Dra. altera para aquele paciente, informando dias ou escolhendo a data no calendário
3. **Sem retorno** — a Dra. desmarca o retorno quando não se aplica

O valor definido no atendimento sempre vence o padrão do catálogo.

Estados derivados de `return_due_date`:

- **em dia** — faltam mais de 30 dias
- **vencendo** — faltam 30 dias ou menos; o paciente aparece na coluna Retorno do kanban
- **vencido** — a data passou; sobe ao topo da fila

### 4.6 Fotos e arquivos

- `photo_sessions` — data, consulta relacionada, observação
- `photos` — ângulo (frontal | perfil direito | perfil esquerdo | oblíquo | detalhe), caminho no bucket, sessão
- `patient_files` — documentos, exames, termos assinados escaneados

Comparador antes/depois: o usuário escolhe duas fotos quaisquer da galeria e uma barra vertical arrastável revela uma sobre a outra. O sistema sugere pares do mesmo ângulo em datas diferentes.

### 4.7 Chat

- `wa_contacts` — telefone E.164, nome do perfil, vínculo com `patients`, última mensagem
- `wa_messages` — contato, direção (in | out), tipo (texto | imagem | áudio | documento), conteúdo, mídia, timestamp, id da Evolution, autor (paciente | ia | equipe)

Escrito pelo n8n, lido pelo sistema. O contrato de escrita será documentado e entregue junto do SQL.

### 4.8 Financeiro

- `quotes` + `quote_items` — orçamento por paciente, impresso junto do termo de consentimento
- `payments` — parcelas, forma de pagamento, status (pago | pendente | atrasado)
- `expenses` — despesas, incluindo custo de produto
- `payroll` — folha, necessária para o fator R
- `tax_settings` — regime tributário e parâmetros

Cálculo de imposto: Simples Nacional com **fator R automático** (folha dos últimos 12 meses ÷ receita bruta dos últimos 12 meses). Fator R ≥ 28% aplica o Anexo III; abaixo disso, o Anexo V. O sistema mostra a alíquota efetiva do mês e alerta ao se aproximar da faixa seguinte. Existe também o modo de percentual fixo, caso a contadora prefira.

Lucro real = receita − custo de produto − despesas − imposto.

## 5. Lembretes

| Gatilho | Momento | Canal | Conteúdo |
|---|---|---|---|
| Confirmação | D-1 às 09h | WhatsApp + e-mail | Pede confirmação de presença; a resposta cai no chat |
| Véspera curta | 3h antes | WhatsApp | Lembrete curto contra falta |
| Pós-procedimento | +24h | WhatsApp | Orientações de cuidado do procedimento realizado |
| Avaliação | +7 dias | WhatsApp | Pergunta a evolução e pede avaliação |
| Retorno | 7 dias antes do vencimento | WhatsApp + e-mail | Mensagem de reativação |

Regras do worker:

- **Idempotência** — chave única por (consulta, tipo de lembrete). Reinício do worker nunca duplica envio.
- **Janela de silêncio** — nada entre 21h e 08h; o que cair nesse intervalo é reagendado para as 09h do dia seguinte.
- **Opt-out** — por paciente e por canal.
- **Registro** — toda tentativa grava status, resposta da API e erro.
- **Templates** — editáveis pela Dra., com variáveis de paciente, procedimento, data e hora.

## 6. Segurança

Prontuário é dado pessoal sensível pela LGPD (Art. 11) e o CFO exige guarda por 20 anos. Os controles abaixo são requisitos, não opcionais.

- **Autenticação:** Supabase Auth com e-mail e senha, MFA por TOTP opcional, expiração de sessão por inatividade.
- **Autorização:** Row Level Security no banco, não apenas na interface. A secretária tem policy de `SELECT` no prontuário e nenhuma de `INSERT` ou `UPDATE` — uma tentativa de burlar pelo cliente é recusada pelo próprio Postgres.
- **Auditoria:** toda leitura e escrita de prontuário grava ator, ação, registro, IP e timestamp em `audit_log`, que é append-only.
- **Arquivos:** bucket privado no Supabase Storage. Fotos clínicas são servidas apenas por URL assinada de validade curta, nunca por link público.
- **Segredos:** a API key da Evolution, a chave do provedor de e-mail e a `service_role` do Supabase existem somente em variáveis de ambiente do servidor. Nenhuma delas pode aparecer em código executado no browser.
- **Transporte:** HTTPS obrigatório; a Evolution permanece na rede interna, sem porta exposta.
- **Backup:** o backup automático do Supabase precisa estar confirmado como ativo antes de qualquer dado real de paciente entrar no sistema.

## 7. Design

Duas variações da mesma identidade, alternáveis pelo usuário:

- **Claro:** fundo off-white `#FDFBF9`, texto `#2E2A28`, acento rosé `#C99`, tipografia serifada nos títulos e sans limpa no corpo, muito espaço em branco
- **Escuro:** fundo grafite `#14110F`, texto `#EDE7E1`, acento dourado `#C8A97E` — realça melhor as fotos clínicas

A ficha impressa é um redesenho premium: mantém o cabeçalho "Dra. Izadora Barros — CRO SP 173735" e a paleta delicada, mas com tipografia e grid refeitos para melhor legibilidade e aproveitamento de página.

## 8. Fases de implementação

| Fase | Escopo |
|---|---|
| **0 — Fundação** | Docker Compose na VPS, schema completo, Supabase Auth, policies de RLS, audit log, design system claro/escuro, layout base |
| **1 — CRM + Agenda + Lembretes** | Kanban de 6 estágios, agenda com detecção de conflito, Google Calendar opcional, catálogo de procedimentos, worker dos 5 gatilhos, fila de retorno em 3 níveis |
| **2 — Chat** | Inbox ao vivo lendo o que o n8n grava, envio pela Evolution, vínculo mensagem↔paciente, criação automática de lead |
| **3 — Prontuário + Fotos + PDF** | As 6 páginas da ficha, produtos com lote e validade, galeria, comparador antes/depois, geração do PDF premium |
| **4 — Financeiro** | Orçamento impresso com o termo, parcelas, despesas, fator R e imposto, dashboard de lucro real |

As fases 0 e 1 são entregues juntas: a fase 1 não roda sem a fundação.

## 9. Pendências do cliente

Necessário antes de começar a codificar:

1. URL do projeto Supabase, `anon key` e `service_role key`
2. URL da Evolution API, API key e nome da instância
3. Acesso à VPS (SSH) e definição do domínio
4. Conta no Resend e domínio verificado para e-mail
5. Confirmação de que o backup automático do Supabase está ativo

Necessário durante a fase 4:

6. Regime tributário confirmado pela contadora (o sistema já sai com fator R automático como padrão)

## 10. Fora de escopo

- Portal de acesso para o paciente
- Multi-clínica / SaaS
- Assinatura digital ICP-Brasil
- Ligação de voz automática
- Aplicativo nativo (o sistema é responsivo e funciona no celular pelo navegador)
