/**
 * Localizadores canônicos tipados por formato de documento.
 * Armazenados no campo `locator` da tabela `document_chunks`.
 */

export type PdfLocator = {
  type: 'pdf';
  pageNumber: number;          // Página física (1-indexed)
  sectionTitle?: string;       // Nome do capítulo ou cabeçalho identificado
  bbox?: [number, number, number, number]; // Coordenadas [x1, y1, x2, y2]
};

export type DocxLocator = {
  type: 'docx' | 'google_doc';
  headingPath: string[];       // Ex.: ["Capítulo 2", "2.1 Arquitetura Hexagonal"]
  paragraphIndex: number;      // Índice sequencial do bloco
  revisionId?: string;         // Versão do arquivo no momento da extração
};

export type PptxLocator = {
  type: 'pptx';
  slideNumber: number;         // Número do slide
  slideTitle?: string;         // Título principal do slide
  isSpeakerNotes: boolean;     // Se o conteúdo veio das anotações do orador
};

export type MarkdownLocator = {
  type: 'markdown' | 'txt';
  headingPath: string[];       // Trilhas de tags (#, ##, ###)
  startLine: number;           // Linha de início no arquivo fonte
  endLine: number;             // Linha de término
};

export type CodeLocator = {
  type: 'code';
  language: 'typescript' | 'go' | 'java';
  symbolName: string;          // Ex.: "Order.confirmPayment" ou "AggregateRoot"
  symbolType: 'class' | 'method' | 'function' | 'interface' | 'type';
  startLine: number;
  endLine: number;
  filePath: string;
};

export type VideoLocator = {
  type: 'video';
  startSeconds: number;        // Segundo inicial do trecho
  endSeconds: number;          // Segundo final do trecho
  speaker?: string;            // Identificação do locutor (se disponível)
};

export type DocumentLocator = 
  | PdfLocator 
  | DocxLocator 
  | PptxLocator 
  | MarkdownLocator 
  | CodeLocator 
  | VideoLocator;

