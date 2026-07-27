var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// api/calendar.js
var CALENDAR_API = "https://www.googleapis.com/calendar/v3";
var TOKEN_URL = "https://oauth2.googleapis.com/token";
var SESSION_DURATION_MIN = 60;
var SLOT_INTERVAL_MIN = 60;
var DAYS_AHEAD = 60;
var BOGOTA_OFFSET_HOURS = 5;
var SCHEDULE = {
  1: { start: "09:00", end: "21:00" },
  // Lunes
  2: { start: "09:00", end: "21:00" },
  // Martes
  3: { start: "09:00", end: "21:00" },
  // Miércoles
  4: { start: "09:00", end: "21:00" },
  // Jueves
  5: { start: "09:00", end: "21:00" },
  // Viernes
  6: { start: "09:00", end: "12:00" },
  // Sábado
  0: null
  // Domingo cerrado
};
var DAYS_ES = ["Domingo", "Lunes", "Martes", "Miercoles", "Jueves", "Viernes", "Sabado"];
var MONTHS_ES = [
  "",
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre"
];
var CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=UTF-8",
      "Cache-Control": "no-cache, no-store, must-revalidate",
      ...CORS_HEADERS
    }
  });
}
__name(json, "json");
async function onRequest(context) {
  const { request, env } = context;
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }
  const url = new URL(request.url);
  const action = url.searchParams.get("action") || "slots";
  try {
    if (action === "slots" && request.method === "GET") {
      return await handleSlots(env);
    }
    if (action === "book" && request.method === "POST") {
      return await handleBook(request, env);
    }
    return json({ success: false, error: "Accion no reconocida." });
  } catch (err) {
    console.error(`[calendar] Error no controlado en action=${action}:`, err);
    return json({ success: false, error: err.message || "Error interno del servidor." }, 500);
  }
}
__name(onRequest, "onRequest");
function pad(n) {
  return String(n).padStart(2, "0");
}
__name(pad, "pad");
function bogotaTodayParts() {
  const shifted = new Date(Date.now() - BOGOTA_OFFSET_HOURS * 3600 * 1e3);
  return { y: shifted.getUTCFullYear(), m: shifted.getUTCMonth() + 1, d: shifted.getUTCDate() };
}
__name(bogotaTodayParts, "bogotaTodayParts");
function addDaysToParts(parts, days) {
  const dt = new Date(Date.UTC(parts.y, parts.m - 1, parts.d + days));
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}
__name(addDaysToParts, "addDaysToParts");
function dowFromParts(parts) {
  return new Date(Date.UTC(parts.y, parts.m - 1, parts.d)).getUTCDay();
}
__name(dowFromParts, "dowFromParts");
function bogotaToUTCms(parts, hh, mm) {
  return Date.UTC(parts.y, parts.m - 1, parts.d, hh + BOGOTA_OFFSET_HOURS, mm, 0);
}
__name(bogotaToUTCms, "bogotaToUTCms");
function isoBogota(ms) {
  const s = new Date(ms - BOGOTA_OFFSET_HOURS * 3600 * 1e3);
  return `${s.getUTCFullYear()}-${pad(s.getUTCMonth() + 1)}-${pad(s.getUTCDate())}T${pad(s.getUTCHours())}:${pad(s.getUTCMinutes())}:00-05:00`;
}
__name(isoBogota, "isoBogota");
function hmBogota(ms) {
  const s = new Date(ms - BOGOTA_OFFSET_HOURS * 3600 * 1e3);
  return `${pad(s.getUTCHours())}:${pad(s.getUTCMinutes())}`;
}
__name(hmBogota, "hmBogota");
function labelBogota(ms) {
  const s = new Date(ms - BOGOTA_OFFSET_HOURS * 3600 * 1e3);
  let h = s.getUTCHours();
  const m = s.getUTCMinutes();
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${pad(m)} ${ampm}`;
}
__name(labelBogota, "labelBogota");
function base64urlFromBytes(bytes) {
  let str = "";
  bytes.forEach((b) => {
    str += String.fromCharCode(b);
  });
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
__name(base64urlFromBytes, "base64urlFromBytes");
function base64urlFromString(s) {
  return base64urlFromBytes(new TextEncoder().encode(s));
}
__name(base64urlFromString, "base64urlFromString");
function pemToArrayBuffer(pem) {
  const b64 = pem.replace(/-----BEGIN PRIVATE KEY-----/, "").replace(/-----END PRIVATE KEY-----/, "").replace(/\s+/g, "");
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}
__name(pemToArrayBuffer, "pemToArrayBuffer");
async function getAccessToken(env) {
  const clientEmail = env.GOOGLE_CLIENT_EMAIL;
  const privateKeyPem = env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n");
  const now = Math.floor(Date.now() / 1e3);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: clientEmail,
    scope: "https://www.googleapis.com/auth/calendar",
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600
  };
  const unsigned = `${base64urlFromString(JSON.stringify(header))}.${base64urlFromString(JSON.stringify(payload))}`;
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(privateKeyPem),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    new TextEncoder().encode(unsigned)
  );
  const jwt = `${unsigned}.${base64urlFromBytes(new Uint8Array(signature))}`;
  const resp = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt
    })
  });
  if (!resp.ok) {
    console.error(`[calendar] Google OAuth token respondi\xF3 status ${resp.status}`);
  }
  const data = await resp.json().catch(() => ({}));
  if (!data.access_token) {
    throw new Error("Error autenticando con Google: " + (data.error_description || JSON.stringify(data)));
  }
  return data.access_token;
}
__name(getAccessToken, "getAccessToken");
async function getBusySlots(token, calendarId, dateMinISO, dateMaxISO) {
  const params = new URLSearchParams({
    timeMin: dateMinISO,
    timeMax: dateMaxISO,
    singleEvents: "true",
    orderBy: "startTime"
  });
  const resp = await fetch(
    `${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events?${params}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!resp.ok) {
    const errBody = await resp.text().catch(() => "");
    console.error(`[calendar] Google Calendar (lectura de eventos) respondi\xF3 status ${resp.status}: ${errBody}`);
    throw new Error(`No se pudo leer la disponibilidad de Google Calendar (status ${resp.status}).`);
  }
  const data = await resp.json();
  const busy = [];
  for (const event of data.items || []) {
    if (event.status === "cancelled") continue;
    if (event.start?.dateTime && event.end?.dateTime) {
      busy.push({
        start: new Date(event.start.dateTime).getTime(),
        end: new Date(event.end.dateTime).getTime()
      });
      continue;
    }
    if (event.start?.date && event.end?.date) {
      const [sy, sm, sd] = event.start.date.split("-").map(Number);
      const endParts = (() => {
        const [ey, em, ed] = event.end.date.split("-").map(Number);
        return { y: ey, m: em, d: ed };
      })();
      let cursor = { y: sy, m: sm, d: sd };
      while (cursor.y < endParts.y || cursor.y === endParts.y && cursor.m < endParts.m || cursor.y === endParts.y && cursor.m === endParts.m && cursor.d < endParts.d) {
        busy.push({
          start: bogotaToUTCms(cursor, 0, 0),
          end: bogotaToUTCms(cursor, 23, 59) + 59e3
        });
        cursor = addDaysToParts(cursor, 1);
      }
    }
  }
  return busy;
}
__name(getBusySlots, "getBusySlots");
function generateSlots(busy) {
  const today = bogotaTodayParts();
  const tomorrow = addDaysToParts(today, 1);
  const minTimeMs = bogotaToUTCms(tomorrow, 0, 0);
  const slotsByDate = {};
  for (let dOffset = 0; dOffset < DAYS_AHEAD; dOffset++) {
    const parts = addDaysToParts(today, dOffset);
    const dow = dowFromParts(parts);
    const dayConf = SCHEDULE[dow];
    if (!dayConf) continue;
    const [startH, startM] = dayConf.start.split(":").map(Number);
    const [endH, endM] = dayConf.end.split(":").map(Number);
    const dayStartMs = bogotaToUTCms(parts, startH, startM);
    const dayEndMs = bogotaToUTCms(parts, endH, endM);
    let cursor = dayStartMs;
    const dateStr = `${parts.y}-${pad(parts.m)}-${pad(parts.d)}`;
    while (cursor < dayEndMs) {
      const slotEnd = cursor + SESSION_DURATION_MIN * 6e4;
      if (slotEnd > dayEndMs) break;
      if (cursor < minTimeMs) {
        cursor += SLOT_INTERVAL_MIN * 6e4;
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
          label: labelBogota(cursor)
        });
      }
      cursor += SLOT_INTERVAL_MIN * 6e4;
    }
  }
  return slotsByDate;
}
__name(generateSlots, "generateSlots");
async function handleSlots(env) {
  console.log("[calendar] Solicitud de slots recibida (action=slots)");
  const token = await getAccessToken(env);
  const today = bogotaTodayParts();
  const dateMinISO = isoBogota(bogotaToUTCms(today, 0, 0));
  const future = addDaysToParts(today, DAYS_AHEAD);
  const dateMaxISO = isoBogota(bogotaToUTCms(future, 0, 0));
  const busy = await getBusySlots(token, env.CALENDAR_ID, dateMinISO, dateMaxISO);
  const slots = generateSlots(busy);
  const formatted = Object.entries(slots).map(([date, times]) => {
    const [y, m, d] = date.split("-").map(Number);
    const dow = dowFromParts({ y, m, d });
    return {
      date,
      label: `${DAYS_ES[dow]}, ${d} de ${MONTHS_ES[m]}`,
      day_short: DAYS_ES[dow].slice(0, 3).toUpperCase(),
      day_num: d,
      month: MONTHS_ES[m].slice(0, 3).toUpperCase(),
      slots: times
    };
  });
  console.log(`[calendar] Slots calculados: ${formatted.length} dia(s) con disponibilidad`);
  return json({ success: true, days: formatted });
}
__name(handleSlots, "handleSlots");
async function handleBook(request, env) {
  const input = await request.json().catch(() => ({}));
  const name = (input.name || "").trim();
  const email = (input.email || "").trim();
  const phone = (input.phone || "").trim();
  const service = (input.service || "Psicoterapia Individual").trim();
  const mode = (input.mode || "Presencial").trim();
  const startISO = (input.startISO || "").trim();
  const endISO = (input.endISO || "").trim();
  if (!name || !email || !startISO || !endISO) {
    return json({ success: false, error: "Completa todos los campos requeridos." });
  }
  const token = await getAccessToken(env);
  console.log(`[calendar] Creando evento en Google Calendar para "${name}" (${startISO} - ${endISO})`);
  const event = {
    summary: `Sesion - ${name}`,
    description: `Servicio: ${service}
Modalidad: ${mode}
Tel: ${phone}
Correo: ${email}
Agendado desde psicologonicolassalazarb.com`,
    start: { dateTime: startISO, timeZone: "America/Bogota" },
    end: { dateTime: endISO, timeZone: "America/Bogota" },
    attendees: [{ email, displayName: name }],
    reminders: {
      useDefault: false,
      overrides: [
        { method: "email", minutes: 1440 },
        { method: "email", minutes: 60 },
        { method: "popup", minutes: 30 }
      ]
    },
    colorId: "7"
  };
  const resp = await fetch(
    `${CALENDAR_API}/calendars/${encodeURIComponent(env.CALENDAR_ID)}/events?sendUpdates=none`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(event)
    }
  );
  if (!resp.ok) {
    console.error(`[calendar] Google Calendar (creaci\xF3n de evento) respondi\xF3 status ${resp.status}`);
  }
  const created = await resp.json().catch(() => ({}));
  if (!created.id) {
    const code = created.error?.code || 0;
    const msg = created.error?.message || "Respuesta inesperada de Google Calendar.";
    let humanMsg;
    if (code === 403) humanMsg = "La cuenta de servicio no tiene permiso de escritura en el calendario.";
    else if (code === 401) humanMsg = "Error de autenticaci\xF3n con Google Calendar. Verifica las credenciales.";
    else if (code === 409) humanMsg = "Este horario ya no est\xE1 disponible. Por favor elige otro.";
    else humanMsg = "No se pudo registrar la cita en el calendario. Intenta de nuevo.";
    console.error(`[calendar] Error creando evento en Google Calendar: [${code}] ${msg}`);
    return json({ success: false, error: humanMsg, gcal: `[${code}] ${msg}` });
  }
  console.log(`[calendar] Evento creado en Google Calendar: ${created.id}`);
  const startMs = new Date(startISO).getTime();
  const shifted = new Date(startMs - BOGOTA_OFFSET_HOURS * 36e5);
  const dateLabel = `${DAYS_ES[shifted.getUTCDay()]}, ${shifted.getUTCDate()} de ${MONTHS_ES[shifted.getUTCMonth() + 1]} de ${shifted.getUTCFullYear()}`;
  const timeLabel = `${labelBogota(startMs)} (hora Colombia)`;
  try {
    await sendConfirmationEmails(env, { name, email, phone, service, mode, dateLabel, timeLabel });
  } catch (err) {
    console.error(`[calendar] No se pudieron enviar los correos de confirmaci\xF3n: ${err.message}`);
  }
  return json({
    success: true,
    message: `Cita confirmada. Revisa tu correo ${email} para los detalles.`,
    event_id: created.id,
    date_label: dateLabel,
    time_label: timeLabel
  });
}
__name(handleBook, "handleBook");
async function sendEmail(env, { to, subject, text }) {
  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ from: env.FROM_EMAIL, to: [to], subject, text })
  });
  if (!resp.ok) {
    const errBody = await resp.text().catch(() => "");
    console.error(`[calendar] Resend respondi\xF3 status ${resp.status} al enviar a ${to}: ${errBody}`);
    throw new Error(`Fallo el env\xEDo de correo a ${to} (Resend status ${resp.status}).`);
  }
  console.log(`[calendar] Correo enviado correctamente a ${to} \u2014 "${subject}"`);
}
__name(sendEmail, "sendEmail");
async function sendConfirmationEmails(env, b) {
  const patientBody = `Hola ${b.name},

Tu cita ha sido confirmada. Aqu\xED los detalles:

Fecha    : ${b.dateLabel}
Hora     : ${b.timeLabel}
Servicio : ${b.service}
Modalidad: ${b.mode}

${b.mode === "Online" ? "Te enviar\xE9 el enlace de videollamada por WhatsApp antes de la sesi\xF3n." : "Direcci\xF3n: Cl. 52 #20-15, Bogot\xE1"}

Si necesitas reagendar o cancelar, escr\xEDbeme por WhatsApp: +57 311 572 5459

Nos vemos pronto,
Psic\xF3logo Nicol\xE1s Salazar Barbosa
psicologonicolassalazarb.com`;
  const therapistBody = `NUEVA CITA AGENDADA
----------------------------------------
Paciente  : ${b.name}
Correo    : ${b.email}
Tel\xE9fono  : ${b.phone}
Servicio  : ${b.service}
Modalidad : ${b.mode}
Fecha     : ${b.dateLabel}
Hora      : ${b.timeLabel}
----------------------------------------
Cita registrada en Google Calendar.`;
  await Promise.all([
    sendEmail(env, {
      to: b.email,
      subject: "Cita confirmada - Psic\xF3logo Nicol\xE1s Salazar",
      text: patientBody
    }),
    sendEmail(env, {
      to: env.THERAPIST_EMAIL,
      subject: `Nueva cita - ${b.name} - ${b.dateLabel} ${b.timeLabel}`,
      text: therapistBody
    })
  ]);
}
__name(sendConfirmationEmails, "sendConfirmationEmails");

// ../.wrangler/tmp/pages-X9T1Su/functionsRoutes-0.8344065732056904.mjs
var routes = [
  {
    routePath: "/api/calendar",
    mountPath: "/api",
    method: "",
    middlewares: [],
    modules: [onRequest]
  }
];

// ../../../AppData/Roaming/npm/node_modules/wrangler/node_modules/path-to-regexp/dist.es2015/index.js
function lexer(str) {
  var tokens = [];
  var i = 0;
  while (i < str.length) {
    var char = str[i];
    if (char === "*" || char === "+" || char === "?") {
      tokens.push({ type: "MODIFIER", index: i, value: str[i++] });
      continue;
    }
    if (char === "\\") {
      tokens.push({ type: "ESCAPED_CHAR", index: i++, value: str[i++] });
      continue;
    }
    if (char === "{") {
      tokens.push({ type: "OPEN", index: i, value: str[i++] });
      continue;
    }
    if (char === "}") {
      tokens.push({ type: "CLOSE", index: i, value: str[i++] });
      continue;
    }
    if (char === ":") {
      var name = "";
      var j = i + 1;
      while (j < str.length) {
        var code = str.charCodeAt(j);
        if (
          // `0-9`
          code >= 48 && code <= 57 || // `A-Z`
          code >= 65 && code <= 90 || // `a-z`
          code >= 97 && code <= 122 || // `_`
          code === 95
        ) {
          name += str[j++];
          continue;
        }
        break;
      }
      if (!name)
        throw new TypeError("Missing parameter name at ".concat(i));
      tokens.push({ type: "NAME", index: i, value: name });
      i = j;
      continue;
    }
    if (char === "(") {
      var count = 1;
      var pattern = "";
      var j = i + 1;
      if (str[j] === "?") {
        throw new TypeError('Pattern cannot start with "?" at '.concat(j));
      }
      while (j < str.length) {
        if (str[j] === "\\") {
          pattern += str[j++] + str[j++];
          continue;
        }
        if (str[j] === ")") {
          count--;
          if (count === 0) {
            j++;
            break;
          }
        } else if (str[j] === "(") {
          count++;
          if (str[j + 1] !== "?") {
            throw new TypeError("Capturing groups are not allowed at ".concat(j));
          }
        }
        pattern += str[j++];
      }
      if (count)
        throw new TypeError("Unbalanced pattern at ".concat(i));
      if (!pattern)
        throw new TypeError("Missing pattern at ".concat(i));
      tokens.push({ type: "PATTERN", index: i, value: pattern });
      i = j;
      continue;
    }
    tokens.push({ type: "CHAR", index: i, value: str[i++] });
  }
  tokens.push({ type: "END", index: i, value: "" });
  return tokens;
}
__name(lexer, "lexer");
function parse(str, options) {
  if (options === void 0) {
    options = {};
  }
  var tokens = lexer(str);
  var _a = options.prefixes, prefixes = _a === void 0 ? "./" : _a, _b = options.delimiter, delimiter = _b === void 0 ? "/#?" : _b;
  var result = [];
  var key = 0;
  var i = 0;
  var path = "";
  var tryConsume = /* @__PURE__ */ __name(function(type) {
    if (i < tokens.length && tokens[i].type === type)
      return tokens[i++].value;
  }, "tryConsume");
  var mustConsume = /* @__PURE__ */ __name(function(type) {
    var value2 = tryConsume(type);
    if (value2 !== void 0)
      return value2;
    var _a2 = tokens[i], nextType = _a2.type, index = _a2.index;
    throw new TypeError("Unexpected ".concat(nextType, " at ").concat(index, ", expected ").concat(type));
  }, "mustConsume");
  var consumeText = /* @__PURE__ */ __name(function() {
    var result2 = "";
    var value2;
    while (value2 = tryConsume("CHAR") || tryConsume("ESCAPED_CHAR")) {
      result2 += value2;
    }
    return result2;
  }, "consumeText");
  var isSafe = /* @__PURE__ */ __name(function(value2) {
    for (var _i = 0, delimiter_1 = delimiter; _i < delimiter_1.length; _i++) {
      var char2 = delimiter_1[_i];
      if (value2.indexOf(char2) > -1)
        return true;
    }
    return false;
  }, "isSafe");
  var safePattern = /* @__PURE__ */ __name(function(prefix2) {
    var prev = result[result.length - 1];
    var prevText = prefix2 || (prev && typeof prev === "string" ? prev : "");
    if (prev && !prevText) {
      throw new TypeError('Must have text between two parameters, missing text after "'.concat(prev.name, '"'));
    }
    if (!prevText || isSafe(prevText))
      return "[^".concat(escapeString(delimiter), "]+?");
    return "(?:(?!".concat(escapeString(prevText), ")[^").concat(escapeString(delimiter), "])+?");
  }, "safePattern");
  while (i < tokens.length) {
    var char = tryConsume("CHAR");
    var name = tryConsume("NAME");
    var pattern = tryConsume("PATTERN");
    if (name || pattern) {
      var prefix = char || "";
      if (prefixes.indexOf(prefix) === -1) {
        path += prefix;
        prefix = "";
      }
      if (path) {
        result.push(path);
        path = "";
      }
      result.push({
        name: name || key++,
        prefix,
        suffix: "",
        pattern: pattern || safePattern(prefix),
        modifier: tryConsume("MODIFIER") || ""
      });
      continue;
    }
    var value = char || tryConsume("ESCAPED_CHAR");
    if (value) {
      path += value;
      continue;
    }
    if (path) {
      result.push(path);
      path = "";
    }
    var open = tryConsume("OPEN");
    if (open) {
      var prefix = consumeText();
      var name_1 = tryConsume("NAME") || "";
      var pattern_1 = tryConsume("PATTERN") || "";
      var suffix = consumeText();
      mustConsume("CLOSE");
      result.push({
        name: name_1 || (pattern_1 ? key++ : ""),
        pattern: name_1 && !pattern_1 ? safePattern(prefix) : pattern_1,
        prefix,
        suffix,
        modifier: tryConsume("MODIFIER") || ""
      });
      continue;
    }
    mustConsume("END");
  }
  return result;
}
__name(parse, "parse");
function match(str, options) {
  var keys = [];
  var re = pathToRegexp(str, keys, options);
  return regexpToFunction(re, keys, options);
}
__name(match, "match");
function regexpToFunction(re, keys, options) {
  if (options === void 0) {
    options = {};
  }
  var _a = options.decode, decode = _a === void 0 ? function(x) {
    return x;
  } : _a;
  return function(pathname) {
    var m = re.exec(pathname);
    if (!m)
      return false;
    var path = m[0], index = m.index;
    var params = /* @__PURE__ */ Object.create(null);
    var _loop_1 = /* @__PURE__ */ __name(function(i2) {
      if (m[i2] === void 0)
        return "continue";
      var key = keys[i2 - 1];
      if (key.modifier === "*" || key.modifier === "+") {
        params[key.name] = m[i2].split(key.prefix + key.suffix).map(function(value) {
          return decode(value, key);
        });
      } else {
        params[key.name] = decode(m[i2], key);
      }
    }, "_loop_1");
    for (var i = 1; i < m.length; i++) {
      _loop_1(i);
    }
    return { path, index, params };
  };
}
__name(regexpToFunction, "regexpToFunction");
function escapeString(str) {
  return str.replace(/([.+*?=^!:${}()[\]|/\\])/g, "\\$1");
}
__name(escapeString, "escapeString");
function flags(options) {
  return options && options.sensitive ? "" : "i";
}
__name(flags, "flags");
function regexpToRegexp(path, keys) {
  if (!keys)
    return path;
  var groupsRegex = /\((?:\?<(.*?)>)?(?!\?)/g;
  var index = 0;
  var execResult = groupsRegex.exec(path.source);
  while (execResult) {
    keys.push({
      // Use parenthesized substring match if available, index otherwise
      name: execResult[1] || index++,
      prefix: "",
      suffix: "",
      modifier: "",
      pattern: ""
    });
    execResult = groupsRegex.exec(path.source);
  }
  return path;
}
__name(regexpToRegexp, "regexpToRegexp");
function arrayToRegexp(paths, keys, options) {
  var parts = paths.map(function(path) {
    return pathToRegexp(path, keys, options).source;
  });
  return new RegExp("(?:".concat(parts.join("|"), ")"), flags(options));
}
__name(arrayToRegexp, "arrayToRegexp");
function stringToRegexp(path, keys, options) {
  return tokensToRegexp(parse(path, options), keys, options);
}
__name(stringToRegexp, "stringToRegexp");
function tokensToRegexp(tokens, keys, options) {
  if (options === void 0) {
    options = {};
  }
  var _a = options.strict, strict = _a === void 0 ? false : _a, _b = options.start, start = _b === void 0 ? true : _b, _c = options.end, end = _c === void 0 ? true : _c, _d = options.encode, encode = _d === void 0 ? function(x) {
    return x;
  } : _d, _e = options.delimiter, delimiter = _e === void 0 ? "/#?" : _e, _f = options.endsWith, endsWith = _f === void 0 ? "" : _f;
  var endsWithRe = "[".concat(escapeString(endsWith), "]|$");
  var delimiterRe = "[".concat(escapeString(delimiter), "]");
  var route = start ? "^" : "";
  for (var _i = 0, tokens_1 = tokens; _i < tokens_1.length; _i++) {
    var token = tokens_1[_i];
    if (typeof token === "string") {
      route += escapeString(encode(token));
    } else {
      var prefix = escapeString(encode(token.prefix));
      var suffix = escapeString(encode(token.suffix));
      if (token.pattern) {
        if (keys)
          keys.push(token);
        if (prefix || suffix) {
          if (token.modifier === "+" || token.modifier === "*") {
            var mod = token.modifier === "*" ? "?" : "";
            route += "(?:".concat(prefix, "((?:").concat(token.pattern, ")(?:").concat(suffix).concat(prefix, "(?:").concat(token.pattern, "))*)").concat(suffix, ")").concat(mod);
          } else {
            route += "(?:".concat(prefix, "(").concat(token.pattern, ")").concat(suffix, ")").concat(token.modifier);
          }
        } else {
          if (token.modifier === "+" || token.modifier === "*") {
            throw new TypeError('Can not repeat "'.concat(token.name, '" without a prefix and suffix'));
          }
          route += "(".concat(token.pattern, ")").concat(token.modifier);
        }
      } else {
        route += "(?:".concat(prefix).concat(suffix, ")").concat(token.modifier);
      }
    }
  }
  if (end) {
    if (!strict)
      route += "".concat(delimiterRe, "?");
    route += !options.endsWith ? "$" : "(?=".concat(endsWithRe, ")");
  } else {
    var endToken = tokens[tokens.length - 1];
    var isEndDelimited = typeof endToken === "string" ? delimiterRe.indexOf(endToken[endToken.length - 1]) > -1 : endToken === void 0;
    if (!strict) {
      route += "(?:".concat(delimiterRe, "(?=").concat(endsWithRe, "))?");
    }
    if (!isEndDelimited) {
      route += "(?=".concat(delimiterRe, "|").concat(endsWithRe, ")");
    }
  }
  return new RegExp(route, flags(options));
}
__name(tokensToRegexp, "tokensToRegexp");
function pathToRegexp(path, keys, options) {
  if (path instanceof RegExp)
    return regexpToRegexp(path, keys);
  if (Array.isArray(path))
    return arrayToRegexp(path, keys, options);
  return stringToRegexp(path, keys, options);
}
__name(pathToRegexp, "pathToRegexp");

// ../../../AppData/Roaming/npm/node_modules/wrangler/templates/pages-template-worker.ts
var escapeRegex = /[.+?^${}()|[\]\\]/g;
function* executeRequest(request) {
  const requestPath = new URL(request.url).pathname;
  for (const route of [...routes].reverse()) {
    if (route.method && route.method !== request.method) {
      continue;
    }
    const routeMatcher = match(route.routePath.replace(escapeRegex, "\\$&"), {
      end: false
    });
    const mountMatcher = match(route.mountPath.replace(escapeRegex, "\\$&"), {
      end: false
    });
    const matchResult = routeMatcher(requestPath);
    const mountMatchResult = mountMatcher(requestPath);
    if (matchResult && mountMatchResult) {
      for (const handler of route.middlewares.flat()) {
        yield {
          handler,
          params: matchResult.params,
          path: mountMatchResult.path
        };
      }
    }
  }
  for (const route of routes) {
    if (route.method && route.method !== request.method) {
      continue;
    }
    const routeMatcher = match(route.routePath.replace(escapeRegex, "\\$&"), {
      end: true
    });
    const mountMatcher = match(route.mountPath.replace(escapeRegex, "\\$&"), {
      end: false
    });
    const matchResult = routeMatcher(requestPath);
    const mountMatchResult = mountMatcher(requestPath);
    if (matchResult && mountMatchResult && route.modules.length) {
      for (const handler of route.modules.flat()) {
        yield {
          handler,
          params: matchResult.params,
          path: matchResult.path
        };
      }
      break;
    }
  }
}
__name(executeRequest, "executeRequest");
var pages_template_worker_default = {
  async fetch(originalRequest, env, workerContext) {
    let request = originalRequest;
    const handlerIterator = executeRequest(request);
    let data = {};
    let isFailOpen = false;
    const next = /* @__PURE__ */ __name(async (input, init) => {
      if (input !== void 0) {
        let url = input;
        if (typeof input === "string") {
          url = new URL(input, request.url).toString();
        }
        request = new Request(url, init);
      }
      const result = handlerIterator.next();
      if (result.done === false) {
        const { handler, params, path } = result.value;
        const context = {
          request: new Request(request.clone()),
          functionPath: path,
          next,
          params,
          get data() {
            return data;
          },
          set data(value) {
            if (typeof value !== "object" || value === null) {
              throw new Error("context.data must be an object");
            }
            data = value;
          },
          env,
          waitUntil: workerContext.waitUntil.bind(workerContext),
          passThroughOnException: /* @__PURE__ */ __name(() => {
            isFailOpen = true;
          }, "passThroughOnException")
        };
        const response = await handler(context);
        if (!(response instanceof Response)) {
          throw new Error("Your Pages function should return a Response");
        }
        return cloneResponse(response);
      } else if ("ASSETS") {
        const response = await env["ASSETS"].fetch(request);
        return cloneResponse(response);
      } else {
        const response = await fetch(request);
        return cloneResponse(response);
      }
    }, "next");
    try {
      return await next();
    } catch (error) {
      if (isFailOpen) {
        const response = await env["ASSETS"].fetch(request);
        return cloneResponse(response);
      }
      throw error;
    }
  }
};
var cloneResponse = /* @__PURE__ */ __name((response) => (
  // https://fetch.spec.whatwg.org/#null-body-status
  new Response(
    [101, 204, 205, 304].includes(response.status) ? null : response.body,
    response
  )
), "cloneResponse");
export {
  pages_template_worker_default as default
};
