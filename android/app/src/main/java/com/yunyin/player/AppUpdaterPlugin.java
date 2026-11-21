package com.yunyin.player;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Downloads the latest APK from GitHub and opens the Android package installer.
 * Installation still requires the user to allow "install unknown apps" for 音序.
 */
@CapacitorPlugin(name = "AppUpdater")
public class AppUpdaterPlugin extends Plugin {

    @PluginMethod
    public void downloadAndInstall(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.trim().isEmpty()) {
            call.reject("缺少更新下载地址");
            return;
        }

        Context context = getContext();
        if (
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
            !context.getPackageManager().canRequestPackageInstalls()
        ) {
            try {
                Intent settings = new Intent(
                    Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:" + context.getPackageName())
                );
                settings.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                context.startActivity(settings);
            } catch (Exception ignored) {
                // Fall through to the error below.
            }
            call.reject("请先允许音序安装未知应用，然后再点一次更新");
            return;
        }

        JSObject started = new JSObject();
        started.put("started", true);
        call.resolve(started);

        new Thread(() -> download(context, url)).start();
    }

    private void download(Context context, String url) {
        File dir = new File(context.getCacheDir(), "updates");
        if (!dir.exists() && !dir.mkdirs()) {
            emitError("无法创建更新目录");
            return;
        }
        File apk = new File(dir, "yinxu-update.apk");
        if (apk.exists() && !apk.delete()) {
            emitError("无法清理旧更新包");
            return;
        }

        HttpURLConnection connection = null;
        try {
            URL target = new URL(url);
            connection = (HttpURLConnection) target.openConnection();
            connection.setInstanceFollowRedirects(true);
            connection.setConnectTimeout(20000);
            connection.setReadTimeout(60000);
            connection.setRequestProperty("User-Agent", "Yinxu-Android-Updater");
            connection.connect();

            int status = connection.getResponseCode();
            if (status < 200 || status >= 300) {
                emitError("下载更新失败（HTTP " + status + "）");
                return;
            }

            int total = connection.getContentLength();
            long downloaded = 0;
            int lastPercent = -1;
            try (
                InputStream input = connection.getInputStream();
                FileOutputStream output = new FileOutputStream(apk)
            ) {
                byte[] buffer = new byte[64 * 1024];
                int read;
                while ((read = input.read(buffer)) != -1) {
                    output.write(buffer, 0, read);
                    downloaded += read;
                    if (total > 0) {
                        int percent = (int) Math.min(100, downloaded * 100 / total);
                        if (percent != lastPercent) {
                            lastPercent = percent;
                            emitProgress(percent);
                        }
                    }
                }
                output.flush();
            }

            if (!apk.exists() || apk.length() <= 0) {
                emitError("下载的更新包为空");
                return;
            }
            install(context, apk);
        } catch (Exception error) {
            emitError(error.getMessage() == null ? "下载更新失败" : error.getMessage());
            if (apk.exists() && apk.length() == 0) {
                //noinspection ResultOfMethodCallIgnored
                apk.delete();
            }
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private void install(Context context, File apk) {
        Uri uri = FileProvider.getUriForFile(
            context,
            context.getPackageName() + ".fileprovider",
            apk
        );
        Intent intent = new Intent(Intent.ACTION_VIEW);
        intent.setDataAndType(uri, "application/vnd.android.package-archive");
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        context.startActivity(intent);

        JSObject event = new JSObject();
        event.put("message", "安装器已打开");
        notifyOnUiThread("installStarted", event);
    }

    private void emitProgress(int percent) {
        JSObject data = new JSObject();
        data.put("percent", percent);
        notifyOnUiThread("downloadProgress", data);
    }

    private void emitError(String message) {
        JSObject data = new JSObject();
        data.put("message", message == null ? "下载更新失败" : message);
        notifyOnUiThread("downloadError", data);
    }

    private void notifyOnUiThread(String event, JSObject data) {
        if (getActivity() == null) return;
        getActivity().runOnUiThread(() -> notifyListeners(event, data));
    }
}
