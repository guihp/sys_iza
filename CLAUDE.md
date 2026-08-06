# Antes de qualquer coisa, leia `ESTADO.md`

`ESTADO.md`, na raiz deste repositório, é o documento de passagem de bastão: o
que o sistema é, o que já funciona, o que está travado e por quem, as armadilhas
que já custaram tempo, e as decisões que não devem ser reabertas.

**Leia ele antes de escrever código, planejar ou opinar sobre este projeto.** Ele
aponta para os planos e specs de cada frente.

Três coisas que quebram na primeira tentativa se você não souber:

- O middleware é `app/src/proxy.ts` (Next **16**, não 15). `middleware.ts` está
  deprecado e ter os dois é erro de build.
- Arquivo `'use server'` só exporta função async. Constante nele quebra o build.
- `pnpm test:db` roda contra o banco de **produção** e suja o `audit_log`, que é
  append-only. Sempre com filtro de arquivo.

Migrations: quem escreve o código cria o arquivo e **avisa**; quem aplica é o
dono. Nunca rode `supabase db push`.
