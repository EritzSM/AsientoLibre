import { describe, expect, it } from 'vitest';
import { colombiaDate, validateRoute } from './route-validation';
import type { CreateRoute } from './services/routes.service';

const future = Date.parse('2030-01-01T17:00:00Z');
const validRoute: CreateRoute = {
  origin: 'Medellín',
  destination: 'Universidad de Medellín',
  date: '2030-01-02',
  time: '07:30',
  seats: 3,
  price: 5000,
  note: 'Salida puntual.',
};

describe('validación de publicación de rutas', () => {
  it('acepta una ruta futura con cupos dentro de la capacidad', () => {
    expect(validateRoute(validRoute, 4, future)).toEqual({});
  });

  it.each([
    [{ origin: '' }, 'origin'],
    [{ destination: '   ' }, 'destination'],
    [{ destination: 'mEdElLíN' }, 'destination'],
    [{ date: '2030-02-30' }, 'date'],
    [{ time: '24:00' }, 'time'],
    [{ seats: 0 }, 'seats'],
    [{ seats: 2.5 }, 'seats'],
    [{ seats: 5 }, 'seats'],
    [{ price: -1 }, 'price'],
    [{ note: 'x'.repeat(501) }, 'note'],
  ] as const)('rechaza el campo inválido %j', (change, field) => {
    expect(validateRoute({ ...validRoute, ...change }, 4, future)[field]).toBeTruthy();
  });

  it('exige una capacidad explícita para vehículos antiguos', () => {
    expect(validateRoute(validRoute, null, future).seats).toContain('capacidad');
  });

  it('interpreta el día en la zona horaria de Colombia', () => {
    expect(colombiaDate(new Date('2030-01-02T03:00:00Z'))).toBe('2030-01-01');
  });
});
