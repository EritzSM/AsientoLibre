import { describe, expect, it } from 'vitest';
import { quickActionsFor } from './visual-navigation';

describe('organización visual por rol', () => {
  it('muestra gestión operativa al conductor sin favoritos de pasajero', () => {
    const actions = quickActionsFor('conductor');
    expect(actions.map((item) => item.target)).toEqual(expect.arrayContaining(['#publicar', '#calendario-rutas', '#solicitudes-cupo']));
    expect(actions.some((item) => item.target === '#rutas-favoritas')).toBe(false);
  });

  it('muestra búsqueda y reservas al pasajero sin gestión del conductor', () => {
    const actions = quickActionsFor('pasajero');
    expect(actions.map((item) => item.target)).toEqual(expect.arrayContaining(['#buscar', '#rutas-favoritas', '#mis-reservas']));
    expect(actions.some((item) => item.target === '#validacion-pagos')).toBe(false);
  });
});
