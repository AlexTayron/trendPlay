import Link from 'next/link';

export const metadata = {
  title: 'Termos de Uso · DevCore',
  description: 'Termos de uso da plataforma de estudos DevCore.',
};

export default function TermosPage() {
  return (
    <div className="min-h-screen bg-surface text-on-surface">
      <header className="border-b border-outline-variant/20 bg-surface/90 backdrop-blur-xl sticky top-0 z-30">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <span className="material-symbols-outlined text-primary text-[24px]">terminal</span>
            <span className="text-lg font-bold tracking-tight">DevCore</span>
          </Link>
          <Link
            href="/"
            className="text-xs font-medium text-on-surface-variant hover:text-white flex items-center gap-1"
          >
            <span className="material-symbols-outlined text-[16px]">arrow_back</span>
            <span>Voltar ao início</span>
          </Link>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-10 sm:py-14 space-y-8">
        <div>
          <span className="text-xs font-mono uppercase tracking-wider text-secondary">
            Condições de Uso
          </span>
          <h1 className="text-2xl sm:text-4xl font-extrabold text-white mt-1">Termos de Uso</h1>
          <p className="text-xs text-outline mt-2">Última atualização: Novembro de 2026</p>
        </div>

        <section className="space-y-3 text-sm text-slate-300 leading-relaxed">
          <h2 className="text-base font-bold text-white">1. Finalidade da Plataforma</h2>
          <p>
            O DevCore é uma plataforma pessoal de organização e estudo que permite ao usuário
            conectar sua própria conta Google para organizar e assistir aos seus próprios cursos
            armazenados no Google Drive ou em playlists do YouTube, com recursos de progresso,
            anotações, leitura de materiais e Tutor IA.
          </p>
        </section>

        <section className="space-y-3 text-sm text-slate-300 leading-relaxed">
          <h2 className="text-base font-bold text-white">2. Responsabilidade sobre o Conteúdo</h2>
          <p>
            O DevCore não hospeda nem distribui cursos de terceiros. Todo conteúdo importado a
            partir do Google Drive ou YouTube é selecionado exclusivamente pelo usuário em sua
            própria conta, sendo o usuário o único responsável pela titularidade ou autorização de
            uso dos arquivos acessados.
          </p>
        </section>

        <section className="space-y-3 text-sm text-slate-300 leading-relaxed">
          <h2 className="text-base font-bold text-white">3. Acesso Exclusivo por Conta Google</h2>
          <p>
            A autenticação é realizada exclusivamente via Google OAuth 2.0. Cada usuário é
            responsável por manter a segurança da sua conta Google e pode encerrar ou revogar a
            integração a qualquer momento.
          </p>
        </section>
      </main>
    </div>
  );
}
