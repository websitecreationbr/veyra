package com.veyra.ai;

import android.Manifest;
import android.content.ActivityNotFoundException;
import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.ContentValues;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
import android.provider.AlarmClock;
import android.provider.CalendarContract;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Locale;
import java.util.TimeZone;

/**
 * Ponte nativa da VEYRA AI: voz (entrada e saída), alarme e calendário do aparelho.
 * Usa SOMENTE APIs oficiais do Android (SpeechRecognizer, TextToSpeech, AlarmClock, CalendarContract),
 * sem serviços pagos e sem nada exclusivo da Samsung. Cada método devolve o que realmente aconteceu:
 * { ok: true, ... } ou { ok: false, error: "codigo" }.
 */
@CapacitorPlugin(
    name = "VeyraNative",
    permissions = {
        @Permission(alias = "microphone", strings = { Manifest.permission.RECORD_AUDIO }),
        @Permission(alias = "calendar", strings = { Manifest.permission.READ_CALENDAR, Manifest.permission.WRITE_CALENDAR })
    }
)
public class VeyraNativePlugin extends Plugin {

    // ------------------------------------------------------------------ utilidades
    private static JSObject fail(String code) {
        JSObject o = new JSObject();
        o.put("ok", false);
        o.put("error", code);
        return o;
    }

    private static JSObject ok() {
        JSObject o = new JSObject();
        o.put("ok", true);
        return o;
    }

    private static boolean validTime(String t) {
        return t != null && t.matches("^([01]\\d|2[0-3]):[0-5]\\d$");
    }

    private static boolean validDate(String d) {
        return d != null && d.matches("^\\d{4}-\\d{2}-\\d{2}$");
    }

    /** Converte "AAAA-MM-DD" + "HH:mm" para milissegundos no fuso do aparelho. */
    private static long toMillis(String date, String time) {
        Calendar c = Calendar.getInstance();
        c.clear();
        c.set(Integer.parseInt(date.substring(0, 4)), Integer.parseInt(date.substring(5, 7)) - 1, Integer.parseInt(date.substring(8, 10)),
            Integer.parseInt(time.substring(0, 2)), Integer.parseInt(time.substring(3, 5)), 0);
        return c.getTimeInMillis();
    }

    private static String fmt(long millis, boolean allDay) {
        SimpleDateFormat f = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm", Locale.US);
        f.setTimeZone(allDay ? TimeZone.getTimeZone("UTC") : TimeZone.getDefault());
        return f.format(millis);
    }

    // ------------------------------------------------------------------ capacidades
    @com.getcapacitor.PluginMethod
    public void capabilities(PluginCall call) {
        JSObject o = new JSObject();
        o.put("speech", SpeechRecognizer.isRecognitionAvailable(getContext()));
        o.put("tts", true);
        Intent alarm = new Intent(AlarmClock.ACTION_SET_ALARM);
        o.put("alarm", alarm.resolveActivity(getContext().getPackageManager()) != null);
        o.put("calendar", true);
        call.resolve(o);
    }

    // ------------------------------------------------------------------ reconhecimento de voz
    private SpeechRecognizer recognizer;
    private PluginCall listenCall;
    private boolean listenCancelled;

    @com.getcapacitor.PluginMethod
    public void listen(PluginCall call) {
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            requestPermissionForAlias("microphone", call, "micPermCallback");
            return;
        }
        startListening(call);
    }

    @PermissionCallback
    private void micPermCallback(PluginCall call) {
        if (getPermissionState("microphone") == PermissionState.GRANTED) startListening(call);
        else call.resolve(fail("permissao_negada"));
    }

    private void startListening(final PluginCall call) {
        if (!SpeechRecognizer.isRecognitionAvailable(getContext())) {
            call.resolve(fail("indisponivel"));
            return;
        }
        final String lang = call.getString("lang", "pt-BR");
        getActivity().runOnUiThread(new Runnable() {
            @Override public void run() {
                if (listenCall != null) { call.resolve(fail("ocupado")); return; }
                listenCall = call;
                listenCancelled = false;
                recognizer = SpeechRecognizer.createSpeechRecognizer(getContext());
                recognizer.setRecognitionListener(new RecognitionListener() {
                    @Override public void onReadyForSpeech(Bundle params) { }
                    @Override public void onBeginningOfSpeech() { }
                    @Override public void onRmsChanged(float rmsdB) { }
                    @Override public void onBufferReceived(byte[] buffer) { }
                    @Override public void onEndOfSpeech() { }
                    @Override public void onPartialResults(Bundle partialResults) { }
                    @Override public void onEvent(int eventType, Bundle params) { }
                    @Override public void onError(int error) { finishListening(null, mapSpeechError(error)); }
                    @Override public void onResults(Bundle results) {
                        ArrayList<String> list = results == null ? null : results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                        String text = (list == null || list.isEmpty()) ? null : list.get(0);
                        if (text == null || text.trim().isEmpty()) finishListening(null, "sem_fala");
                        else finishListening(text.trim(), null);
                    }
                });
                Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
                i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
                i.putExtra(RecognizerIntent.EXTRA_LANGUAGE, lang);
                i.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, false);
                i.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
                i.putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, getContext().getPackageName());
                try {
                    recognizer.startListening(i);
                } catch (Exception e) {
                    finishListening(null, "indisponivel");
                }
            }
        });
    }

    private static String mapSpeechError(int error) {
        switch (error) {
            case SpeechRecognizer.ERROR_NO_MATCH: return "nao_entendi";
            case SpeechRecognizer.ERROR_SPEECH_TIMEOUT: return "sem_fala";
            case SpeechRecognizer.ERROR_NETWORK:
            case SpeechRecognizer.ERROR_NETWORK_TIMEOUT:
            case SpeechRecognizer.ERROR_SERVER: return "rede";
            case SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS: return "permissao_negada";
            case SpeechRecognizer.ERROR_AUDIO: return "audio";
            case SpeechRecognizer.ERROR_RECOGNIZER_BUSY: return "ocupado";
            default: return "erro";
        }
    }

    /** Sempre na thread principal. Resolve a chamada pendente uma única vez e libera o reconhecedor. */
    private void finishListening(String text, String error) {
        PluginCall c = listenCall;
        listenCall = null;
        if (recognizer != null) {
            try { recognizer.destroy(); } catch (Exception ignored) { }
            recognizer = null;
        }
        if (c == null) return;
        if (listenCancelled) { c.resolve(fail("cancelado")); return; }
        if (text != null) {
            JSObject o = ok();
            o.put("text", text);
            c.resolve(o);
        } else {
            c.resolve(fail(error == null ? "erro" : error));
        }
    }

    @com.getcapacitor.PluginMethod
    public void cancelListen(final PluginCall call) {
        getActivity().runOnUiThread(new Runnable() {
            @Override public void run() {
                listenCancelled = true;
                if (recognizer != null) {
                    try { recognizer.cancel(); } catch (Exception ignored) { }
                }
                finishListening(null, "cancelado");
                call.resolve(ok());
            }
        });
    }

    // ------------------------------------------------------------------ fala (TTS)
    private TextToSpeech tts;
    private boolean ttsReady;
    private PluginCall speakCall;

    @com.getcapacitor.PluginMethod
    public void speak(final PluginCall call) {
        final String text = call.getString("text", "");
        final String lang = call.getString("lang", "pt-BR");
        if (text == null || text.trim().isEmpty()) { call.resolve(ok()); return; }
        getActivity().runOnUiThread(new Runnable() {
            @Override public void run() {
                if (tts != null && ttsReady) { doSpeak(call, text, lang); return; }
                if (tts != null) { call.resolve(fail("ocupado")); return; }
                tts = new TextToSpeech(getContext(), new TextToSpeech.OnInitListener() {
                    @Override public void onInit(int status) {
                        if (status != TextToSpeech.SUCCESS) {
                            tts = null; ttsReady = false;
                            call.resolve(fail("indisponivel"));
                            return;
                        }
                        ttsReady = true;
                        tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                            @Override public void onStart(String utteranceId) { }
                            @Override public void onDone(String utteranceId) { endSpeak(ok()); }
                            @Override public void onError(String utteranceId) { endSpeak(fail("erro")); }
                        });
                        doSpeak(call, text, lang);
                    }
                });
            }
        });
    }

    private void doSpeak(PluginCall call, String text, String lang) {
        String[] parts = lang.split("-");
        Locale locale = parts.length > 1 ? new Locale(parts[0], parts[1]) : new Locale(parts[0]);
        int r = tts.setLanguage(locale);
        if (r == TextToSpeech.LANG_MISSING_DATA || r == TextToSpeech.LANG_NOT_SUPPORTED) {
            call.resolve(fail("idioma_indisponivel"));
            return;
        }
        if (speakCall != null) endSpeak(ok());
        speakCall = call;
        int res = tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "veyra-" + System.nanoTime());
        if (res != TextToSpeech.SUCCESS) endSpeak(fail("erro"));
    }

    private void endSpeak(JSObject result) {
        PluginCall c = speakCall;
        speakCall = null;
        if (c != null) c.resolve(result);
    }

    @com.getcapacitor.PluginMethod
    public void stopSpeaking(final PluginCall call) {
        getActivity().runOnUiThread(new Runnable() {
            @Override public void run() {
                if (tts != null) { try { tts.stop(); } catch (Exception ignored) { } }
                endSpeak(ok());
                call.resolve(ok());
            }
        });
    }

    @Override
    protected void handleOnDestroy() {
        if (recognizer != null) { try { recognizer.destroy(); } catch (Exception ignored) { } recognizer = null; }
        if (tts != null) { try { tts.stop(); tts.shutdown(); } catch (Exception ignored) { } tts = null; }
        super.handleOnDestroy();
    }

    // ------------------------------------------------------------------ alarme (intent oficial do app Relógio)
    @com.getcapacitor.PluginMethod
    public void setAlarm(PluginCall call) {
        String hora = call.getString("hora");
        if (!validTime(hora)) { call.resolve(fail("hora_invalida")); return; }
        Intent i = new Intent(AlarmClock.ACTION_SET_ALARM);
        i.putExtra(AlarmClock.EXTRA_HOUR, Integer.parseInt(hora.substring(0, 2)));
        i.putExtra(AlarmClock.EXTRA_MINUTES, Integer.parseInt(hora.substring(3, 5)));
        String rotulo = call.getString("rotulo", "");
        i.putExtra(AlarmClock.EXTRA_MESSAGE, rotulo == null || rotulo.isEmpty() ? "Veyra" : rotulo);
        i.putExtra(AlarmClock.EXTRA_SKIP_UI, false); // o app Relógio mostra o alarme para o usuário confirmar
        JSArray dias = call.getArray("dias");
        if (dias != null && dias.length() > 0) {
            ArrayList<Integer> days = new ArrayList<Integer>();
            for (int k = 0; k < dias.length(); k++) {
                int d = dayOf(dias.optString(k));
                if (d > 0 && !days.contains(d)) days.add(d);
            }
            if (!days.isEmpty()) i.putExtra(AlarmClock.EXTRA_DAYS, days);
        }
        try {
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            // ok = o pedido foi ENTREGUE ao app Relógio. O Android não informa se o alarme foi salvo.
            JSObject o = ok();
            o.put("delivered", true);
            call.resolve(o);
        } catch (ActivityNotFoundException e) {
            call.resolve(fail("sem_app"));
        } catch (SecurityException e) {
            call.resolve(fail("permissao_negada"));
        } catch (Exception e) {
            call.resolve(fail("erro"));
        }
    }

    private static int dayOf(String d) {
        if (d == null) return -1;
        switch (d) {
            case "domingo": return Calendar.SUNDAY;
            case "segunda": return Calendar.MONDAY;
            case "terca": return Calendar.TUESDAY;
            case "quarta": return Calendar.WEDNESDAY;
            case "quinta": return Calendar.THURSDAY;
            case "sexta": return Calendar.FRIDAY;
            case "sabado": return Calendar.SATURDAY;
            default: return -1;
        }
    }

    // ------------------------------------------------------------------ calendário (CalendarContract, com permissão do usuário)
    private boolean needsCalendarPermission(PluginCall call) {
        if (getPermissionState("calendar") == PermissionState.GRANTED) return false;
        requestPermissionForAlias("calendar", call, "calendarPermCallback");
        return true;
    }

    @PermissionCallback
    private void calendarPermCallback(PluginCall call) {
        if (getPermissionState("calendar") != PermissionState.GRANTED) { call.resolve(fail("permissao_negada")); return; }
        String m = call.getMethodName();
        if ("calendarQuery".equals(m)) calendarQuery(call);
        else if ("calendarCreate".equals(m)) calendarCreate(call);
        else if ("calendarUpdate".equals(m)) calendarUpdate(call);
        else if ("calendarDelete".equals(m)) calendarDelete(call);
        else call.resolve(fail("erro"));
    }

    private static final String[] INSTANCE_COLS = {
        CalendarContract.Instances.EVENT_ID, CalendarContract.Instances.TITLE, CalendarContract.Instances.BEGIN,
        CalendarContract.Instances.END, CalendarContract.Instances.ALL_DAY, CalendarContract.Instances.EVENT_LOCATION
    };

    /** Eventos que começam entre [from, to) — inclui repetições. Máximo de 50. */
    private JSArray instances(long from, long to, boolean includeAllDay) {
        JSArray out = new JSArray();
        Uri.Builder b = CalendarContract.Instances.CONTENT_URI.buildUpon();
        ContentUris.appendId(b, from);
        ContentUris.appendId(b, to);
        Cursor c = null;
        try {
            c = getContext().getContentResolver().query(b.build(), INSTANCE_COLS, null, null, CalendarContract.Instances.BEGIN + " ASC");
            while (c != null && c.moveToNext() && out.length() < 50) {
                boolean allDay = c.getInt(4) == 1;
                if (allDay && !includeAllDay) continue;
                JSObject e = new JSObject();
                e.put("id", String.valueOf(c.getLong(0)));
                String title = c.getString(1);
                e.put("title", title == null || title.isEmpty() ? "(sem título)" : title);
                e.put("start", fmt(c.getLong(2), allDay));
                e.put("end", fmt(c.getLong(3), allDay));
                e.put("allDay", allDay);
                String loc = c.getString(5);
                if (loc != null && !loc.isEmpty()) e.put("location", loc);
                out.put(e);
            }
        } finally {
            if (c != null) c.close();
        }
        return out;
    }

    @com.getcapacitor.PluginMethod
    public void calendarQuery(PluginCall call) {
        if (needsCalendarPermission(call)) return;
        String de = call.getString("de"), ate = call.getString("ate");
        if (!validDate(de) || !validDate(ate)) { call.resolve(fail("data_invalida")); return; }
        try {
            long from = toMillis(de, "00:00");
            long to = toMillis(ate, "00:00") + 24L * 60 * 60 * 1000;
            JSObject o = ok();
            JSArray ev = instances(from, to, true);
            o.put("events", ev);
            o.put("truncated", ev.length() >= 50);
            call.resolve(o);
        } catch (SecurityException e) {
            call.resolve(fail("permissao_negada"));
        } catch (Exception e) {
            call.resolve(fail("erro"));
        }
    }

    /** Calendário gravável: o principal da conta, senão o primeiro visível e editável. */
    private long writableCalendarId() {
        Cursor c = null;
        long first = -1, primary = -1;
        try {
            c = getContext().getContentResolver().query(CalendarContract.Calendars.CONTENT_URI,
                new String[] { CalendarContract.Calendars._ID, CalendarContract.Calendars.IS_PRIMARY },
                CalendarContract.Calendars.CALENDAR_ACCESS_LEVEL + " >= ? AND " + CalendarContract.Calendars.VISIBLE + " = 1",
                new String[] { String.valueOf(CalendarContract.Calendars.CAL_ACCESS_CONTRIBUTOR) }, null);
            while (c != null && c.moveToNext()) {
                long id = c.getLong(0);
                if (first < 0) first = id;
                if (c.getInt(1) == 1 && primary < 0) primary = id;
            }
        } finally {
            if (c != null) c.close();
        }
        return primary >= 0 ? primary : first;
    }

    @com.getcapacitor.PluginMethod
    public void calendarCreate(PluginCall call) {
        if (needsCalendarPermission(call)) return;
        String titulo = call.getString("titulo", ""), data = call.getString("data"), hora = call.getString("hora");
        if (titulo == null || titulo.trim().isEmpty() || !validDate(data) || !validTime(hora)) { call.resolve(fail("dados_invalidos")); return; }
        try {
            int dur = call.getInt("duracao_min", 60);
            if (dur < 5 || dur > 1440) dur = 60;
            long start = toMillis(data, hora), end = start + dur * 60_000L;
            boolean ignorar = Boolean.TRUE.equals(call.getBoolean("ignorar_conflito", false));
            if (!ignorar) {
                JSArray conflicts = new JSArray();
                // Instances devolve tudo que SE SOBREPÕE à janela (inclui quem começou antes). Eventos que apenas
                // encostam (um termina exatamente quando o outro começa) não são conflito.
                String s0 = fmt(start, false), e0 = fmt(end, false);
                JSArray all = instances(start, end, false);
                for (int k = 0; k < all.length(); k++) {
                    JSONObject e = all.getJSONObject(k);
                    if (e.getString("end").compareTo(s0) <= 0 || e.getString("start").compareTo(e0) >= 0) continue;
                    conflicts.put(e);
                }
                if (conflicts.length() > 0) {
                    JSObject o = fail("conflito");
                    o.put("conflict", true);
                    o.put("conflicts", conflicts);
                    call.resolve(o);
                    return;
                }
            }
            long calId = writableCalendarId();
            if (calId < 0) { call.resolve(fail("sem_calendario")); return; }
            ContentValues v = new ContentValues();
            v.put(CalendarContract.Events.CALENDAR_ID, calId);
            v.put(CalendarContract.Events.TITLE, titulo.trim());
            v.put(CalendarContract.Events.DTSTART, start);
            v.put(CalendarContract.Events.DTEND, end);
            v.put(CalendarContract.Events.EVENT_TIMEZONE, TimeZone.getDefault().getID());
            String local = call.getString("local", ""), notas = call.getString("notas", "");
            if (local != null && !local.isEmpty()) v.put(CalendarContract.Events.EVENT_LOCATION, local);
            if (notas != null && !notas.isEmpty()) v.put(CalendarContract.Events.DESCRIPTION, notas);
            Uri uri = getContext().getContentResolver().insert(CalendarContract.Events.CONTENT_URI, v);
            if (uri == null) { call.resolve(fail("erro")); return; }
            long eventId = ContentUris.parseId(uri);
            try {
                ContentValues r = new ContentValues();
                r.put(CalendarContract.Reminders.EVENT_ID, eventId);
                r.put(CalendarContract.Reminders.MINUTES, 10);
                r.put(CalendarContract.Reminders.METHOD, CalendarContract.Reminders.METHOD_ALERT);
                getContext().getContentResolver().insert(CalendarContract.Reminders.CONTENT_URI, r);
            } catch (Exception ignored) { /* lembrete é extra; o evento já foi criado */ }
            JSObject o = ok();
            o.put("id", String.valueOf(eventId));
            call.resolve(o);
        } catch (SecurityException e) {
            call.resolve(fail("permissao_negada"));
        } catch (Exception e) {
            call.resolve(fail("erro"));
        }
    }

    /** Lê o evento atual (para alterar/excluir com segurança). null = não existe. */
    private JSObject readEvent(long id) {
        Cursor c = null;
        try {
            c = getContext().getContentResolver().query(ContentUris.withAppendedId(CalendarContract.Events.CONTENT_URI, id),
                new String[] { CalendarContract.Events.DTSTART, CalendarContract.Events.DTEND, CalendarContract.Events.RRULE, CalendarContract.Events.ALL_DAY, CalendarContract.Events.DELETED },
                null, null, null);
            if (c == null || !c.moveToFirst()) return null;
            if (c.getInt(4) == 1) return null;
            JSObject o = new JSObject();
            o.put("start", c.getLong(0));
            o.put("end", c.isNull(1) ? c.getLong(0) + 3600_000L : c.getLong(1));
            String rr = c.getString(2);
            o.put("recurring", rr != null && !rr.isEmpty());
            o.put("allDay", c.getInt(3) == 1);
            return o;
        } finally {
            if (c != null) c.close();
        }
    }

    private static long parseId(String s) {
        try { return Long.parseLong(s); } catch (Exception e) { return -1; }
    }

    @com.getcapacitor.PluginMethod
    public void calendarUpdate(PluginCall call) {
        if (needsCalendarPermission(call)) return;
        long id = parseId(call.getString("id_evento"));
        if (id < 0) { call.resolve(fail("dados_invalidos")); return; }
        try {
            JSObject cur = readEvent(id);
            if (cur == null) { call.resolve(fail("nao_encontrado")); return; }
            if (cur.getBoolean("recurring")) { call.resolve(fail("recorrente_nao_suportado")); return; }
            if (cur.getBoolean("allDay")) { call.resolve(fail("dia_inteiro_nao_suportado")); return; }
            ContentValues v = new ContentValues();
            String titulo = call.getString("titulo"), data = call.getString("data"), hora = call.getString("hora"), fim = call.getString("hora_fim");
            if (titulo != null && !titulo.trim().isEmpty()) v.put(CalendarContract.Events.TITLE, titulo.trim());
            long oldStart = cur.getLong("start"), oldEnd = cur.getLong("end");
            if (data != null || hora != null || fim != null) {
                String curDate = fmt(oldStart, false).substring(0, 10), curTime = fmt(oldStart, false).substring(11, 16);
                String nd = validDate(data) ? data : curDate, nt = validTime(hora) ? hora : curTime;
                long ns = toMillis(nd, nt), ne;
                if (validTime(fim)) { ne = toMillis(nd, fim); if (ne <= ns) { call.resolve(fail("dados_invalidos")); return; } }
                else ne = ns + (oldEnd - oldStart);
                v.put(CalendarContract.Events.DTSTART, ns);
                v.put(CalendarContract.Events.DTEND, ne);
                v.put(CalendarContract.Events.EVENT_TIMEZONE, TimeZone.getDefault().getID());
            }
            if (v.size() == 0) { call.resolve(fail("dados_invalidos")); return; }
            int rows = getContext().getContentResolver().update(ContentUris.withAppendedId(CalendarContract.Events.CONTENT_URI, id), v, null, null);
            call.resolve(rows > 0 ? ok() : fail("nao_encontrado"));
        } catch (SecurityException e) {
            call.resolve(fail("permissao_negada"));
        } catch (Exception e) {
            call.resolve(fail("erro"));
        }
    }

    /** A confirmação com o usuário acontece ANTES, na tela do app (JS). Aqui só executa e confere o resultado. */
    @com.getcapacitor.PluginMethod
    public void calendarDelete(PluginCall call) {
        if (needsCalendarPermission(call)) return;
        long id = parseId(call.getString("id_evento"));
        if (id < 0) { call.resolve(fail("dados_invalidos")); return; }
        try {
            JSObject cur = readEvent(id);
            if (cur == null) { call.resolve(fail("nao_encontrado")); return; }
            if (cur.getBoolean("recurring")) { call.resolve(fail("recorrente_nao_suportado")); return; }
            int rows = getContext().getContentResolver().delete(ContentUris.withAppendedId(CalendarContract.Events.CONTENT_URI, id), null, null);
            call.resolve(rows > 0 ? ok() : fail("nao_encontrado"));
        } catch (SecurityException e) {
            call.resolve(fail("permissao_negada"));
        } catch (Exception e) {
            call.resolve(fail("erro"));
        }
    }
}
