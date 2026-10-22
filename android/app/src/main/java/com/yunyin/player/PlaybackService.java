package com.yunyin.player;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.media.MediaMetadata;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;

import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Android media session + foreground notification.
 *
 * The actual MediaPlayer still lives in NativeAudioPlugin. This service owns the
 * MediaSession (lock screen / notification / system media controls) and forwards
 * play/pause/next/previous/seek events back to JS through a static listener.
 */
public class PlaybackService extends Service {
    static final String ACTION_UPDATE = "com.yunyin.player.media.UPDATE";
    static final String ACTION_STATE = "com.yunyin.player.media.STATE";
    static final String ACTION_PREV = "com.yunyin.player.media.PREV";
    static final String ACTION_NEXT = "com.yunyin.player.media.NEXT";
    static final String ACTION_TOGGLE = "com.yunyin.player.media.TOGGLE";
    static final String ACTION_STOP = "com.yunyin.player.media.STOP";

    private static final String EXTRA_TITLE = "title";
    private static final String EXTRA_ARTIST = "artist";
    private static final String EXTRA_COVER = "cover";
    private static final String EXTRA_DURATION = "duration";
    private static final String EXTRA_PLAYING = "playing";
    private static final String EXTRA_POSITION = "position";

    private static final String CHANNEL_ID = "yinxu_playback";
    private static final int NOTIFICATION_ID = 4101;
    private static final Handler MAIN = new Handler(Looper.getMainLooper());

    private static PlaybackService instance;
    private static ControlListener controlListener;

    public interface ControlListener {
        void onMediaControl(String action, long positionMs);
    }

    private MediaSession session;
    private NotificationManager notificationManager;
    private String title = "";
    private String artist = "";
    private String coverUrl = "";
    private long durationMs = 0;
    private long positionMs = 0;
    private boolean playing = false;
    private boolean foreground = false;
    private Bitmap artwork;
    private String loadedArtUrl = "";
    private final ExecutorService artExecutor = Executors.newSingleThreadExecutor();

    public static void setControlListener(ControlListener listener) {
        controlListener = listener;
    }

    public static void show(
        Context context,
        String title,
        String artist,
        String cover,
        long durationMs,
        boolean playing,
        long positionMs
    ) {
        PlaybackService running = instance;
        if (running != null) {
            final String t = title == null ? "" : title;
            final String a = artist == null ? "" : artist;
            final String c = cover == null ? "" : cover;
            MAIN.post(() -> running.applyShow(t, a, c, durationMs, playing, positionMs));
            return;
        }

        Intent intent = new Intent(context, PlaybackService.class);
        intent.setAction(ACTION_UPDATE);
        intent.putExtra(EXTRA_TITLE, title == null ? "" : title);
        intent.putExtra(EXTRA_ARTIST, artist == null ? "" : artist);
        intent.putExtra(EXTRA_COVER, cover == null ? "" : cover);
        intent.putExtra(EXTRA_DURATION, durationMs);
        intent.putExtra(EXTRA_PLAYING, playing);
        intent.putExtra(EXTRA_POSITION, positionMs);
        startForegroundService(context, intent);
    }

    public static void updateState(
        Context context,
        boolean playing,
        long positionMs,
        long durationMs
    ) {
        PlaybackService running = instance;
        if (running == null) return;
        MAIN.post(() -> running.applyState(playing, positionMs, durationMs));
    }

    public static void updatePosition(long positionMs) {
        PlaybackService running = instance;
        if (running == null) return;
        MAIN.post(() -> running.applyPosition(positionMs));
    }

    public static void stop(Context context) {
        if (context != null) {
            context.stopService(new Intent(context, PlaybackService.class));
        }
    }

    private static void startForegroundService(Context context, Intent intent) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent);
            } else {
                context.startService(intent);
            }
        } catch (Exception ignored) {
            // If the system blocks a background start, the player itself keeps working.
        }
    }

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        notificationManager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        createChannel();

        session = new MediaSession(this, "YinxuPlayback");
        session.setFlags(
            MediaSession.FLAG_HANDLES_MEDIA_BUTTONS |
            MediaSession.FLAG_HANDLES_TRANSPORT_CONTROLS
        );
        session.setSessionActivity(contentIntent());
        session.setCallback(new MediaSession.Callback() {
            @Override
            public void onPlay() {
                dispatch("play", positionMs);
            }

            @Override
            public void onPause() {
                dispatch("pause", positionMs);
            }

            @Override
            public void onSkipToNext() {
                dispatch("next", 0);
            }

            @Override
            public void onSkipToPrevious() {
                dispatch("prev", 0);
            }

            @Override
            public void onSeekTo(long pos) {
                dispatch("seek", pos);
            }

            @Override
            public void onStop() {
                dispatch("stop", 0);
            }
        });
        session.setActive(true);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null) {
            String action = intent.getAction();
            if (ACTION_PREV.equals(action)) {
                dispatch("prev", 0);
            } else if (ACTION_NEXT.equals(action)) {
                dispatch("next", 0);
            } else if (ACTION_TOGGLE.equals(action)) {
                dispatch(playing ? "pause" : "play", positionMs);
            } else if (ACTION_STOP.equals(action)) {
                dispatch("stop", 0);
            } else if (ACTION_UPDATE.equals(action)) {
                applyShow(
                    intent.getStringExtra(EXTRA_TITLE),
                    intent.getStringExtra(EXTRA_ARTIST),
                    intent.getStringExtra(EXTRA_COVER),
                    intent.getLongExtra(EXTRA_DURATION, 0),
                    intent.getBooleanExtra(EXTRA_PLAYING, true),
                    intent.getLongExtra(EXTRA_POSITION, 0)
                );
            } else if (ACTION_STATE.equals(action)) {
                applyState(
                    intent.getBooleanExtra(EXTRA_PLAYING, false),
                    intent.getLongExtra(EXTRA_POSITION, 0),
                    intent.getLongExtra(EXTRA_DURATION, 0)
                );
            }
        }

        ensureForeground();
        updateSession();
        return START_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void applyShow(
        String nextTitle,
        String nextArtist,
        String nextCover,
        long nextDuration,
        boolean nextPlaying,
        long nextPosition
    ) {
        title = nextTitle == null ? "" : nextTitle;
        artist = nextArtist == null ? "" : nextArtist;
        coverUrl = nextCover == null ? "" : nextCover;
        durationMs = Math.max(0, nextDuration);
        playing = nextPlaying;
        positionMs = Math.max(0, nextPosition);
        maybeLoadArtwork();
        ensureForeground();
        updateSession();
    }

    private void applyState(boolean nextPlaying, long nextPosition, long nextDuration) {
        playing = nextPlaying;
        positionMs = Math.max(0, nextPosition);
        if (nextDuration > 0) durationMs = nextDuration;
        ensureForeground();
        updateSession();
    }

    private void applyPosition(long nextPosition) {
        positionMs = Math.max(0, nextPosition);
        updatePlaybackStateOnly();
    }

    private void ensureForeground() {
        try {
            Notification notification = buildNotification();
            if (!foreground) {
                startForeground(NOTIFICATION_ID, notification);
                foreground = true;
            } else if (notificationManager != null) {
                notificationManager.notify(NOTIFICATION_ID, notification);
            }
        } catch (Exception ignored) {
            // Notification permission can be denied; playback still continues.
        }
    }

    private void updateSession() {
        if (session == null) return;
        session.setMetadata(buildMetadata());
        session.setPlaybackState(buildPlaybackState());
        if (foreground && notificationManager != null) {
            try {
                notificationManager.notify(NOTIFICATION_ID, buildNotification());
            } catch (Exception ignored) {
                // ignore
            }
        }
    }

    private void updatePlaybackStateOnly() {
        if (session == null) return;
        session.setPlaybackState(buildPlaybackState());
    }

    private MediaMetadata buildMetadata() {
        MediaMetadata.Builder builder = new MediaMetadata.Builder()
            .putString(MediaMetadata.METADATA_KEY_TITLE, title.isEmpty() ? "音序" : title)
            .putString(MediaMetadata.METADATA_KEY_ARTIST, artist)
            .putLong(MediaMetadata.METADATA_KEY_DURATION, durationMs);
        if (artwork != null) {
            builder.putBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART, artwork);
        }
        return builder.build();
    }

    private PlaybackState buildPlaybackState() {
        int state = playing ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED;
        return new PlaybackState.Builder()
            .setActions(
                PlaybackState.ACTION_PLAY |
                PlaybackState.ACTION_PAUSE |
                PlaybackState.ACTION_PLAY_PAUSE |
                PlaybackState.ACTION_SKIP_TO_NEXT |
                PlaybackState.ACTION_SKIP_TO_PREVIOUS |
                PlaybackState.ACTION_SEEK_TO |
                PlaybackState.ACTION_STOP
            )
            .setState(state, positionMs, playing ? 1f : 0f)
            .setBufferedPosition(positionMs)
            .build();
    }

    private Notification buildNotification() {
        Notification.Builder builder;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            builder = new Notification.Builder(this, CHANNEL_ID);
        } else {
            builder = new Notification.Builder(this);
        }

        Bitmap largeIcon = artwork;
        if (largeIcon == null) {
            largeIcon = BitmapFactory.decodeResource(getResources(), R.mipmap.ic_launcher);
        }

        builder
            .setContentTitle(title.isEmpty() ? "音序" : title)
            .setContentText(artist.isEmpty() ? "正在播放" : artist)
            .setSmallIcon(R.drawable.ic_stat_music)
            .setLargeIcon(largeIcon)
            .setContentIntent(contentIntent())
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .setCategory(Notification.CATEGORY_TRANSPORT)
            .setShowWhen(false)
            .setOnlyAlertOnce(true)
            .setOngoing(playing)
            .setColor(0xFFFA2D48)
            .addAction(
                new Notification.Action.Builder(
                    android.R.drawable.ic_media_previous,
                    "上一首",
                    serviceIntent(ACTION_PREV, 11)
                ).build()
            )
            .addAction(
                new Notification.Action.Builder(
                    playing ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play,
                    playing ? "暂停" : "播放",
                    serviceIntent(ACTION_TOGGLE, 12)
                ).build()
            )
            .addAction(
                new Notification.Action.Builder(
                    android.R.drawable.ic_media_next,
                    "下一首",
                    serviceIntent(ACTION_NEXT, 13)
                ).build()
            )
            .setStyle(
                new Notification.MediaStyle()
                    .setMediaSession(session.getSessionToken())
                    .setShowActionsInCompactView(0, 1, 2)
            );

        return builder.build();
    }

    private PendingIntent contentIntent() {
        Intent intent = new Intent(this, MainActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return PendingIntent.getActivity(this, 0, intent, pendingFlags());
    }

    private PendingIntent serviceIntent(String action, int requestCode) {
        Intent intent = new Intent(this, PlaybackService.class);
        intent.setAction(action);
        return PendingIntent.getService(this, requestCode, intent, pendingFlags());
    }

    private int pendingFlags() {
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            flags |= PendingIntent.FLAG_IMMUTABLE;
        }
        return flags;
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O || notificationManager == null) return;
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            "播放控制",
            NotificationManager.IMPORTANCE_LOW
        );
        channel.setDescription("音序播放控制");
        channel.setShowBadge(false);
        channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        notificationManager.createNotificationChannel(channel);
    }

    private void dispatch(String action, long position) {
        final ControlListener listener = controlListener;
        if (listener == null) return;
        MAIN.post(() -> listener.onMediaControl(action, position));
    }

    private void maybeLoadArtwork() {
        if (coverUrl.isEmpty()) {
            artwork = null;
            loadedArtUrl = "";
            return;
        }
        if (coverUrl.equals(loadedArtUrl)) return;
        loadedArtUrl = coverUrl;
        final String url = coverUrl;
        artExecutor.execute(() -> {
            Bitmap bitmap = null;
            HttpURLConnection connection = null;
            try {
                connection = (HttpURLConnection) new URL(url).openConnection();
                connection.setConnectTimeout(6000);
                connection.setReadTimeout(6000);
                connection.setInstanceFollowRedirects(true);
                try (InputStream input = connection.getInputStream()) {
                    bitmap = BitmapFactory.decodeStream(input);
                }
            } catch (Exception ignored) {
                // artwork is optional
            } finally {
                if (connection != null) connection.disconnect();
            }
            final Bitmap result = bitmap;
            MAIN.post(() -> {
                if (!url.equals(loadedArtUrl)) return;
                artwork = result;
                updateSession();
            });
        });
    }

    @Override
    public void onDestroy() {
        instance = null;
        if (session != null) {
            session.setActive(false);
            session.release();
            session = null;
        }
        if (foreground) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                stopForeground(STOP_FOREGROUND_REMOVE);
            } else {
                stopForeground(true);
            }
            foreground = false;
        }
        artExecutor.shutdownNow();
        super.onDestroy();
    }
}
