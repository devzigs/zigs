// Integration boundary only. Never imported or instantiated by the product preview.
// Provider token identifiers must come from the verified token registry, never display symbols.
export class NearIntentsSwapProvider {
  async supportedAssets() { throw Error('NotImplemented: live swap integration is not enabled.'); }
  async previewQuote() { throw Error('NotImplemented: live swap quotes are not enabled.'); }
  async prepareExecution() { throw Error('NotImplemented: live swap execution is not enabled.'); }
  async track() { throw Error('NotImplemented: live swap status tracking is not enabled.'); }
}
