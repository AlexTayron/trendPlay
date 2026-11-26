import Link from 'next/link';

export const metadata = {
  title: 'Política de Privacidade · DevCore',
  description: 'Como o DevCore protege os dados da sua conta Google e do seu Google Drive.',
};

export default function PrivacidadePage() {
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
            Privacidade &amp; Segurança
          </span>
          <h1 className="text-2xl sm:text-4xl font-extrabold text-white mt-1">
            Política de Privacidade
          </h1>
          <p className="text-xs text-outline mt-2">Última atualização: Novembro de 2026</p>
        </div>

        <section className="space-y-3 text-sm text-slate-300 leading-relaxed">
          <h2 className="text-base font-bold text-white">1. Dados coletados via Conta Google</h2>
          <p>
            O acesso ao DevCore é feito exclusivamente pela sua conta Google (OAuth 2.0). Coletamos
            apenas as informações estritamente necessárias para o funcionamento da plataforma:
          </p>
          <ul className="list-disc pl-5 space-y-1.5 text-slate-300">
            <li>
              <strong>Perfil básico:</strong> nome, endereço de e-mail verificado e foto de perfil
              para identificar sua conta pessoal.
            </li>
            <li>
              <strong>Arquivos selecionados do Google Drive (`drive.file`):</strong> o DevCore
              acessa exclusivamente os arquivos específicos que você escolher selecionar pelo
              Google Picker nativo para assistir às suas aulas, filmes, séries ou ler materiais de
              apoio. Não acessamos o restante do seu Google Drive e nunca excluímos seus arquivos.
            </li>
          </ul>
        </section>

        <section className="space-y-3 text-sm text-slate-300 leading-relaxed">
          <h2 className="text-base font-bold text-white">2. Isolamento e Segurança</h2>
          <p>
            Cada usuário possui ambiente totalmente isolado no banco de dados (Row-Level Security).
            Seus cursos, progresso de aulas, anotações e histórico do Tutor IA são visíveis apenas
            para a sua própria conta Google. Os tokens OAuth são armazenados de forma criptografada
            (AES-256-GCM) no servidor e nunca são expostos a terceiros.
          </p>
        </section>

        <section className="space-y-3 text-sm text-slate-300 leading-relaxed">
          <h2 className="text-base font-bold text-white">
            3. Conformidade com a Política de Dados das APIs do Google
          </h2>
          <p>
            O uso e a transferência de informações recebidas das APIs do Google pelo DevCore seguem
            integralmente a{' '}
            <a
              href="https://developers.google.com/terms/api-services-user-data-policy"
              target="_blank"
              rel="noreferrer"
              className="text-secondary underline hover:text-primary"
            >
              Google API Services User Data Policy
            </a>
            , incluindo os requisitos de Uso Limitado (Limited Use). Não vendemos seus dados, não
            exibimos anúncios baseados nos seus arquivos e não utilizamos seus arquivos do Google
            Drive para treinar modelos de inteligência artificial.
          </p>
        </section>

        <section className="space-y-3 text-sm text-slate-300 leading-relaxed">
          <h2 className="text-base font-bold text-white">4. Revogação e Exclusão</h2>
          <p>
            Você pode desconectar sua conta a qualquer momento ou revogar o acesso do DevCore
            diretamente nas configurações de segurança da sua conta Google em{' '}
            <a
              href="https://myaccount.google.com/permissions"
              target="_blank"
              rel="noreferrer"
              className="text-secondary underline hover:text-primary"
            >
              myaccount.google.com/permissions
            </a>
            .
          </p>
        </section>
      </main>
    </div>
  );
}
