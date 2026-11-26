import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'DevCore — Plataforma de Engenharia de Software',
  description: 'Plataforma de aprendizagem ativa com RAG pessoal sobre o Google Drive',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR" className="dark">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Geist:wght@100..900&family=JetBrains+Mono:wght@100..900&display=swap"
          rel="stylesheet"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200"
          rel="stylesheet"
        />
      </head>
      <body className="bg-surface text-on-surface antialiased min-h-screen selection:bg-primary-container selection:text-on-primary-container">
        {children}
      </body>
    </html>
  );
}

