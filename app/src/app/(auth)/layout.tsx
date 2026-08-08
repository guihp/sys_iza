/**
 * Grupo `(auth)`. Fontes Cormorant/Jost já vêm do root layout
 * (`--font-login-serif` / `--font-login-sans`); aqui só o contêiner.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <div className="h-full">{children}</div>
}
