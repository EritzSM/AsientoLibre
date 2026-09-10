import { describe, expect, it } from 'vitest';
import { escapeHtml } from './dom';

describe('contenido no confiable', () => {
  it('escapa texto de rutas antes de interpolarlo en tarjetas', () => {
    expect(escapeHtml('<img src=x onerror=alert(1)> & "ruta"')).toBe('&lt;img src=x onerror=alert(1)&gt; &amp; &quot;ruta&quot;');
  });
});
