export function element<T extends HTMLElement>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`No se encontró ${selector}.`);
  return found;
}

export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]!);
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'No se pudo completar la operación. Inténtalo nuevamente.';
}

export function statusMessage(selector: string, message: string): void {
  const target = element(selector);
  target.textContent = message;
  target.hidden = !message;
}
