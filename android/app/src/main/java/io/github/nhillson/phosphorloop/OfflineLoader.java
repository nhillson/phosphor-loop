package io.github.nhillson.phosphorloop;

import android.content.Context;
import android.content.res.AssetManager;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.Uri;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;

import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HashMap;
import java.util.Iterator;
import java.util.Map;

/**
 * Loads Phosphor Loop from its web address, so every update to the site reaches the app by itself,
 * and keeps a copy of each file on the phone. Without internet the copy is used instead, and the very
 * first time (before anything was saved) the copy that came inside the app is used.
 */
final class OfflineLoader {
    static final String SITE_HOST = "nhillson.github.io";
    static final String SITE_PATH = "/phosphor-loop/";
    private static final String FONT_CSS_HOST = "fonts.googleapis.com";
    private static final String FONT_FILE_HOST = "fonts.gstatic.com";

    private final ConnectivityManager connectivity;
    private final AssetManager assets;
    private final File saved;
    private final Map<String, String[]> bundled = new HashMap<>();   // address -> { asset file, mime type, charset }
    private volatile String userAgent = "";

    OfflineLoader(Context context) {
        connectivity = context.getSystemService(ConnectivityManager.class);
        assets = context.getAssets();
        saved = new File(context.getFilesDir(), "offline");
        //noinspection ResultOfMethodCallIgnored
        saved.mkdirs();
        try (InputStream in = assets.open("offline/manifest.json")) {
            JSONObject all = new JSONObject(new String(readAll(in), StandardCharsets.UTF_8));
            for (Iterator<String> it = all.keys(); it.hasNext(); ) {
                String key = it.next();
                JSONObject e = all.getJSONObject(key);
                bundled.put(key, new String[] { e.getString("file"), e.getString("mime"), e.optString("charset", "") });
            }
        } catch (Exception ignored) {
            // No copy inside the app: it simply needs internet the first time
        }
    }

    void setUserAgent(String ua) {
        userAgent = ua == null ? "" : ua;
    }

    /** The name a file is kept under, or null for addresses this class leaves alone. */
    static String keyFor(Uri u) {
        if (u == null || !"https".equals(u.getScheme()) || u.getHost() == null) return null;
        String host = u.getHost();
        String path = u.getPath() == null ? "/" : u.getPath();
        if (SITE_HOST.equals(host)) {
            if (!path.startsWith(SITE_PATH)) return null;
            if (path.endsWith("/")) path += "index.html";
            return "https://" + host + path;                    // ?show=1 and the like share one copy
        }
        if (FONT_CSS_HOST.equals(host)) {
            String q = u.getEncodedQuery();
            return "https://" + host + path + (q == null ? "" : "?" + q);
        }
        if (FONT_FILE_HOST.equals(host)) return "https://" + host + path;
        return null;
    }

    WebResourceResponse intercept(WebResourceRequest request) {
        try {
            if (request == null || !"GET".equalsIgnoreCase(request.getMethod())) return null;
            Uri url = request.getUrl();
            String key = keyFor(url);
            if (key == null) return null;
            Map<String, String> headers = request.getRequestHeaders();
            if (headers != null) {
                for (String h : headers.keySet()) if ("range".equalsIgnoreCase(h)) return null;
            }
            boolean font = !SITE_HOST.equals(url.getHost());
            if (online()) {
                try {
                    Fetched f = fetch(url.toString());
                    if (f == null) return null;             // not a plain 200: let the WebView ask the server itself
                    keep(key, f);
                    return respond(f.body, f.mime, f.charset, font);
                } catch (IOException e) {
                    // The network let us down part way: fall back to the saved copy below
                }
            }
            WebResourceResponse r = fromSaved(key, font);
            if (r == null) r = fromBundle(key, font);
            return r;
        } catch (RuntimeException e) {
            return null;
        }
    }

    private boolean online() {
        try {
            Network n = connectivity.getActiveNetwork();
            if (n == null) return false;
            NetworkCapabilities c = connectivity.getNetworkCapabilities(n);
            return c != null && c.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                    && c.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED);
        } catch (RuntimeException e) {
            return false;
        }
    }

    private static final class Fetched {
        byte[] body;
        String mime;
        String charset;
    }

    private Fetched fetch(String address) throws IOException {
        HttpURLConnection c = (HttpURLConnection) new URL(address).openConnection();
        try {
            c.setInstanceFollowRedirects(false);
            c.setConnectTimeout(5000);
            c.setReadTimeout(12000);
            c.setUseCaches(false);
            if (!userAgent.isEmpty()) c.setRequestProperty("User-Agent", userAgent);
            c.setRequestProperty("Cache-Control", "no-cache");
            if (c.getResponseCode() != 200) return null;
            Fetched f = new Fetched();
            try (InputStream in = c.getInputStream()) {
                f.body = readAll(in);
            }
            String type = c.getContentType();
            f.mime = mimeOf(type, address);
            f.charset = charsetOf(type, f.mime);
            return f;
        } finally {
            c.disconnect();
        }
    }

    private void keep(String key, Fetched f) {
        String name = hash(key);
        File tmp = new File(saved, name + "." + Thread.currentThread().getId() + ".tmp");
        try (FileOutputStream out = new FileOutputStream(tmp)) {
            out.write(f.body);
        } catch (IOException e) {
            //noinspection ResultOfMethodCallIgnored
            tmp.delete();
            return;
        }
        File body = new File(saved, name + ".body");
        if (!tmp.renameTo(body)) {
            //noinspection ResultOfMethodCallIgnored
            tmp.delete();
            return;
        }
        File type = new File(saved, name + ".type");
        try (FileOutputStream out = new FileOutputStream(type)) {
            out.write((f.mime + "\n" + (f.charset == null ? "" : f.charset)).getBytes(StandardCharsets.UTF_8));
        } catch (IOException ignored) {
        }
    }

    private WebResourceResponse fromSaved(String key, boolean font) {
        String name = hash(key);
        File body = new File(saved, name + ".body");
        File type = new File(saved, name + ".type");
        if (!body.isFile() || !type.isFile()) return null;
        try (InputStream b = new FileInputStream(body); InputStream t = new FileInputStream(type)) {
            String[] mt = new String(readAll(t), StandardCharsets.UTF_8).split("\n", -1);
            String mime = mt.length > 0 && !mt[0].isEmpty() ? mt[0] : mimeOf(null, key);
            String charset = mt.length > 1 && !mt[1].isEmpty() ? mt[1] : null;
            return respond(readAll(b), mime, charset, font);
        } catch (IOException e) {
            return null;
        }
    }

    private WebResourceResponse fromBundle(String key, boolean font) {
        String[] e = bundled.get(key);
        if (e == null) return null;
        try (InputStream in = assets.open("offline/" + e[0])) {
            return respond(readAll(in), e[1], e[2].isEmpty() ? null : e[2], font);
        } catch (IOException ex) {
            return null;
        }
    }

    private static WebResourceResponse respond(byte[] body, String mime, String charset, boolean font) {
        Map<String, String> headers = new HashMap<>();
        headers.put("Cache-Control", "no-cache");
        if (font) headers.put("Access-Control-Allow-Origin", "*");
        return new WebResourceResponse(mime, charset, 200, "OK", headers, new ByteArrayInputStream(body));
    }

    private static String mimeOf(String contentType, String address) {
        if (contentType != null) {
            String m = contentType.split(";")[0].trim().toLowerCase();
            if (!m.isEmpty()) return m;
        }
        String a = address.toLowerCase();
        int q = a.indexOf('?');
        if (q >= 0) a = a.substring(0, q);
        if (a.endsWith(".html") || a.endsWith("/")) return "text/html";
        if (a.endsWith(".js")) return "application/javascript";
        if (a.endsWith(".css") || a.contains("fonts.googleapis.com/")) return "text/css";
        if (a.endsWith(".png")) return "image/png";
        if (a.endsWith(".woff2")) return "font/woff2";
        if (a.endsWith(".woff")) return "font/woff";
        if (a.endsWith(".ttf")) return "font/ttf";
        if (a.endsWith(".json")) return "application/json";
        return "application/octet-stream";
    }

    private static String charsetOf(String contentType, String mime) {
        if (contentType != null) {
            for (String part : contentType.split(";")) {
                String p = part.trim();
                if (p.toLowerCase().startsWith("charset=")) return p.substring(8).replace("\"", "").trim();
            }
        }
        if (mime.startsWith("text/") || mime.equals("application/javascript") || mime.equals("application/json")) return "utf-8";
        return null;
    }

    static String hash(String s) {
        try {
            byte[] d = MessageDigest.getInstance("SHA-256").digest(s.getBytes(StandardCharsets.UTF_8));
            StringBuilder b = new StringBuilder();
            for (int i = 0; i < 16; i++) b.append(String.format("%02x", d[i] & 0xff));
            return b.toString();
        } catch (Exception e) {
            return Integer.toHexString(s.hashCode());
        }
    }

    static byte[] readAll(InputStream in) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[16384];
        int n;
        while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        return out.toByteArray();
    }
}
