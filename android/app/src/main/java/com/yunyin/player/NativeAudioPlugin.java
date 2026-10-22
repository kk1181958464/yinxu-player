package com.yunyin.player;

import android.media.AudioAttributes;
import android.media.MediaPlayer;
import android.os.Handler;
import android.os.Looper;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Native URL streaming player (MediaPlayer).
 * Plays cleartext http:// KuGou CDN URLs that WebView mixed-content may block.
 */
@CapacitorPlugin(name = "NativeAudio")
public class NativeAudioPlugin extends Plugin {

    private MediaPlayer player;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private boolean tickRunning = false;
    private int playGeneration = 0;
    private PluginCall pendingPlayCall;
    private long lastMediaTick = 0;

    private final Runnable tick = new Runnable() {
        @Override
        public void run() {
            if (!tickRunning) return;
            emitStatus("timeupdate");
            long now = System.currentTimeMillis();
            if (now - lastMediaTick > 1000) {
                lastMediaTick = now;
                PlaybackService.updatePosition((long) (safePosition() * 1000));
            }
            handler.postDelayed(this, 250);
        }
    };

    private void ensurePlayer() {
        if (player != null) return;
        player = new MediaPlayer();
        player.setAudioAttributes(
            new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_MEDIA)
                .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                .build()
        );
        player.setOnCompletionListener(mp -> {
            stopTick();
            PlaybackService.updateState(getContext(), false, 0, (long) (safeDuration() * 1000));
            JSObject data = new JSObject();
            data.put("currentTime", 0);
            data.put("duration", safeDuration());
            data.put("playing", false);
            notifyListeners("ended", data);
        });
        player.setOnErrorListener((mp, what, extra) -> {
            stopTick();
            PlaybackService.stop(getContext());
            String msg = "MediaPlayer error what=" + what + " extra=" + extra;
            if (pendingPlayCall != null) {
                pendingPlayCall.reject(msg);
                pendingPlayCall = null;
            }
            JSObject data = new JSObject();
            data.put("message", msg);
            notifyListeners("error", data);
            return true;
        });
    }

    private double safeDuration() {
        try {
            if (player == null) return 0;
            int d = player.getDuration();
            return d > 0 ? d / 1000.0 : 0;
        } catch (Exception e) {
            return 0;
        }
    }

    private double safePosition() {
        try {
            if (player == null) return 0;
            int p = player.getCurrentPosition();
            return p >= 0 ? p / 1000.0 : 0;
        } catch (Exception e) {
            return 0;
        }
    }

    private boolean isPlayingSafe() {
        try {
            return player != null && player.isPlaying();
        } catch (Exception e) {
            return false;
        }
    }

    private void emitStatus(String event) {
        JSObject data = new JSObject();
        data.put("currentTime", safePosition());
        data.put("duration", safeDuration());
        data.put("playing", isPlayingSafe());
        notifyListeners(event, data);
    }

    private void startTick() {
        if (tickRunning) return;
        tickRunning = true;
        handler.post(tick);
    }

    private void stopTick() {
        tickRunning = false;
        handler.removeCallbacks(tick);
    }

    private void resetPlayer() {
        stopTick();
        pendingPlayCall = null;
        if (player != null) {
            try {
                player.reset();
            } catch (Exception ignored) {}
            try {
                player.release();
            } catch (Exception ignored) {}
            player = null;
        }
    }

    @Override
    public void load() {
        PlaybackService.setControlListener((action, positionMs) -> {
            JSObject data = new JSObject();
            data.put("action", action);
            data.put("position", positionMs / 1000.0);
            notifyListeners("mediaControl", data);
        });
    }

    @PluginMethod
    public void play(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.isEmpty()) {
            call.reject("url is required");
            return;
        }
        final String mediaTitle = call.getString("title", "");
        final String mediaArtist = call.getString("artist", "");
        final String mediaCover = call.getString("cover", "");
        Double durationObj = call.getDouble("duration", 0.0);
        final long mediaDurationMs = durationObj == null
            ? 0
            : Math.max(0, (long) (durationObj * 1000));
        Double volObj = call.getDouble("volume");
        boolean muted = Boolean.TRUE.equals(call.getBoolean("muted", false));
        float volume = muted ? 0f : (volObj != null ? volObj.floatValue() : 1f);
        if (volume < 0f) volume = 0f;
        if (volume > 1f) volume = 1f;
        final float finalVolume = volume;
        final int gen = ++playGeneration;

        getActivity().runOnUiThread(() -> {
            try {
                resetPlayer();
                ensurePlayer();
                pendingPlayCall = call;
                player.setDataSource(url);
                player.setOnPreparedListener(mp -> {
                    if (gen != playGeneration) {
                        if (pendingPlayCall == call) pendingPlayCall = null;
                        return;
                    }
                    try {
                        mp.setVolume(finalVolume, finalVolume);
                        mp.start();
                        startTick();
                        PlaybackService.show(
                            getContext(),
                            mediaTitle,
                            mediaArtist,
                            mediaCover,
                            mediaDurationMs,
                            true,
                            0
                        );
                        emitStatus("playing");
                        if (pendingPlayCall == call) {
                            pendingPlayCall = null;
                            call.resolve();
                        }
                    } catch (Exception e) {
                        if (pendingPlayCall == call) {
                            pendingPlayCall = null;
                            call.reject("start failed: " + e.getMessage());
                        }
                    }
                });
                player.prepareAsync();
            } catch (Exception e) {
                pendingPlayCall = null;
                PlaybackService.stop(getContext());
                call.reject("play failed: " + e.getMessage());
            }
        });
    }

    @PluginMethod
    public void pause(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            try {
                if (player != null && player.isPlaying()) {
                    player.pause();
                }
                stopTick();
                PlaybackService.updateState(
                    getContext(),
                    false,
                    (long) (safePosition() * 1000),
                    (long) (safeDuration() * 1000)
                );
                emitStatus("timeupdate");
                call.resolve();
            } catch (Exception e) {
                call.reject(e.getMessage());
            }
        });
    }

    @PluginMethod
    public void resume(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            try {
                if (player != null) {
                    player.start();
                    startTick();
                    PlaybackService.updateState(
                        getContext(),
                        true,
                        (long) (safePosition() * 1000),
                        (long) (safeDuration() * 1000)
                    );
                    emitStatus("playing");
                }
                call.resolve();
            } catch (Exception e) {
                call.reject(e.getMessage());
            }
        });
    }

    @PluginMethod
    public void stop(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            playGeneration++;
            resetPlayer();
            PlaybackService.stop(getContext());
            JSObject data = new JSObject();
            data.put("currentTime", 0);
            data.put("duration", 0);
            data.put("playing", false);
            notifyListeners("timeupdate", data);
            call.resolve();
        });
    }

    @PluginMethod
    public void seek(PluginCall call) {
        Double time = call.getDouble("time");
        if (time == null) {
            call.reject("time is required");
            return;
        }
        getActivity().runOnUiThread(() -> {
            try {
                if (player != null) {
                    int ms = (int) Math.max(0, time * 1000);
                    player.seekTo(ms);
                    PlaybackService.updateState(
                        getContext(),
                        isPlayingSafe(),
                        ms,
                        (long) (safeDuration() * 1000)
                    );
                    emitStatus("timeupdate");
                }
                call.resolve();
            } catch (Exception e) {
                call.reject(e.getMessage());
            }
        });
    }

    @PluginMethod
    public void setVolume(PluginCall call) {
        Double volume = call.getDouble("volume");
        boolean muted = Boolean.TRUE.equals(call.getBoolean("muted", false));
        float v = muted ? 0f : (volume != null ? volume.floatValue() : 1f);
        if (v < 0f) v = 0f;
        if (v > 1f) v = 1f;
        final float fv = v;
        getActivity().runOnUiThread(() -> {
            try {
                if (player != null) {
                    player.setVolume(fv, fv);
                }
                call.resolve();
            } catch (Exception e) {
                call.reject(e.getMessage());
            }
        });
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        JSObject data = new JSObject();
        data.put("currentTime", safePosition());
        data.put("duration", safeDuration());
        data.put("playing", isPlayingSafe());
        call.resolve(data);
    }

    @Override
    protected void handleOnDestroy() {
        PlaybackService.setControlListener(null);
        PlaybackService.stop(getContext());
        resetPlayer();
        super.handleOnDestroy();
    }
}