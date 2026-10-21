package com.yunyin.player;

import android.os.Bundle;
import android.webkit.WebSettings;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Must register before super.onCreate so Capacitor picks it up
        registerPlugin(NativeAudioPlugin.class);
        super.onCreate(savedInstanceState);
        if (this.bridge != null) {
            WebView webView = this.bridge.getWebView();
            if (webView != null) {
                WebSettings settings = webView.getSettings();
                // Belt-and-suspenders: Capacitor already sets this when allowMixedContent=true
                settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
                settings.setMediaPlaybackRequiresUserGesture(false);
                settings.setDomStorageEnabled(true);
                settings.setAllowFileAccess(true);
                settings.setAllowContentAccess(true);
                webView.setKeepScreenOn(true);
            }
        }
    }
}