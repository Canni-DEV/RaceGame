# Network Architecture Review

## Diagrama textual (alto nivel)
[Mobile Controller (web, sensores)]
  -> Socket.IO (WebSocket) input ~30Hz
  -> [Servidor Node/TS, autoridad + tick 60Hz]
  -> snapshots/deltas ~20Hz -> [Desktop Viewer (web render)]
  -> eventos room_info/player_* -> [Desktop + Mobile]

## Estado actual (breve)
- Servidor autoritativo: la simulacion corre en server (Room.update) y publica snapshots/deltas.
- Mobile envia solo inputs (steer/throttle/brake/actions) cada ~33ms; server bufferiza y aplica en tick.
- Desktop consume snapshots con interpolacion + extrapolacion corta; usa serverTime.
- Transporte Socket.IO con WebSocket; rooms por Socket.IO; join_room para viewer/controller.
- Estado incluye serverTime; deltas con serverTime; no hay sequenceId ni ack.
- Protocol version en join_room y serverVersion en room_info (obligatorio).
- Pairing viewer<->controller con sessionToken obligatorio (token enviado en room_info).
- Binding server-side: inputs usan socket->playerId; se ignora playerId del payload.
- Inputs clamped/normalizados para NaN/Infinity y rangos invalidos.

## Cambios implementados (seguridad/protocolo)
- Versionado de protocolo: protocolVersion en join_room + serverVersion en room_info.
- Session token por player/room: generado en viewer y validado en join/input del controller.
- Binding de inputs a socket (controller) y validacion de rol.
- Sanitizacion/clamp de inputs (steer/throttle/brake).

## Transporte (evaluacion)
- Socket.IO (solo WebSocket) es valido para web+mobile y simplifica reconexion; mantener.
- WebSocket puro es opcion si se quiere mas control y menos features, pero requiere reimplementar reconexion.
- WebRTC DataChannel no es recomendable para server-authoritative central (ICE/TURN y complejidad extra).

## Checklist de buenas practicas
- ✔ Modelo server-authoritative con simulacion central.
- ✔ Mobile envia inputs, desktop renderiza snapshots.
- ✔ Tick del servidor definido (60Hz) y broadcast de estado (20Hz).
- ✔ Snapshots + interpolacion client-side + extrapolacion corta.
- parcial Input sequencing/ack (sin sequenceId ni ack; depende del orden de WebSocket).
- parcial Manejo de jitter (delay fijo + smoothing; sin RTT/ping para ajustar).
- ✔ Validacion de inputs (burst limit + clamp + binding socket->player).
- ✔ Rooms/partidas y pairing viewer->controller.
- ✔ Versionado de protocolo/compatibilidad.
- ✔ Tokens de sesion (pairing viewer/controller).
- parcial Separacion critico/no critico (eventos vs estado existen, pero mismo canal y sin idempotencia).

## Riesgos arquitectonicos detectados
- Breaking change: clientes sin protocolVersion/sessionToken no pueden unirse.
- Reconexion: si el viewer cae, se elimina jugador y se corta el controller; rejoin sin gracia.
- Jitter en mobile puede generar micro-stutter con delay fijo.

## Recomendaciones priorizadas (minimas, opt-in)
1) [IMPLEMENTADO] Binding socket->playerId en server (ignorar playerId del payload; usar mapping del controller).
2) [IMPLEMENTADO] Token de sesion para pairing controller<->viewer (emitir en room_info, exigir en join/input).
3) Incluir inputSeq y clientTime opcionales; el server descarta inputs viejos y puede loggear lag.
4) [IMPLEMENTADO] Versionar protocolo (protocolVersion en join_room + serverVersion en room_info).
5) [IMPLEMENTADO] Clamp/normalizar inputs y proteger contra NaN/Infinity (server-side).
6) Rejoin con ventana de gracia (mantener player N segundos y permitir reattach).
7) Telemetria simple de RTT/jitter (ping/pong o echo de serverTime) para ajustar interpolationDelay.

## Plan incremental sin refactor masivo
1) Definir contrato de mensajes (version + campos opcionales) y documentarlo. [HECHO]
2) Implementar validacion y binding de inputs en servidor, compatible con clientes actuales. [HECHO]
3) Agregar token de pairing y rejoin con gracia (opt-in). [TOKEN HECHO, REJOIN PENDIENTE]
4) Incluir inputSeq/clientTime y RTT basico para diagnostico. [PENDIENTE]

## Roadmap completo (requiere refactor mayor)
- Input sequencing + ack server (buffer por cliente, descarte de inputs antiguos, metrics de lag).
- Time sync formal (ping/pong con RTT y ajuste dinamico de interpolationDelay).
- Rejoin robusto con ventana de gracia + estado persistente corto (evitar borrar player al drop).
- Separacion de canales (critico vs no critico) o colas con prioridad y reintentos.
- Integridad de estado: versionado por entidad o checksum para detectar desync.
- Autenticacion real (tokens firmados/expirables) si se expone a publico.
