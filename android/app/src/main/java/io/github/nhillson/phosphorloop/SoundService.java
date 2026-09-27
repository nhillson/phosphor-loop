package io.github.nhillson.phosphorloop;

import android.annotation.SuppressLint;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.drawable.Icon;
import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioPlaybackCaptureConfiguration;
import android.media.AudioRecord;
import android.media.projection.MediaProjection;
import android.media.projection.MediaProjectionManager;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.util.Base64;

/**
 * Hears whatever the phone is playing (Spotify, YouTube, games) and hands it to the page in small
 * pieces, so the picture can move with the music. Android requires a notification while this runs,
 * and it only starts after the person taps Start in Android's own "record or cast" question.
 */
public class SoundService extends Service {
    static final String ACTION_STOP = "io.github.nhillson.phosphorloop.STOP_SOUND";
    private static final String CHANNEL = "listening";
    private static final int NOTE_ID = 7;

    /** Set when the page itself asked to stop, so no "stopped" message is sent back to it. */
    private static volatile boolean stopRequested;

    private final Handler main = new Handler(Looper.getMainLooper());
    private MediaProjection projection;
    private AudioRecord record;
    private Thread reader;
    private volatile boolean running;
    private int session;

    static void start(Context c, int resultCode, Intent consent, int rate, int session) {
        Intent i = new Intent(c, SoundService.class)
                .putExtra("code", resultCode)
                .putExtra("data", consent)
                .putExtra("rate", rate)
                .putExtra("session", session);
        c.startForegroundService(i);
    }

    static void stop(Context c) {
        stopRequested = true;
        try { c.stopService(new Intent(c, SoundService.class)); } catch (RuntimeException ignored) { }
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null || ACTION_STOP.equals(intent.getAction())) {
            stopSelf();
            return START_NOT_STICKY;
        }
        int newSession = intent.getIntExtra("session", 0);
        try {
            showNotification();
        } catch (RuntimeException e) {
            MainActivity.soundEvent("error", newSession, 0);
            stopSelf();
            return START_NOT_STICKY;
        }
        endCapture(false);
        session = newSession;
        stopRequested = false;
        try {
            begin(intent);
        } catch (Exception e) {
            endCapture(false);
            MainActivity.soundEvent("error", session, 0);
            stopSelf();
        }
        return START_NOT_STICKY;
    }

    @SuppressLint("MissingPermission")   // the activity asks for the microphone permission before starting this
    private void begin(Intent intent) {
        int code = intent.getIntExtra("code", 0);
        Intent consent = Build.VERSION.SDK_INT >= 33
                ? intent.getParcelableExtra("data", Intent.class)
                : legacyIntentExtra(intent);
        if (consent == null) throw new IllegalStateException("no consent");
        MediaProjectionManager mpm = getSystemService(MediaProjectionManager.class);
        projection = mpm.getMediaProjection(code, consent);
        if (projection == null) throw new IllegalStateException("no projection");
        projection.registerCallback(new MediaProjection.Callback() {
            @Override
            public void onStop() {
                // Stopped from Android's own sharing chip or because the screen locked
                if (running || record != null) {
                    endCapture(true);
                    stopSelf();
                }
            }
        }, main);

        int rate = intent.getIntExtra("rate", 48000);
        if (rate < 8000 || rate > 96000) rate = 48000;
        AudioPlaybackCaptureConfiguration config = new AudioPlaybackCaptureConfiguration.Builder(projection)
                .addMatchingUsage(AudioAttributes.USAGE_MEDIA)
                .addMatchingUsage(AudioAttributes.USAGE_GAME)
                .addMatchingUsage(AudioAttributes.USAGE_UNKNOWN)
                .build();
        AudioFormat format = new AudioFormat.Builder()
                .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                .setSampleRate(rate)
                .setChannelMask(AudioFormat.CHANNEL_IN_MONO)
                .build();
        int min = AudioRecord.getMinBufferSize(rate, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
        record = new AudioRecord.Builder()
                .setAudioFormat(format)
                .setBufferSizeInBytes(Math.max(min * 2, rate / 5 * 2))
                .setAudioPlaybackCaptureConfig(config)
                .build();
        if (record.getState() != AudioRecord.STATE_INITIALIZED) throw new IllegalStateException("recorder");
        record.startRecording();
        running = true;
        final AudioRecord r = record;
        final int actualRate = r.getSampleRate();
        final int frame = Math.max(256, actualRate / 50);   // 20 ms at a time
        final int mySession = session;
        reader = new Thread(() -> readLoop(r, frame, mySession), "phosphor-sound");
        reader.start();
        MainActivity.soundEvent("started", session, actualRate);
    }

    @SuppressWarnings("deprecation")
    private static Intent legacyIntentExtra(Intent intent) {
        return intent.getParcelableExtra("data");
    }

    private void readLoop(AudioRecord r, int frame, int mySession) {
        short[] buf = new short[frame];
        byte[] bytes = new byte[frame * 2];
        while (running) {
            int n;
            try {
                n = r.read(buf, 0, frame);
            } catch (RuntimeException e) {
                n = -1;
            }
            if (!running) break;
            if (n < 0) {
                main.post(() -> {
                    if (running && record == r) {
                        endCapture(true);
                        stopSelf();
                    }
                });
                break;
            }
            if (n == 0) continue;
            for (int i = 0; i < n; i++) {
                bytes[2 * i] = (byte) (buf[i] & 0xff);
                bytes[2 * i + 1] = (byte) ((buf[i] >> 8) & 0xff);
            }
            MainActivity.soundData(Base64.encodeToString(bytes, 0, n * 2, Base64.NO_WRAP), mySession);
        }
    }

    private void endCapture(boolean report) {
        boolean was = running || record != null || projection != null;
        running = false;
        AudioRecord r = record;
        record = null;
        if (r != null) {
            try { r.stop(); } catch (RuntimeException ignored) { }
        }
        Thread t = reader;
        reader = null;
        if (t != null && t != Thread.currentThread()) {
            try { t.join(400); } catch (InterruptedException ignored) { }
        }
        if (r != null) {
            try { r.release(); } catch (RuntimeException ignored) { }
        }
        MediaProjection p = projection;
        projection = null;
        if (p != null) {
            try { p.stop(); } catch (RuntimeException ignored) { }
        }
        if (report && was && !stopRequested) MainActivity.soundEvent("stopped", session, 0);
    }

    private void showNotification() {
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm != null && nm.getNotificationChannel(CHANNEL) == null) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "Listening to the phone’s sound", NotificationManager.IMPORTANCE_LOW);
            ch.setShowBadge(false);
            nm.createNotificationChannel(ch);
        }
        PendingIntent open = PendingIntent.getActivity(this, 0,
                new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        PendingIntent stop = PendingIntent.getService(this, 1,
                new Intent(this, SoundService.class).setAction(ACTION_STOP),
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification n = new Notification.Builder(this, CHANNEL)
                .setSmallIcon(R.drawable.ic_notify)
                .setContentTitle("Phosphor Loop is listening")
                .setContentText("The picture moves with the music playing on this phone.")
                .setContentIntent(open)
                .setOngoing(true)
                .addAction(new Notification.Action.Builder(
                        Icon.createWithResource(this, R.drawable.ic_notify), "Stop listening", stop).build())
                .build();
        startForeground(NOTE_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION);
    }

    @Override
    public void onDestroy() {
        endCapture(true);
        try { stopForeground(STOP_FOREGROUND_REMOVE); } catch (RuntimeException ignored) { }
        super.onDestroy();
    }
}
