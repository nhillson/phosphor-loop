package io.github.nhillson.phosphorloop;

import android.app.Presentation;
import android.graphics.Color;
import android.hardware.display.DisplayManager;
import android.os.Handler;
import android.os.Looper;
import android.os.Message;
import android.view.Display;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/**
 * The projector or TV. When the page opens its output window, that window is shown full screen on the
 * plugged-in (or cast-to) display, while the controls stay on the phone.
 */
final class OutputScreen implements DisplayManager.DisplayListener {
    private final MainActivity activity;
    private final DisplayManager displays;
    private Presentation presentation;
    private WebView popup;
    private boolean lastConnected;

    OutputScreen(MainActivity activity) {
        this.activity = activity;
        this.displays = activity.getSystemService(DisplayManager.class);
        this.lastConnected = connected();
        displays.registerDisplayListener(this, new Handler(Looper.getMainLooper()));
    }

    private Display target() {
        try {
            Display[] list = displays.getDisplays(DisplayManager.DISPLAY_CATEGORY_PRESENTATION);
            for (Display d : list) {
                if (d.getDisplayId() != Display.DEFAULT_DISPLAY && d.isValid()) return d;
            }
        } catch (RuntimeException ignored) {
        }
        return null;
    }

    boolean connected() {
        return target() != null;
    }

    /** Called from the page's window.open(). Returns false when there is no other screen to use. */
    boolean open(Message resultMsg) {
        Display d = target();
        if (d == null) return false;
        close();
        Presentation p = null;
        WebView w = null;
        try {
            p = new Presentation(activity, d);
            w = new WebView(p.getContext());
            w.setBackgroundColor(Color.BLACK);
            WebSettings s = w.getSettings();
            s.setJavaScriptEnabled(true);
            s.setDomStorageEnabled(true);
            s.setMediaPlaybackRequiresUserGesture(false);
            s.setSupportZoom(false);
            w.setWebViewClient(new WebViewClient() {
                @Override
                public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                    return true;   // this window only ever shows the picture
                }
            });
            final WebView mine = w;
            w.setWebChromeClient(new WebChromeClient() {
                @Override
                public void onCloseWindow(WebView window) {
                    if (popup == mine) close();
                }
            });
            p.setContentView(w, new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
            if (p.getWindow() != null) p.getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            final Presentation shown = p;
            p.setOnDismissListener(dialog -> {
                if (presentation == shown) {
                    presentation = null;
                    destroyPopup();
                }
            });
            p.show();
            WebView.WebViewTransport transport = (WebView.WebViewTransport) resultMsg.obj;
            transport.setWebView(w);
            resultMsg.sendToTarget();
            presentation = p;
            popup = w;
            return true;
        } catch (RuntimeException e) {   // includes WindowManager.InvalidDisplayException
            if (w != null) w.destroy();
            if (p != null) {
                try { p.dismiss(); } catch (RuntimeException ignored) { }
            }
            return false;
        }
    }

    void close() {
        Presentation p = presentation;
        presentation = null;
        if (p != null) {
            try { p.dismiss(); } catch (RuntimeException ignored) { }
        }
        destroyPopup();
    }

    private void destroyPopup() {
        final WebView w = popup;
        popup = null;
        if (w == null) return;
        // Done a moment later, so the WebView is never torn down inside one of its own callbacks
        new Handler(Looper.getMainLooper()).post(() -> {
            try {
                if (w.getParent() instanceof ViewGroup) ((ViewGroup) w.getParent()).removeView(w);
                w.destroy();
            } catch (RuntimeException ignored) {
            }
        });
    }

    void release() {
        try { displays.unregisterDisplayListener(this); } catch (RuntimeException ignored) { }
        close();
    }

    private void changed() {
        if (presentation != null) {
            Display d = presentation.getDisplay();
            if (d == null || !d.isValid()) close();
        }
        boolean now = connected();
        if (now != lastConnected) {
            lastConnected = now;
            if (!now) close();
            activity.sendEvent("{\"type\":\"display\",\"connected\":" + now + "}");
        }
    }

    @Override public void onDisplayAdded(int displayId) { changed(); }
    @Override public void onDisplayRemoved(int displayId) { changed(); }
    @Override public void onDisplayChanged(int displayId) { changed(); }
}
