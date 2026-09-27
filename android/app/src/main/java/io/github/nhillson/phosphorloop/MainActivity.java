package io.github.nhillson.phosphorloop;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.Insets;
import android.media.projection.MediaProjectionConfig;
import android.media.projection.MediaProjectionManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.os.Message;
import android.os.SystemClock;
import android.provider.MediaStore;
import android.provider.Settings;
import android.util.Base64;
import android.view.DisplayCutout;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.ServiceWorkerClient;
import android.webkit.ServiceWorkerController;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebMessage;
import android.webkit.WebMessagePort;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;

/**
 * Phosphor Loop for Android: the web app, full screen, with the phone's camera and microphone,
 * a plugged-in projector or TV as the output, the phone's own sound, and saving to the gallery.
 */
public class MainActivity extends Activity {
    static final String SITE = "https://" + OfflineLoader.SITE_HOST + OfflineLoader.SITE_PATH;
    static final String ORIGIN = "https://" + OfflineLoader.SITE_HOST;

    private static final int REQ_MEDIA = 1;
    private static final int REQ_SOUND_PERMISSION = 2;
    private static final int REQ_FILE = 10;
    private static final int REQ_PROJECTION = 11;

    /** The running activity, so the sound service can reach the page. */
    private static volatile MainActivity current;

    private final Handler main = new Handler(Looper.getMainLooper());
    private FrameLayout root;
    private WebView web;
    private OfflineLoader loader;
    private OutputScreen output;
    private String version = "";

    private View customView;
    private WebChromeClient.CustomViewCallback customCallback;
    private PermissionRequest pendingMedia;
    private List<String> pendingMediaResources;
    private ValueCallback<Uri[]> fileCallback;
    private int soundRate = 48000;
    private int soundSession;
    private WebMessagePort soundPort;
    private int soundPortSession = -1;
    private long lastBack;
    private boolean resumedOnce;

    // ---------------------------------------------------------------- start up

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        current = this;
        try {
            version = getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
        } catch (Exception ignored) {
        }
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        if (Build.VERSION.SDK_INT >= 30) getWindow().setDecorFitsSystemWindows(false);

        root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);
        setContentView(root);
        root.setOnApplyWindowInsetsListener((v, insets) -> {
            padForCutoutAndKeyboard(v, insets);
            return insets;
        });

        WebView.setWebContentsDebuggingEnabled((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0);
        loader = new OfflineLoader(this);
        output = new OutputScreen(this);
        try {
            ServiceWorkerController.getInstance().setServiceWorkerClient(new ServiceWorkerClient() {
                @Override
                public WebResourceResponse shouldInterceptRequest(WebResourceRequest request) {
                    return loader.intercept(request);
                }
            });
        } catch (RuntimeException ignored) {
        }
        buildWebView();
        web.loadUrl(SITE);
        hideSystemBars();
    }

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    private void buildWebView() {
        web = new WebView(this);
        web.setBackgroundColor(Color.rgb(0x19, 0x18, 0x16));
        root.addView(web, 0, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setSupportMultipleWindows(true);
        s.setJavaScriptCanOpenWindowsAutomatically(true);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(false);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setTextZoom(100);
        s.setAllowFileAccess(false);
        s.setUserAgentString(s.getUserAgentString() + " PhosphorLoopApp/" + version);
        loader.setUserAgent(s.getUserAgentString());
        web.addJavascriptInterface(new Bridge(), "PhosphorApp");
        web.setWebViewClient(new PageClient());
        web.setWebChromeClient(new PageChrome());
    }

    // ---------------------------------------------------------------- full screen

    private void hideSystemBars() {
        if (Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController c = getWindow().getInsetsController();
            if (c != null) {
                c.hide(WindowInsets.Type.systemBars());
                c.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            }
        } else {
            //noinspection deprecation
            getWindow().getDecorView().setSystemUiVisibility(
                    View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                            | View.SYSTEM_UI_FLAG_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                            | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN);
        }
    }

    /** Keeps the controls clear of the camera notch, and above the keyboard when naming a preset. */
    private void padForCutoutAndKeyboard(View v, WindowInsets insets) {
        int l = 0, t = 0, r = 0, b = 0;
        if (Build.VERSION.SDK_INT >= 30) {
            Insets cut = insets.getInsets(WindowInsets.Type.displayCutout());
            Insets ime = insets.getInsets(WindowInsets.Type.ime());
            l = cut.left; t = cut.top; r = cut.right; b = Math.max(cut.bottom, ime.bottom);
        } else {
            DisplayCutout cut = insets.getDisplayCutout();
            if (cut != null) {
                l = cut.getSafeInsetLeft(); t = cut.getSafeInsetTop(); r = cut.getSafeInsetRight(); b = cut.getSafeInsetBottom();
            }
        }
        if (customView != null) { l = 0; t = 0; r = 0; b = 0; }   // the full-screen picture goes edge to edge
        v.setPadding(l, t, r, b);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideSystemBars();
    }

    // ---------------------------------------------------------------- lifecycle

    @Override
    protected void onResume() {
        super.onResume();
        current = this;
        hideSystemBars();
        if (resumedOnce) sendEvent("{\"type\":\"resume\"}");
        resumedOnce = true;
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        if (customView != null) {
            exitFullScreen();
            return;
        }
        long now = SystemClock.uptimeMillis();
        if (now - lastBack < 2500) {
            super.onBackPressed();
            return;
        }
        lastBack = now;
        Toast.makeText(this, "Press back again to close Phosphor Loop", Toast.LENGTH_SHORT).show();
    }

    @Override
    protected void onDestroy() {
        SoundService.stop(this);
        closeSoundPort();
        if (output != null) output.release();
        if (web != null) {
            root.removeView(web);
            web.destroy();
            web = null;
        }
        if (current == this) current = null;
        super.onDestroy();
    }

    // ---------------------------------------------------------------- talking to the page

    void sendEvent(String json) {
        main.post(() -> {
            if (web != null) web.evaluateJavascript("window.dispatchEvent(new CustomEvent('phosphorapp',{detail:" + json + "}));", null);
        });
    }

    static void soundEvent(String state, int session, int rate) {
        MainActivity a = current;
        if (a == null) return;
        a.main.post(() -> {
            if (a.web == null) return;
            if ("started".equals(state)) a.openSoundPort(session);
            else a.closeSoundPort();
            a.sendEvent("{\"type\":\"sound\",\"state\":\"" + state + "\",\"session\":" + session + ",\"rate\":" + rate + "}");
        });
    }

    static void soundData(String base64, int session) {
        MainActivity a = current;
        if (a == null) return;
        a.main.post(() -> {
            if (a.soundPort == null || a.soundPortSession != session) return;
            try {
                a.soundPort.postMessage(new WebMessage(base64));
            } catch (RuntimeException ignored) {
            }
        });
    }

    private void openSoundPort(int session) {
        closeSoundPort();
        try {
            WebMessagePort[] pair = web.createWebMessageChannel();
            soundPort = pair[0];
            soundPortSession = session;
            web.postWebMessage(new WebMessage("phosphor-sound-port", new WebMessagePort[] { pair[1] }), Uri.parse(ORIGIN));
        } catch (RuntimeException e) {
            soundPort = null;
            soundPortSession = -1;
        }
    }

    private void closeSoundPort() {
        if (soundPort != null) {
            try { soundPort.close(); } catch (RuntimeException ignored) { }
        }
        soundPort = null;
        soundPortSession = -1;
    }

    /** What the page can ask the app for. These run on a background thread. */
    final class Bridge {
        private final Object saveLock = new Object();
        private Uri saveUri;
        private OutputStream saveOut;
        private String saveWhere = "";

        @JavascriptInterface
        public String info() {
            try {
                JSONObject o = new JSONObject();
                o.put("version", version);
                o.put("android", Build.VERSION.SDK_INT);
                o.put("display", output != null && output.connected());
                o.put("sound", Build.VERSION.SDK_INT >= 29);
                return o.toString();
            } catch (Exception e) {
                return "{}";
            }
        }

        @JavascriptInterface
        public void startSound(int rate, int session) {
            main.post(() -> beginSound(rate, session));
        }

        @JavascriptInterface
        public void stopSound() {
            main.post(() -> {
                SoundService.stop(MainActivity.this);
                closeSoundPort();
            });
        }

        @JavascriptInterface
        public boolean saveBegin(String name, String mime) {
            synchronized (saveLock) {
                dropSave();
                try {
                    ContentResolver cr = getContentResolver();
                    String clean = (name == null || name.isEmpty() ? "phosphor-loop" : name).replaceAll("[^A-Za-z0-9._-]", "-");
                    String type = mime == null || mime.isEmpty() ? "application/octet-stream" : mime;
                    boolean image = type.startsWith("image/");
                    boolean video = type.startsWith("video/");
                    Uri uri = null;
                    if (image || video) {
                        ContentValues v = new ContentValues();
                        v.put(MediaStore.MediaColumns.DISPLAY_NAME, clean);
                        v.put(MediaStore.MediaColumns.MIME_TYPE, type);
                        v.put(MediaStore.MediaColumns.RELATIVE_PATH,
                                (image ? Environment.DIRECTORY_PICTURES : Environment.DIRECTORY_MOVIES) + "/Phosphor Loop");
                        v.put(MediaStore.MediaColumns.IS_PENDING, 1);
                        Uri collection = image
                                ? MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
                                : MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY);
                        try {
                            uri = cr.insert(collection, v);
                        } catch (RuntimeException e) {
                            uri = null;
                        }
                        saveWhere = "your Gallery (Phosphor Loop album)";
                    }
                    if (uri == null) {
                        ContentValues v = new ContentValues();
                        v.put(MediaStore.MediaColumns.DISPLAY_NAME, clean);
                        v.put(MediaStore.MediaColumns.MIME_TYPE, type);
                        v.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/Phosphor Loop");
                        v.put(MediaStore.MediaColumns.IS_PENDING, 1);
                        uri = cr.insert(MediaStore.Downloads.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY), v);
                        saveWhere = "Downloads › Phosphor Loop";
                    }
                    if (uri == null) return false;
                    saveUri = uri;
                    saveOut = cr.openOutputStream(uri, "w");
                    return saveOut != null;
                } catch (Exception e) {
                    dropSave();
                    return false;
                }
            }
        }

        @JavascriptInterface
        public boolean saveChunk(String base64) {
            synchronized (saveLock) {
                if (saveOut == null) return false;
                try {
                    saveOut.write(Base64.decode(base64, Base64.DEFAULT));
                    return true;
                } catch (Exception e) {
                    return false;
                }
            }
        }

        @JavascriptInterface
        public String saveEnd(boolean ok) {
            synchronized (saveLock) {
                if (saveUri == null) return "";
                Uri uri = saveUri;
                String where = saveWhere;
                try {
                    if (saveOut != null) saveOut.close();
                } catch (Exception e) {
                    ok = false;
                }
                saveOut = null;
                saveUri = null;
                ContentResolver cr = getContentResolver();
                if (!ok) {
                    try { cr.delete(uri, null, null); } catch (RuntimeException ignored) { }
                    return "";
                }
                try {
                    ContentValues v = new ContentValues();
                    v.put(MediaStore.MediaColumns.IS_PENDING, 0);
                    cr.update(uri, v, null, null);
                    return where;
                } catch (RuntimeException e) {
                    return "";
                }
            }
        }

        private void dropSave() {
            if (saveOut != null) {
                try { saveOut.close(); } catch (Exception ignored) { }
            }
            if (saveUri != null) {
                try { getContentResolver().delete(saveUri, null, null); } catch (RuntimeException ignored) { }
            }
            saveOut = null;
            saveUri = null;
        }
    }

    // ---------------------------------------------------------------- the phone's own sound

    private void beginSound(int rate, int session) {
        soundRate = rate;
        soundSession = session;
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[] { Manifest.permission.RECORD_AUDIO }, REQ_SOUND_PERMISSION);
            return;
        }
        askToShareSound();
    }

    private void askToShareSound() {
        try {
            MediaProjectionManager mpm = getSystemService(MediaProjectionManager.class);
            Intent ask = Build.VERSION.SDK_INT >= 34
                    ? mpm.createScreenCaptureIntent(MediaProjectionConfig.createConfigForDefaultDisplay())
                    : mpm.createScreenCaptureIntent();
            startActivityForResult(ask, REQ_PROJECTION);
        } catch (Exception e) {
            soundEvent("error", soundSession, 0);
        }
    }

    // ---------------------------------------------------------------- permissions and results

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        if (requestCode == REQ_SOUND_PERMISSION) {
            if (granted(Manifest.permission.RECORD_AUDIO)) askToShareSound();
            else {
                soundEvent("mic-denied", soundSession, 0);
                explainIfBlocked(Manifest.permission.RECORD_AUDIO, "Microphone");
            }
            return;
        }
        if (requestCode == REQ_MEDIA) {
            PermissionRequest req = pendingMedia;
            List<String> wanted = pendingMediaResources;
            pendingMedia = null;
            pendingMediaResources = null;
            if (req == null || wanted == null) return;
            List<String> ok = new ArrayList<>();
            for (String r : wanted) {
                String perm = androidPermissionFor(r);
                if (perm != null && granted(perm)) ok.add(r);
                else if (perm != null) explainIfBlocked(perm, Manifest.permission.CAMERA.equals(perm) ? "Camera" : "Microphone");
            }
            if (ok.isEmpty()) req.deny();
            else req.grant(ok.toArray(new String[0]));
        }
    }

    private boolean granted(String perm) {
        return checkSelfPermission(perm) == PackageManager.PERMISSION_GRANTED;
    }

    private static String androidPermissionFor(String resource) {
        if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource)) return Manifest.permission.CAMERA;
        if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)) return Manifest.permission.RECORD_AUDIO;
        return null;
    }

    /** When Android has stopped asking, point the way to the switch in Settings. */
    private void explainIfBlocked(String perm, String what) {
        if (granted(perm) || shouldShowRequestPermissionRationale(perm) || isFinishing()) return;
        new AlertDialog.Builder(this)
                .setTitle(what + " is switched off")
                .setMessage("Phosphor Loop needs the " + what.toLowerCase() + " for this. Tap Open settings, then Permissions, then "
                        + what + ", and choose Allow.")
                .setPositiveButton("Open settings", (d, w) -> {
                    try {
                        startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                                Uri.fromParts("package", getPackageName(), null)));
                    } catch (ActivityNotFoundException ignored) {
                    }
                })
                .setNegativeButton("Not now", null)
                .show();
    }

    @Override
    @SuppressWarnings("deprecation")
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQ_FILE) {
            ValueCallback<Uri[]> cb = fileCallback;
            fileCallback = null;
            if (cb != null) cb.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
        } else if (requestCode == REQ_PROJECTION) {
            if (resultCode == RESULT_OK && data != null) {
                try {
                    SoundService.start(this, resultCode, data, soundRate, soundSession);
                } catch (RuntimeException e) {
                    soundEvent("error", soundSession, 0);
                }
            } else {
                soundEvent("denied", soundSession, 0);
            }
        }
    }

    // ---------------------------------------------------------------- page loading

    private static boolean isOurs(Uri u) {
        return u != null && "https".equals(u.getScheme()) && OfflineLoader.SITE_HOST.equals(u.getHost())
                && u.getPath() != null && u.getPath().startsWith(OfflineLoader.SITE_PATH);
    }

    private void openOutside(Uri u) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, u).addCategory(Intent.CATEGORY_BROWSABLE));
        } catch (ActivityNotFoundException ignored) {
        }
    }

    private void showCantOpen() {
        String html = "<!doctype html><html><head><meta name='viewport' content='width=device-width,initial-scale=1'>"
                + "<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#191816;"
                + "color:#ece5d6;font:18px/1.5 sans-serif;text-align:center;padding:24px;box-sizing:border-box}"
                + "a{display:inline-block;margin-top:18px;padding:14px 26px;border-radius:8px;background:#4a3a22;color:#ffe2b8;"
                + "border:1px solid #ffae3b;text-decoration:none;font-weight:600}</style></head><body><div>"
                + "Phosphor Loop needs the internet the very first time it opens.<br>Connect to Wi-Fi or mobile data, then tap Try again."
                + "<br><a href='" + SITE + "'>Try again</a></div></body></html>";
        web.loadDataWithBaseURL(null, html, "text/html", "utf-8", null);
    }

    private void rebuildAfterCrash() {
        if (output != null) output.close();
        closeSoundPort();
        SoundService.stop(this);
        if (web != null) {
            root.removeView(web);
            try { web.destroy(); } catch (RuntimeException ignored) { }
        }
        buildWebView();
        web.loadUrl(SITE);
    }

    private final class PageClient extends WebViewClient {
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            return loader.intercept(request);
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri u = request.getUrl();
            String scheme = u == null ? "" : String.valueOf(u.getScheme());
            if (isOurs(u) || "about".equals(scheme) || "blob".equals(scheme) || "data".equals(scheme)) return false;
            if (!request.isForMainFrame()) return false;
            openOutside(u);   // links to other sites open in the phone's browser
            return true;
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (request.isForMainFrame() && isOurs(request.getUrl())) showCantOpen();
        }

        @Override
        public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
            // The graphics part of the page stopped (usually low memory). Start it again rather than closing the app.
            if (view == web) main.post(MainActivity.this::rebuildAfterCrash);
            return true;
        }
    }

    private final class PageChrome extends WebChromeClient {
        @Override
        public void onPermissionRequest(PermissionRequest request) {
            Uri origin = request.getOrigin();
            if (origin == null || !OfflineLoader.SITE_HOST.equals(origin.getHost())) {
                request.deny();
                return;
            }
            List<String> wanted = new ArrayList<>();
            List<String> missing = new ArrayList<>();
            for (String r : request.getResources()) {
                String perm = androidPermissionFor(r);
                if (perm == null) continue;
                wanted.add(r);
                if (!granted(perm) && !missing.contains(perm)) missing.add(perm);
            }
            if (wanted.isEmpty()) {
                request.deny();
                return;
            }
            if (missing.isEmpty()) {
                request.grant(wanted.toArray(new String[0]));
                return;
            }
            if (pendingMedia != null) pendingMedia.deny();
            pendingMedia = request;
            pendingMediaResources = wanted;
            requestPermissions(missing.toArray(new String[0]), REQ_MEDIA);
        }

        @Override
        public void onPermissionRequestCanceled(PermissionRequest request) {
            if (pendingMedia == request) {
                pendingMedia = null;
                pendingMediaResources = null;
            }
        }

        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
            if (fileCallback != null) fileCallback.onReceiveValue(null);
            fileCallback = callback;
            try {
                startActivityForResult(params.createIntent(), REQ_FILE);
                return true;
            } catch (ActivityNotFoundException e) {
                fileCallback = null;
                return false;
            }
        }

        @Override
        public boolean onCreateWindow(WebView view, boolean isDialog, boolean isUserGesture, Message resultMsg) {
            // A tapped link to another site opens in the browser; anything else is the output window
            WebView.HitTestResult hit = view.getHitTestResult();
            if (isUserGesture && hit != null && hit.getExtra() != null
                    && (hit.getType() == WebView.HitTestResult.SRC_ANCHOR_TYPE
                    || hit.getType() == WebView.HitTestResult.SRC_IMAGE_ANCHOR_TYPE)) {
                openOutside(Uri.parse(hit.getExtra()));
                return false;
            }
            return output.open(resultMsg);
        }

        @Override
        public void onShowCustomView(View view, CustomViewCallback callback) {
            if (customView != null) {
                callback.onCustomViewHidden();
                return;
            }
            customView = view;
            customCallback = callback;
            view.setBackgroundColor(Color.BLACK);
            root.addView(view, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
            root.requestApplyInsets();
            hideSystemBars();
        }

        @Override
        public void onHideCustomView() {
            if (customView == null) return;
            root.removeView(customView);
            customView = null;
            customCallback = null;
            root.requestApplyInsets();
            hideSystemBars();
        }

        @Override
        public Bitmap getDefaultVideoPoster() {
            // Without this, video elements flash a grey play button before they start
            return Bitmap.createBitmap(1, 1, Bitmap.Config.ARGB_8888);
        }
    }

    private void exitFullScreen() {
        WebChromeClient.CustomViewCallback cb = customCallback;
        if (customView != null) {
            root.removeView(customView);
            customView = null;
            customCallback = null;
            root.requestApplyInsets();
        }
        if (cb != null) cb.onCustomViewHidden();
        hideSystemBars();
    }
}
