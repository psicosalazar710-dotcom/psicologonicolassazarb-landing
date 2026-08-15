<?php
/**
 * SISTEMA DE AGENDAMIENTO — Psicólogo Nicolás Salazar Barbosa
 * Integración con Google Calendar API via cuenta de servicio
 * Sesiones de 1 hora | L-V 9am-9pm | S 9am-12pm
 *
 * Adaptado para Hostinger a partir del calendar.php original:
 * - Las credenciales viven fuera de public_html (ver CREDENTIALS_FILE).
 * - action=book queda desactivado a propósito (BOOKING_ENABLED = false):
 *   el flujo actual de agendar.html termina en WhatsApp, no crea eventos
 *   ni envía correos automáticamente. La lógica original se conserva
 *   intacta más abajo para poder reactivarla en el futuro solo cambiando
 *   esa constante.
 */

date_default_timezone_set('America/Bogota');

// Capturar cualquier output inesperado para no corromper el JSON
ob_start();

header('Content-Type: application/json; charset=UTF-8');
header('Access-Control-Allow-Origin: *');
header('Cache-Control: no-cache, no-store, must-revalidate');

// ── CONFIG ────────────────────────────────────────────────
// Un nivel por encima de public_html (fuera del webroot, no accesible por HTTP).
define('CREDENTIALS_FILE', dirname(__DIR__, 2) . '/google-credentials.json');
define('CALENDAR_ID',      'psicosalazar710@gmail.com');
define('SESSION_DURATION', 60);
define('SLOT_INTERVAL',    60);
define('DAYS_AHEAD',       60);
define('THERAPIST_EMAIL_CAL', 'psicosalazar710@gmail.com');
define('THERAPIST_NAME_CAL',  'Psicólogo Nicolás Salazar Barbosa');

// Reserva automática desactivada: el flujo actual confirma por WhatsApp.
define('BOOKING_ENABLED', false);

// Horarios de atención (hora Colombia)
$schedule = [
    1 => ['start' => '09:00', 'end' => '21:00'], // Lunes
    2 => ['start' => '09:00', 'end' => '21:00'], // Martes
    3 => ['start' => '09:00', 'end' => '21:00'], // Miércoles
    4 => ['start' => '09:00', 'end' => '21:00'], // Jueves
    5 => ['start' => '09:00', 'end' => '21:00'], // Viernes
    6 => ['start' => '09:00', 'end' => '12:00'], // Sábado
    0 => null,                                    // Domingo cerrado
];

$action = $_GET['action'] ?? $_POST['action'] ?? 'slots';

// ── HELPERS ───────────────────────────────────────────────
function base64url_encode(string $data): string {
    return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
}

function httpPost(string $url, array $data): string {
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => http_build_query($data),
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_SSL_VERIFYPEER => true,
    ]);
    $resp = curl_exec($ch);
    curl_close($ch);
    return (string)$resp;
}

function calendarGet(string $token, string $endpoint): array {
    $ch = curl_init('https://www.googleapis.com/calendar/v3/' . $endpoint);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER     => ['Authorization: Bearer ' . $token],
        CURLOPT_SSL_VERIFYPEER => true,
    ]);
    $resp = curl_exec($ch);
    curl_close($ch);
    return json_decode((string)$resp, true) ?? [];
}

function calendarPost(string $token, string $endpoint, array $body): array {
    $ch = curl_init('https://www.googleapis.com/calendar/v3/' . $endpoint);
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => json_encode($body),
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER     => [
            'Authorization: Bearer ' . $token,
            'Content-Type: application/json',
        ],
        CURLOPT_SSL_VERIFYPEER => true,
    ]);
    $resp = curl_exec($ch);
    curl_close($ch);
    return json_decode((string)$resp, true) ?? [];
}

// ── GOOGLE AUTH ───────────────────────────────────────────
function getAccessToken(): string {
    if (!file_exists(CREDENTIALS_FILE)) {
        throw new Exception('Archivo de credenciales no encontrado.');
    }
    $creds = json_decode(file_get_contents(CREDENTIALS_FILE), true);
    $now   = time();
    $exp   = $now + 3600;

    $header  = base64url_encode(json_encode(['alg' => 'RS256', 'typ' => 'JWT']));
    $payload = base64url_encode(json_encode([
        'iss'   => $creds['client_email'],
        'scope' => 'https://www.googleapis.com/auth/calendar',
        'aud'   => 'https://oauth2.googleapis.com/token',
        'iat'   => $now,
        'exp'   => $exp,
    ]));

    $signing = $header . '.' . $payload;
    $key     = openssl_pkey_get_private($creds['private_key']);
    openssl_sign($signing, $signature, $key, OPENSSL_ALGO_SHA256);
    $jwt = $signing . '.' . base64url_encode($signature);

    $resp = httpPost('https://oauth2.googleapis.com/token', [
        'grant_type' => 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        'assertion'  => $jwt,
    ]);
    $data = json_decode($resp, true);
    if (!isset($data['access_token'])) {
        throw new Exception('Error autenticando con Google: ' . ($data['error_description'] ?? $resp));
    }
    return $data['access_token'];
}

// ── GET BUSY SLOTS ────────────────────────────────────────
function getBusySlots(string $token, string $dateMin, string $dateMax): array {
    $calId  = urlencode(CALENDAR_ID);
    $params = http_build_query([
        'timeMin'      => $dateMin,
        'timeMax'      => $dateMax,
        'singleEvents' => 'true',
        'orderBy'      => 'startTime',
    ]);
    $events = calendarGet($token, "calendars/{$calId}/events?{$params}");
    $busy   = [];
    foreach ($events['items'] ?? [] as $event) {
        if (($event['status'] ?? '') === 'cancelled') continue;

        // Evento con hora exacta
        $start = $event['start']['dateTime'] ?? null;
        $end   = $event['end']['dateTime']   ?? null;
        if ($start && $end) {
            $busy[] = [
                'start' => strtotime($start),
                'end'   => strtotime($end),
            ];
            continue;
        }

        // Evento de dia completo (festivo, vacaciones, bloqueo)
        $startDate = $event['start']['date'] ?? null;
        $endDate   = $event['end']['date']   ?? null;
        if ($startDate && $endDate) {
            $tz        = new DateTimeZone('America/Bogota');
            $dayCursor = new DateTime($startDate, $tz);
            $dayEnd    = new DateTime($endDate, $tz);
            while ($dayCursor < $dayEnd) {
                $dayStart = clone $dayCursor; $dayStart->setTime(0, 0, 0);
                $dayClose = clone $dayCursor; $dayClose->setTime(23, 59, 59);
                $busy[] = [
                    'start' => $dayStart->getTimestamp(),
                    'end'   => $dayClose->getTimestamp(),
                ];
                $dayCursor->modify('+1 day');
            }
        }
    }
    return $busy;
}

// ── GENERATE AVAILABLE SLOTS ──────────────────────────────
function generateSlots(array $schedule, array $busy): array {
    $slots = [];
    $today = new DateTime('today', new DateTimeZone('America/Bogota'));

    // Sin agendamiento el mismo día: solo mostrar slots desde mañana en adelante
    $minTime = new DateTime('tomorrow', new DateTimeZone('America/Bogota'));
    $minTime->setTime(0, 0, 0);

    for ($d = 0; $d < DAYS_AHEAD; $d++) {
        $date    = clone $today;
        $date->modify("+{$d} days");
        $dow     = (int)$date->format('w');
        $dayConf = $schedule[$dow] ?? null;
        if (!$dayConf) continue;

        $dateStr = $date->format('Y-m-d');
        $start   = new DateTime("{$dateStr} {$dayConf['start']}:00", new DateTimeZone('America/Bogota'));
        $end     = new DateTime("{$dateStr} {$dayConf['end']}:00",   new DateTimeZone('America/Bogota'));
        $cursor  = clone $start;

        while ($cursor < $end) {
            $slotEnd = clone $cursor;
            $slotEnd->modify('+' . SESSION_DURATION . ' minutes');
            if ($slotEnd > $end) break;

            if ($cursor < $minTime) {
                $cursor->modify('+' . SLOT_INTERVAL . ' minutes');
                continue;
            }

            $slotStartTs = $cursor->getTimestamp();
            $slotEndTs   = $slotEnd->getTimestamp();
            $isBusy = false;
            foreach ($busy as $b) {
                if ($slotStartTs < $b['end'] && $slotEndTs > $b['start']) {
                    $isBusy = true;
                    break;
                }
            }

            if (!$isBusy) {
                $slots[$dateStr][] = [
                    'start'    => $cursor->format('H:i'),
                    'end'      => $slotEnd->format('H:i'),
                    'startISO' => $cursor->format('c'),
                    'endISO'   => $slotEnd->format('c'),
                    'label'    => $cursor->format('g:i A'),
                ];
            }
            $cursor->modify('+' . SLOT_INTERVAL . ' minutes');
        }
    }
    return $slots;
}

// ── SEND CONFIRMATION EMAIL ───────────────────────────────
// Conservada para cuando se reactive BOOKING_ENABLED; no se invoca mientras esté en false.
function sendConfirmation(array $booking): void {
    $name    = $booking['name'];
    $email   = $booking['email'];
    $phone   = $booking['phone'];
    $service = $booking['service'];
    $mode    = $booking['mode'];
    $date    = $booking['date_label'];
    $time    = $booking['time_label'];

    $subj_p = '=?UTF-8?B?' . base64_encode('Cita confirmada - Psicologo Nicolas Salazar') . '?=';
    $body_p  = "Hola {$name},\r\n\r\n";
    $body_p .= "Tu cita ha sido confirmada. Aqui los detalles:\r\n\r\n";
    $body_p .= "Fecha    : {$date}\r\n";
    $body_p .= "Hora     : {$time}\r\n";
    $body_p .= "Servicio : {$service}\r\n";
    $body_p .= "Modalidad: {$mode}\r\n\r\n";
    if ($mode === 'Online') {
        $body_p .= "Te enviare el enlace de videollamada por WhatsApp antes de la sesion.\r\n\r\n";
    } else {
        $body_p .= "Direccion: Cl. 52 #20-15, Bogota\r\n\r\n";
    }
    $body_p .= "Si necesitas reagendar o cancelar, escribeme por WhatsApp: +57 311 572 5459\r\n\r\n";
    $body_p .= "Nos vemos pronto,\r\nPsicologo Nicolas Salazar Barbosa\r\npsicologonicolassalazarb.com\r\n";
    $h_p = "From: Psicologo Nicolas Salazar <psicosalazar710@gmail.com>\r\nReply-To: psicosalazar710@gmail.com\r\nContent-Type: text/plain; charset=UTF-8\r\n";
    mail($email, $subj_p, $body_p, $h_p);

    $subj_t = '=?UTF-8?B?' . base64_encode("Nueva cita - {$name} - {$date} {$time}") . '?=';
    $body_t  = "NUEVA CITA AGENDADA\r\n" . str_repeat('-', 40) . "\r\n";
    $body_t .= "Paciente  : {$name}\r\nCorreo    : {$email}\r\nTelefono  : {$phone}\r\n";
    $body_t .= "Servicio  : {$service}\r\nModalidad : {$mode}\r\nFecha     : {$date}\r\nHora      : {$time}\r\n";
    $body_t .= str_repeat('-', 40) . "\r\nCita registrada en Google Calendar.\r\n";
    $h_t = "From: Portal Agendamiento <psicosalazar710@gmail.com>\r\nContent-Type: text/plain; charset=UTF-8\r\n";
    mail(THERAPIST_EMAIL_CAL, $subj_t, $body_t, $h_t);
}

// ═══════════════════════════════════════════════════════════
// ROUTES
// ═══════════════════════════════════════════════════════════
try {
    if ($action === 'slots') {
        $token   = getAccessToken();
        $dateMin = (new DateTime('today', new DateTimeZone('America/Bogota')))->format('c');
        $dateMax = (new DateTime('+' . DAYS_AHEAD . ' days', new DateTimeZone('America/Bogota')))->format('c');
        $busy    = getBusySlots($token, $dateMin, $dateMax);
        $slots   = generateSlots($schedule, $busy);

        $days_es   = ['Domingo','Lunes','Martes','Miercoles','Jueves','Viernes','Sabado'];
        $months_es = ['','enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
        $formatted = [];

        foreach ($slots as $date => $times) {
            $ts  = strtotime($date);
            $dow = (int)date('w', $ts);
            $d   = (int)date('j', $ts);
            $m   = (int)date('n', $ts);
            $formatted[] = [
                'date'      => $date,
                'label'     => $days_es[$dow] . ', ' . $d . ' de ' . $months_es[$m],
                'day_short' => strtoupper(substr($days_es[$dow], 0, 3)),
                'day_num'   => $d,
                'month'     => strtoupper(substr($months_es[$m], 0, 3)),
                'slots'     => $times,
            ];
        }

        ob_end_clean();
        echo json_encode(['success' => true, 'days' => $formatted], JSON_UNESCAPED_UNICODE);
        exit;
    }

    if ($action === 'book') {
        if (!BOOKING_ENABLED) {
            ob_end_clean();
            echo json_encode([
                'success' => false,
                'error'   => 'La reserva automatica no esta disponible en este momento. Confirma tu cita por WhatsApp.',
            ], JSON_UNESCAPED_UNICODE);
            exit;
        }

        $input   = json_decode(file_get_contents('php://input'), true) ?? $_POST;
        $name    = trim($input['name']     ?? '');
        $email   = trim($input['email']    ?? '');
        $phone   = trim($input['phone']    ?? '');
        $service = trim($input['service']  ?? 'Psicoterapia Individual');
        $mode    = trim($input['mode']     ?? 'Presencial');
        $startISO = trim($input['startISO'] ?? '');
        $endISO   = trim($input['endISO']   ?? '');

        if (!$name || !$email || !$startISO || !$endISO) {
            ob_end_clean();
            echo json_encode(['success' => false, 'error' => 'Completa todos los campos requeridos.']);
            exit;
        }

        $token = getAccessToken();
        $event = [
            'summary'     => "Sesion - {$name}",
            'description' => "Servicio: {$service}\nModalidad: {$mode}\nTel: {$phone}\nCorreo: {$email}\nAgendado desde psicologonicolassalazarb.com",
            'start'       => ['dateTime' => $startISO, 'timeZone' => 'America/Bogota'],
            'end'         => ['dateTime' => $endISO,   'timeZone' => 'America/Bogota'],
            'attendees'   => [['email' => $email, 'displayName' => $name]],
            'reminders'   => [
                'useDefault' => false,
                'overrides'  => [
                    ['method' => 'email',  'minutes' => 1440],
                    ['method' => 'email',  'minutes' => 60],
                    ['method' => 'popup',  'minutes' => 30],
                ],
            ],
            'colorId' => '7',
        ];

        $calId   = urlencode(CALENDAR_ID);
        $created = calendarPost($token, "calendars/{$calId}/events?sendUpdates=none", $event);

        if (!isset($created['id'])) {
            // Extraer el mensaje real de Google para facilitar diagnóstico
            $gcal_code = isset($created['error']['code'])    ? $created['error']['code']    : 0;
            $gcal_msg  = isset($created['error']['message']) ? $created['error']['message'] : 'Respuesta inesperada de Google Calendar.';
            if ($gcal_code === 403) {
                $human_msg = 'La cuenta de servicio no tiene permiso de escritura en el calendario.';
            } elseif ($gcal_code === 401) {
                $human_msg = 'Error de autenticación con Google Calendar. Verifica las credenciales.';
            } elseif ($gcal_code === 409) {
                $human_msg = 'Este horario ya no está disponible. Por favor elige otro.';
            } else {
                $human_msg = 'No se pudo registrar la cita en el calendario. Intenta de nuevo.';
            }
            ob_end_clean();
            echo json_encode([
                'success' => false,
                'error'   => $human_msg,
                'gcal'    => "[{$gcal_code}] {$gcal_msg}",
            ], JSON_UNESCAPED_UNICODE);
            exit;
        }

        $startDt   = new DateTime($startISO, new DateTimeZone('America/Bogota'));
        $days_es   = ['Domingo','Lunes','Martes','Miercoles','Jueves','Viernes','Sabado'];
        $months_es = ['','enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
        $booking = [
            'name'       => $name,
            'email'      => $email,
            'phone'      => $phone,
            'service'    => $service,
            'mode'       => $mode,
            'date_label' => $days_es[(int)$startDt->format('w')] . ', ' . (int)$startDt->format('j') . ' de ' . $months_es[(int)$startDt->format('n')] . ' de ' . $startDt->format('Y'),
            'time_label' => $startDt->format('g:i A') . ' (hora Colombia)',
        ];

        sendConfirmation($booking);

        ob_end_clean();
        echo json_encode([
            'success'    => true,
            'message'    => "Cita confirmada. Revisa tu correo {$email} para los detalles.",
            'event_id'   => $created['id'],
            'date_label' => $booking['date_label'],
            'time_label' => $booking['time_label'],
        ], JSON_UNESCAPED_UNICODE);
        exit;
    }

    ob_end_clean();
    echo json_encode(['success' => false, 'error' => 'Accion no reconocida.']);

} catch (Exception $e) {
    ob_end_clean();
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => $e->getMessage()]);
}
