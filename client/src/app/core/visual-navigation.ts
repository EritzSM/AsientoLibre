export interface QuickAction { target: string; title: string; description: string; icon: string; }

const common: QuickAction[] = [
  { target: '#mis-viajes', title: 'Mis viajes', description: 'Consulta tu actividad e historial.', icon: '↗' },
  { target: '#recordatorios', title: 'Próximos viajes', description: 'Revisa horarios y asistencia.', icon: '◷' },
];

export function quickActionsFor(role: 'conductor' | 'pasajero'): QuickAction[] {
  return role === 'conductor' ? [
    { target: '#publicar', title: 'Publicar ruta', description: 'Crea un viaje único o recurrente.', icon: '+' },
    { target: '#calendario-rutas', title: 'Calendario', description: 'Gestiona tu programación mensual.', icon: '□' },
    { target: '#solicitudes-cupo', title: 'Solicitudes', description: 'Acepta o rechaza solicitudes de cupo.', icon: '✓' },
    { target: '#validacion-pagos', title: 'Pagos', description: 'Valida los aportes de tus pasajeros.', icon: '$' },
    ...common,
  ] : [
    { target: '#buscar', title: 'Buscar viaje', description: 'Encuentra rutas con cupos disponibles.', icon: '⌕' },
    { target: '#rutas-favoritas', title: 'Rutas favoritas', description: 'Accede a tus trayectos frecuentes.', icon: '★' },
    { target: '#mis-reservas', title: 'Mis reservas', description: 'Consulta solicitudes y reservas.', icon: '✓' },
    ...common,
  ];
}
