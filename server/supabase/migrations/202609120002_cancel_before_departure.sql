-- Asiento Libre: una ruta no puede cancelarse despues de su salida.
BEGIN;

CREATE OR REPLACE FUNCTION public.remove_route(p_actor uuid, p_route uuid, p_confirm_cancel boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_route public.routes; v_confirmed integer; v_notified integer; v_status text;
BEGIN
  SELECT * INTO v_route FROM public.routes WHERE id = p_route FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING MESSAGE = '{"code":"NOT_FOUND","message":"La ruta no existe."}';
  END IF;
  IF v_route.driver_id IS DISTINCT FROM p_actor OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_actor AND role = 'conductor') THEN
    RAISE EXCEPTION USING MESSAGE = '{"code":"FORBIDDEN","message":"Solo el conductor propietario puede cancelar esta ruta."}';
  END IF;
  IF v_route.status <> 'published' THEN
    SELECT count(*)::integer INTO v_notified FROM public.notifications WHERE route_id = p_route AND type = 'route_cancelled';
    RETURN jsonb_build_object('message', 'La ruta ya fue retirada.', 'status', v_route.status, 'notifiedPassengers', v_notified);
  END IF;
  IF v_route.departure_at <= now() THEN
    RAISE EXCEPTION USING MESSAGE = '{"code":"CONFLICT","message":"La ruta ya comenzó y no puede cancelarse."}';
  END IF;
  SELECT count(*)::integer INTO v_confirmed FROM public.bookings WHERE route_id = p_route AND status = 'confirmed';
  IF v_confirmed > 0 AND p_confirm_cancel IS DISTINCT FROM true THEN
    RAISE EXCEPTION USING MESSAGE = jsonb_build_object('code', 'CANCELLATION_CONFIRMATION_REQUIRED',
      'message', 'Esta ruta tiene pasajeros confirmados. Confirma la cancelación para notificarlos.', 'confirmedPassengers', v_confirmed)::text;
  END IF;
  v_status := CASE WHEN p_confirm_cancel IS TRUE THEN 'cancelled' ELSE 'deleted' END;
  UPDATE public.routes SET status = v_status, updated_at = now() WHERE id = p_route;
  IF v_status = 'cancelled' THEN
    INSERT INTO public.notifications (route_id, recipient_id, type, title, message)
    SELECT p_route, passenger_id, 'route_cancelled', 'Tu viaje fue cancelado',
      format('El conductor canceló la ruta de %s a %s del %s a las %s (hora de Colombia). Tu reserva fue cancelada.',
        v_route.origin, v_route.destination,
        to_char(v_route.departure_at AT TIME ZONE 'America/Bogota', 'DD/MM/YYYY'),
        to_char(v_route.departure_at AT TIME ZONE 'America/Bogota', 'HH24:MI'))
    FROM public.bookings WHERE route_id = p_route AND status = 'confirmed'
    ON CONFLICT (route_id, recipient_id, type) DO NOTHING;
    UPDATE public.bookings SET status = 'cancelled', updated_at = now() WHERE route_id = p_route AND status = 'confirmed';
  END IF;
  SELECT count(*)::integer INTO v_notified FROM public.notifications WHERE route_id = p_route AND type = 'route_cancelled';
  RETURN jsonb_build_object('message', 'Ruta cancelada y pasajeros notificados.', 'status', 'cancelled', 'notifiedPassengers', v_notified);
END;
$$;

COMMIT;