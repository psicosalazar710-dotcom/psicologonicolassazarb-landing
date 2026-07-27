/**
 * SISTEMA DE AGENDAMIENTO — Psicólogo Nicolás Salazar Barbosa
 * Cloudflare Pages Function — reemplaza portal/calendar.php (PHP/Hostinger)
 *
 * Ruta resultante: https://psicologonicolassalazarb.com/api/calendar
 * Mismo contrato JSON que el calendar.php original:
 *   GET  /api/calendar?action=slots  -> { success, days: [...] }
 *   POST /api/calendar?action=book   -> { success, message, event_id, date_label, time_label }
 *
 * América/Bogotá = UTC-5 fijo (Colombia no tiene horario de verano),
 * por eso todo el manejo de fechas se hace con aritmética simple de
 * milisegundos en vez de una librería de zonas horarias.
 *
 * NOTA: este archivo incluye console.log/console.error como logs
 * temporales de diagnóstico en producción (solicitud de slots, creación
 * de evento, envío de correo y errores). Visibles en Cloudflare
 * (dashboard del proyecto → Logs, o `wrangler pages deployment tail`).
 * Se pueden reducir o quitar una vez confirmada la estabilidad del endpoint.
 */

const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

const SESSION_DURATION_MIN = 60;
const SLOT_INTERVAL_MIN = 60;
const DAYS_AHEAD = 60;
const BOGOTA_OFFSET_HOURS = 5; // UTC-5

const SCHEDULE = {
  1: { start: '09:00', end: '21:00' }, // Lunes
  2: { start: '09:00', end: '21:00' }, // Martes
  3: { start: '09:00', end: '21:00' }, // Miércoles
  4: { start: '09:00', end: '21:00' }, // Jueves
  5: { start: '09:00', end: '21:00' }, // Viernes
  6: { start: '09:00', end: '12:00' }, // Sábado
  0: null,                              // Domingo cerrado
};

const DAYS_ES = ['Domingo', 'Lunes', 'Martes', 'Miercoles', 'Jueves', 'Viernes', 'Sabado'];
const MONTHS_ES = ['', 'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
  'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      ...CORS_HEADERS,
    },
  });
}

// ═══════════════════════════════════════════════════════════
// ENTRY POINT — Cloudflare Pages Functions
// ═══════════════════════════════════════════════════════════
export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: CORS_HEADERS });
  }

  const url = new URL(request.url);
  const action = url.searchParams.get('action') || 'slots';

  try {
    if (action === 'slots' && request.method === 'GET') {
      return await handleSlots(env);
    }
    if (action === 'book' && request.method === 'POST') {
      return await handleBook(request, env);
    }
    // Nota: se mantiene HTTP 200 aquí a propósito, igual que el calendar.php
    // original (que no fija http_response_code en este caso). Solo el catch
    // de abajo usa 500, replicando exactamente el comportamiento previo.
    return json({ success: false, error: 'Accion no reconocida.' });
  } catch (err) {
    console.error(`[calendar] Error no controlado en action=${action}:`, err);
    return json({ success: false, error: err.message || 'Error interno del servidor.' }, 500);
  }
}

// ── Utilidades de fecha/hora (Bogotá, UTC-5 fijo) ────────────
function pad(n) { return String(n).padStart(2, '0'); }

function bogotaTodayParts() {
  const shifted = new Date(Date.now() - BOGOTA_OFFSET_HOURS * 3600 * 1000);
  return { y: shifted.getUTCFullYear(), m: shifted.getUTCMonth() + 1, d: shifted.getUTCDate() };
}

function addDaysToParts(parts, days) {
  const dt = new Date(Date.UTC(parts.y, parts.m - 1, parts.d + days));
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

function dowFromParts(parts) {
  return new Date(Date.UTC(parts.y, parts.m - 1, parts.d)).getUTCDay();
}

// Convierte una hora local de Bogotá (y,m,d,hh,mm) a milisegundos UTC reales
function bogotaToUTCms(parts, hh, mm) {
  return Date.UTC(parts.y, parts.m - 1, parts.d, hh + BOGOTA_OFFSET_HOURS, mm, 0);
}

function isoBogota(ms) {
  const s = new Date(ms - BOGOTA_OFFSET_HOURS * 3600 * 1000);
  return `${s.getUTCFullYear()}-${pad(s.getUTCMonth() + 1)}-${pad(s.getUTCDate())}T` +
    `${pad(s.getUTCHours())}:${pad(s.getUTCMinutes())}:00-05:00`;
}

function hmBogota(ms) {
  const s = new Date(ms - BOGOTA_OFFSET_HOURS * 3600 * 1000);
  return `${pad(s.getUTCHours())}:${pad(s.getUTCMinutes())}`;
}

function labelBogota(ms) {
  const s = new Date(ms - BOGOTA_OFFSET_HOURS * 3600 * 1000);
  let h = s.getUTCHours();
  const m = s.getUTCMinutes();
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12; if (h === 0) h = 12;
  return `${h}:${pad(m)} ${ampm}`;
}

// ── Autenticación Google (JWT RS256 firmado con Web Crypto API) ─
function base64urlFromBytes(bytes) {
  let str = '';
  bytes.forEach((b) => { str += String.fromCharCode(b); });
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlFromString(s) {
  return base64urlFromBytes(new TextEncoder().encode(s));
}

function pemToArrayBuffer(pem) {
  const b64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '');
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function getAccessToken(env) {
  const clientEmail = env.GOOGLE_CLIENT_EMAIL;
  // El secret puede llegar con "\n" literales si se pegó en una sola línea
  const privateKeyPem = env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n');

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: clientEmail,
    scope: 'https://www.googleapis.com/auth/calendar',
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
  };

  const unsigned = `${base64urlFromString(JSON.stringify(header))}.${base64urlFromString(JSON.stringify(payload))}`;

  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(privateKeyPem),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    new TextEncoder().encode(unsigned),
  );

  const jwt = `${unsigned}.${base64urlFromBytes(new Uint8Array(signature))}`;

  const resp = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  if (!resp.ok) {
    console.error(`[calendar] Google OAuth token respondió status ${resp.status}`);
  }
  const data = await resp.json().catch(() => ({}));
  if (!data.access_token) {
    throw new Error('Error autenticando con Google: ' + (data.error_description || JSON.stringify(data)));
  }
  return data.access_token;
}

// ── Google Calendar: eventos ocupados ────────────────────────
async function getBusySlots(token, calendarId, dateMinISO, dateMaxISO) {
  const params = new URLSearchParams({
    timeMin: dateMinISO,
    timeMax: dateMaxISO,
    singleEvents: 'true',
    orderBy: 'startTime',
  });
  const resp = await fetch(
    `${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events?${params}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!resp.ok) {
    const errBody = await resp.text().catch(() => '');
    console.error(`[calendar] Google Calendar (lectura de eventos) respondió status ${resp.status}: ${errBody}`);
    throw new Error(`No se pudo leer la disponibilidad de Google Calendar (status ${resp.status}).`);
  }
  const data = await resp.json();
  const busy = [];

  for (const event of data.items || []) {
    if (event.status === 'cancelled') continue;

    // Evento con hora exacta
    if (event.start?.dateTime && event.end?.dateTime) {
      busy.push({
        start: new Date(event.start.dateTime).getTime(),
        end: new Date(event.end.dateTime).getTime(),
      });
      continue;
    }

    // Evento de día completo (festivo, vacaciones, bloqueo manual)
    if (event.start?.date && event.end?.date) {
      const [sy, sm, sd] = event.start.date.split('-').map(Number);
      const endParts = (() => {
        const [ey, em, ed] = event.end.date.split('-').map(Number);
        return { y: ey, m: em, d: ed };
      })();
      let cursor = { y: sy, m: sm, d: sd };
      while (
        cursor.y < endParts.y ||
        (cursor.y === endParts.y && cursor.m < endParts.m) ||
        (cursor.y === endParts.y && cursor.m === endParts.m && cursor.d < endParts.d)
      ) {
        busy.push({
          start: bogotaToUTCms(cursor, 0, 0),
          end: bogotaToUTCms(cursor, 23, 59) + 59000,
        });
        cursor = addDaysToParts(cursor, 1);
      }
    }
  }
  return busy;
}

// ── Generación de slots disponibles ──────────────────────────
function generateSlots(busy) {
  const today = bogotaTodayParts();
  const tomorrow = addDaysToParts(today, 1);
  const minTimeMs = bogotaToUTCms(tomorrow, 0, 0); // sin agendamiento el mismo día

  const slotsByDate = {};

  for (let dOffset = 0; dOffset < DAYS_AHEAD; dOffset++) {
    const parts = addDaysToParts(today, dOffset);
    const dow = dowFromParts(parts);
    const dayConf = SCHEDULE[dow];
    if (!dayConf) continue;

    const [startH, startM] = dayConf.start.split(':').map(Number);
    const [endH, endM] = dayConf.end.split(':').map(Number);
    const dayStartMs = bogotaToUTCms(parts, startH, startM);
    const dayEndMs = bogotaToUTCms(parts, endH, endM);

    let cursor = dayStartMs;
    const dateStr = `${parts.y}-${pad(parts.m)}-${pad(parts.d)}`;

    while (cursor < dayEndMs) {
      const slotEnd = cursor + SESSION_DURATION_MIN * 60000;
      if (slotEnd > dayEndMs) break;

      if (cursor < minTimeMs) {
        cursor += SLOT_INTERVAL_MIN * 60000;
        continue;
      }

      const isBusy = busy.some((b) => cursor < b.end && slotEnd > b.start);

      if (!isBusy) {
        if (!slotsByDate[dateStr]) slotsByDate[dateStr] = [];
        slotsByDate[dateStr].push({
          start: hmBogota(cursor),
          end: hmBogota(slotEnd),
          startISO: isoBogota(cursor),
          endISO: isoBogota(slotEnd),
          label: labelBogota(cursor),
        });
      }
      cursor += SLOT_INTERVAL_MIN * 60000;
    }
  }
  return slotsByDate;
}

// ── Handlers de las dos acciones ─────────────────────────────
async function handleSlots(env) {
  console.log('[calendar] Solicitud de slots recibida (action=slots)');
  const token = await getAccessToken(env);

  const today = bogotaTodayParts();
  const dateMinISO = isoBogota(bogotaToUTCms(today, 0, 0));
  const future = addDaysToParts(today, DAYS_AHEAD);
  const dateMaxISO = isoBogota(bogotaToUTCms(future, 0, 0));

  const busy = await getBusySlots(token, env.CALENDAR_ID, dateMinISO, dateMaxISO);
  const slots = generateSlots(busy);

  const formatted = Object.entries(slots).map(([date, times]) => {
    const [y, m, d] = date.split('-').map(Number);
    const dow = dowFromParts({ y, m, d });
    return {
      date,
      label: `${DAYS_ES[dow]}, ${d} de ${MONTHS_ES[m]}`,
      day_short: DAYS_ES[dow].slice(0, 3).toUpperCase(),
      day_num: d,
      month: MONTHS_ES[m].slice(0, 3).toUpperCase(),
      slots: times,
    };
  });

  console.log(`[calendar] Slots calculados: ${formatted.length} dia(s) con disponibilidad`);
  return json({ success: true, days: formatted });
}

async function handleBook(request, env) {
  const input = await request.json().catch(() => ({}));
  const name = (input.name || '').trim();
  const email = (input.email || '').trim();
  const phone = (input.phone || '').trim();
  const service = (input.service || 'Psicoterapia Individual').trim();
  const mode = (input.mode || 'Presencial').trim();
  const startISO = (input.startISO || '').trim();
  const endISO = (input.endISO || '').trim();

  if (!name || !email || !startISO || !endISO) {
    // HTTP 200 a propósito — mismo comportamiento que calendar.php original
    return json({ success: false, error: 'Completa todos los campos requeridos.' });
  }

  const token = await getAccessToken(env);
  console.log(`[calendar] Creando evento en Google Calendar para "${name}" (${startISO} - ${endISO})`);
  const event = {
    summary: `Sesion - ${name}`,
    description: `Servicio: ${service}\nModalidad: ${mode}\nTel: ${phone}\nCorreo: ${email}\nAgendado desde psicologonicolassalazarb.com`,
    start: { dateTime: startISO, timeZone: 'America/Bogota' },
    end: { dateTime: endISO, timeZone: 'America/Bogota' },
    attendees: [{ email, displayName: name }],
    reminders: {
      useDefault: false,
      overrides: [
        { method: 'email', minutes: 1440 },
        { method: 'email', minutes: 60 },
        { method: 'popup', minutes: 30 },
      ],
    },
    colorId: '7',
  };

  const resp = await fetch(
    `${CALENDAR_API}/calendars/${encodeURIComponent(env.CALENDAR_ID)}/events?sendUpdates=none`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
    },
  );
  if (!resp.ok) {
    // Google normalmente devuelve el detalle del error en JSON incluso con
    // status no-2xx (403/401/409/etc.) — se registra el status aquí, pero
    // el cuerpo se sigue parseando abajo para mantener exactamente el mismo
    // mapeo de errores humanos que ya existía (basado en error.code del body).
    console.error(`[calendar] Google Calendar (creación de evento) respondió status ${resp.status}`);
  }
  const created = await resp.json().catch(() => ({}));

  if (!created.id) {
    const code = created.error?.code || 0;
    const msg = created.error?.message || 'Respuesta inesperada de Google Calendar.';
    let humanMsg;
    if (code === 403) humanMsg = 'La cuenta de servicio no tiene permiso de escritura en el calendario.';
    else if (code === 401) humanMsg = 'Error de autenticación con Google Calendar. Verifica las credenciales.';
    else if (code === 409) humanMsg = 'Este horario ya no está disponible. Por favor elige otro.';
    else humanMsg = 'No se pudo registrar la cita en el calendario. Intenta de nuevo.';
    console.error(`[calendar] Error creando evento en Google Calendar: [${code}] ${msg}`);
    // HTTP 200 a propósito — mismo comportamiento que calendar.php original
    return json({ success: false, error: humanMsg, gcal: `[${code}] ${msg}` });
  }

  console.log(`[calendar] Evento creado en Google Calendar: ${created.id}`);

  const startMs = new Date(startISO).getTime();
  const shifted = new Date(startMs - BOGOTA_OFFSET_HOURS * 3600000);
  const dateLabel = `${DAYS_ES[shifted.getUTCDay()]}, ${shifted.getUTCDate()} de ` +
    `${MONTHS_ES[shifted.getUTCMonth() + 1]} de ${shifted.getUTCFullYear()}`;
  const timeLabel = `${labelBogota(startMs)} (hora Colombia)`;

  // El envío de correo nunca debe tumbar la confirmación de la cita:
  // si Resend falla, la cita ya quedó creada en Google Calendar.
  try {
    await sendConfirmationEmails(env, { name, email, phone, service, mode, dateLabel, timeLabel });
  } catch (err) {
    console.error(`[calendar] No se pudieron enviar los correos de confirmación: ${err.message}`);
    // no-op a propósito: la cita ya está confirmada en el calendario,
    // un fallo de correo no debe romper la respuesta de éxito (igual que en el PHP original)
  }

  return json({
    success: true,
    message: `Cita confirmada. Revisa tu correo ${email} para los detalles.`,
    event_id: created.id,
    date_label: dateLabel,
    time_label: timeLabel,
  });
}

// ── Notificaciones por correo (Resend API — reemplaza mail() de PHP) ─
async function sendEmail(env, { to, subject, text }) {
  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: env.FROM_EMAIL, to: [to], subject, text }),
  });

  if (!resp.ok) {
    const errBody = await resp.text().catch(() => '');
    console.error(`[calendar] Resend respondió status ${resp.status} al enviar a ${to}: ${errBody}`);
    throw new Error(`Fallo el envío de correo a ${to} (Resend status ${resp.status}).`);
  }

  console.log(`[calendar] Correo enviado correctamente a ${to} — "${subject}"`);
}

async function sendConfirmationEmails(env, b) {
  const patientBody =
`Hola ${b.name},

Tu cita ha sido confirmada. Aquí los detalles:

Fecha    : ${b.dateLabel}
Hora     : ${b.timeLabel}
Servicio : ${b.service}
Modalidad: ${b.mode}

${b.mode === 'Online'
  ? 'Te enviaré el enlace de videollamada por WhatsApp antes de la sesión.'
  : 'Dirección: Cl. 52 #20-15, Bogotá'}

Si necesitas reagendar o cancelar, escríbeme por WhatsApp: +57 311 572 5459

Nos vemos pronto,
Psicólogo Nicolás Salazar Barbosa
psicologonicolassalazarb.com`;

  const therapistBody =
`NUEVA CITA AGENDADA
----------------------------------------
Paciente  : ${b.name}
Correo    : ${b.email}
Teléfono  : ${b.phone}
Servicio  : ${b.service}
Modalidad : ${b.mode}
Fecha     : ${b.dateLabel}
Hora      : ${b.timeLabel}
----------------------------------------
Cita registrada en Google Calendar.`;

  await Promise.all([
    sendEmail(env, {
      to: b.email,
      subject: 'Cita confirmada - Psicólogo Nicolás Salazar',
      text: patientBody,
    }),
    sendEmail(env, {
      to: env.THERAPIST_EMAIL,
      subject: `Nueva cita - ${b.name} - ${b.dateLabel} ${b.timeLabel}`,
      text: therapistBody,
    }),
  ]);
}
