declare module 'mammoth/mammoth.browser' {
  export interface MammothHtmlResult {
    value: string;
    messages: Array<{ type: string; message: string }>;
  }

  export function convertToHtml(input: { arrayBuffer: ArrayBuffer }): Promise<MammothHtmlResult>;

  const mammothBrowser: {
    convertToHtml: typeof convertToHtml;
  };
  export default mammothBrowser;
}
