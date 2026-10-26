export interface QuickAction { target: string; title: string; description: string; icon: string; }

export function quickActionsFor(role: 'conductor' | 'pasajero'): QuickAction[] {
  return role === 'conductor' ? [
    { target: '#publicar', title: 'Publicar ruta', description: 'Crea un viaje único o recurrente.', icon: '+' },
    { target: '/calendario.html', title: 'Calendario', description: 'Gestiona tu programación mensual.', icon: '□' },
    { target: '/viajes-activos.html#solicitudes-cupo', title: 'Solicitudes', description: 'Acepta o rechaza solicitudes de cupo.', icon: '✓' },
    { target: '/viajes-activos.html#validacion-pagos', title: 'Pagos', description: 'Valida los aportes de tus pasajeros.', icon: '$' },
    { target: '/historial.html', title: 'Mis viajes', description: 'Consulta tu actividad e historial.', icon: '↗' },
    { target: '#recordatorios', title: 'Próximos viajes', description: 'Revisa horarios y asistencia.', icon: '◷' },
  ] : [
    { target: '#buscar', title: 'Buscar viaje', description: 'Encuentra rutas con cupos disponibles.', icon: '⌕' },
    { target: '/favoritos.html', title: 'Rutas favoritas', description: 'Accede a tus trayectos frecuentes.', icon: '★' },
    { target: '/viajes-activos.html', title: 'Viajes activos', description: 'Consulta tus viajes activos.', icon: '🚗' },
    { target: '/historial.html', title: 'Mis viajes', description: 'Consulta tu actividad e historial.', icon: '↗' },
    { target: '#recordatorios', title: 'Próximos viajes', description: 'Revisa horarios y asistencia.', icon: '◷' },
  ];
}
