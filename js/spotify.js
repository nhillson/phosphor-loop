// Spotify metadata/playback observer with explicit user-driven seeking. Audio stays in the existing player.
(() => {
  const TOKEN_KEY = 'phosphor-spotify-session-v1', PKCE_KEY = 'phosphor-spotify-pkce-v1';
  const CLIENT_KEY = 'phosphor-spotify-client-id';
  const safe = storage => ({
    get: key => { try { return storage?.getItem(key); } catch (_) { return null; } },
    set: (key, value) => { try { storage?.setItem(key, value); } catch (_) {} },
    remove: key => { try { storage?.removeItem(key); } catch (_) {} },
  });
  class SpotifyObserver extends EventTarget {
    constructor(options = {}) {
      super();
      this.fetch = options.fetch || globalThis.fetch.bind(globalThis);
      this.now = options.now || (() => performance.now());
      this.wallNow = options.wallNow || (() => Date.now());
      let local, session;
      try { local = globalThis.localStorage; session = globalThis.sessionStorage; } catch (_) {}
      this.local = safe(options.storage || local); this.session = safe(options.session || session);
      this.clientId = this.local.get(CLIENT_KEY) || '4c2e5c1af3044461b4d911072a0a0dbd';
      try { this.token = JSON.parse(this.session.get(TOKEN_KEY) || 'null'); } catch (_) { this.token = null; }
      this.accountId = null; this.snapshot = null; this.queue = []; this.revision = 0;
      this.playbackVersion = 0; this.seeking = false;
      this.timer = null; this.refreshing = null; this.retryUntil = 0; this.queueAt = -Infinity;
    }
    emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }
    setClientId(value) { this.clientId = value.trim(); this.local.set(CLIENT_KEY, this.clientId); }
    static redirectUri(location = globalThis.location) { return location.origin + location.pathname; }
    async connect(clientId, location = globalThis.location) {
      this.setClientId(clientId);
      if (!/^[a-zA-Z0-9]{32}$/.test(this.clientId)) throw new Error('Enter the 32-character client ID from your Spotify developer app.');
      if (!(location.protocol === 'https:' || (location.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(location.hostname))))
        throw new Error('Open Phosphor Loop on HTTPS or http://127.0.0.1:8000/ to connect Spotify.');
      const encode = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      const verifier = encode(crypto.getRandomValues(new Uint8Array(64)));
      const state = encode(crypto.getRandomValues(new Uint8Array(24)));
      const challenge = encode(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
      const redirectUri = SpotifyObserver.redirectUri(location);
      this.session.set(PKCE_KEY, JSON.stringify({ verifier, state, redirectUri, at: this.wallNow() }));
      const pending = this.session.get(PKCE_KEY);
      if (!pending) throw new Error('Spotify sign-in needs browser session storage enabled.');
      const url = new URL('https://accounts.spotify.com/authorize');
      url.search = new URLSearchParams({ client_id: this.clientId, response_type: 'code', redirect_uri: redirectUri,
        code_challenge_method: 'S256', code_challenge: challenge, state,
        scope: 'user-read-playback-state user-read-currently-playing user-read-private user-modify-playback-state' });
      location.assign(url.href);
    }
    async finishLogin(location = globalThis.location, history = globalThis.history) {
      const url = new URL(location.href);
      if (!url.searchParams.has('code') && !url.searchParams.has('error')) return false;
      let pending;
      try { pending = JSON.parse(this.session.get(PKCE_KEY) || 'null'); } catch (_) {}
      const code = url.searchParams.get('code'), error = url.searchParams.get('error'), state = url.searchParams.get('state');
      for (const key of ['code', 'state', 'error', 'error_description']) url.searchParams.delete(key);
      history.replaceState(null, '', url.pathname + url.search + url.hash);
      this.session.remove(PKCE_KEY);
      if (!pending || state !== pending.state || this.wallNow() - pending.at > 10 * 60 * 1000)
        throw new Error('Spotify sign-in expired or could not be verified. Connect again.');
      if (error) throw new Error('Spotify sign-in was cancelled or denied.');
      await this.exchange({ grant_type: 'authorization_code', code, redirect_uri: pending.redirectUri, code_verifier: pending.verifier });
      return true;
    }
    async request(url, options = {}) {
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 10000);
      try { return await this.fetch(url, { ...options, signal: controller.signal }); }
      finally { clearTimeout(timer); }
    }
    async exchange(fields) {
      const revision = this.revision;
      const response = await this.request('https://accounts.spotify.com/api/token', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: this.clientId, ...fields }),
      });
      if (!response.ok) {
        if ([400, 401].includes(response.status)) this.clearSession();
        throw new Error('Spotify session could not be renewed. Connect again.');
      }
      const data = await response.json();
      if (revision !== this.revision) throw new Error('Spotify connection changed.');
      this.token = { access: data.access_token, refresh: data.refresh_token || this.token?.refresh,
        scope: data.scope || this.token?.scope || '', expiresAt: this.wallNow() + data.expires_in * 1000 };
      this.session.set(TOKEN_KEY, JSON.stringify(this.token));
    }
    async accessToken(force = false) {
      if (!this.token) throw new Error('Connect Spotify to read playback.');
      if (!force && this.token.expiresAt > this.wallNow() + 30000) return this.token.access;
      if (!this.token.refresh) { this.clearSession(); throw new Error('Spotify session expired. Connect again.'); }
      if (!this.refreshing) this.refreshing = this.exchange({ grant_type: 'refresh_token', refresh_token: this.token.refresh }).finally(() => { this.refreshing = null; });
      await this.refreshing; return this.token.access;
    }
    async api(path, retry = true, options = {}) {
      if (this.now() < this.retryUntil) throw new Error('Spotify is rate limited. Waiting before retrying.');
      const access = await this.accessToken();
      const response = await this.request('https://api.spotify.com/v1' + path, { ...options, headers: { ...options.headers, Authorization: 'Bearer ' + access } });
      if (response.status === 401 && retry) { await this.accessToken(true); return this.api(path, false, options); }
      if (response.status === 429) {
        this.retryUntil = this.now() + Math.max(1000, (Number(response.headers.get('Retry-After')) || 30) * 1000);
        throw new Error('Spotify is rate limited. Waiting before retrying.');
      }
      if (response.status === 401) { this.clearSession(); throw new Error('Spotify session expired. Connect again.'); }
      if (response.status === 403) throw new Error('Spotify access denied. Check the app’s user allowlist and permissions.');
      if (response.status === 404 && path.startsWith('/me/player/seek')) throw new Error('No active Spotify player. Start playback in Spotify, then try seeking again.');
      if (!response.ok) throw new Error('Spotify playback is unavailable. Retrying…');
      return response.status === 204 ? null : response.json();
    }
    async poll() {
      const revision = this.revision, playbackVersion = this.playbackVersion;
      if (!this.token || this.seeking) return;
      try {
        if (!this.accountId) {
          const profile = await this.api('/me');
          if (revision !== this.revision) return;
          if (!profile?.id) throw new Error('Spotify account could not be identified.');
          this.accountId = profile.id;
        }
        const playback = await this.api('/me/player');
        if (revision !== this.revision || this.seeking || playbackVersion !== this.playbackVersion) return;
        const previous = this.snapshot;
        const item = playback?.currently_playing_type === 'track' && !playback.item?.is_local ? playback.item : null;
        const track = item?.uri ? { uri: item.uri, name: item.name, artists: (item.artists || []).map(a => a.name), durationMs: item.duration_ms } : null;
        this.snapshot = { accountId: this.accountId, track, playing: playback?.is_playing === true,
          progressMs: Number(playback?.progress_ms) || 0, receivedAt: this.now() };
        const changed = previous?.track?.uri !== track?.uri;
        if (changed) { this.queue = []; this.emit('queue', []); }
        this.emit('playback', this.snapshot);
        this.emit('status', { connected: true, stale: false, message: track ? (this.snapshot.playing ? 'Connected · Playing' : 'Connected · Paused') : 'Connected · No active music track' });
        if (changed || this.now() - this.queueAt >= 15000) {
          const queue = await this.api('/me/player/queue');
          if (revision !== this.revision) return;
          this.queueAt = this.now();
          if (queue?.currently_playing?.uri === track?.uri) {
            this.queue = (queue.queue || []).filter(t => t.type === 'track').slice(0, 5)
              .map(t => ({ uri: t.uri, name: t.name, artists: (t.artists || []).map(a => a.name) }));
            this.emit('queue', this.queue);
          }
        }
      } catch (error) {
        if (revision === this.revision) this.emit('status', { connected: !!this.token, stale: true, message: error.name === 'AbortError' ? 'Spotify request timed out. Retrying…' : error.message });
      }
    }
    start() {
      this.stop(); const revision = this.revision;
      const run = async () => {
        await this.poll();
        if (revision === this.revision && this.token) this.timer = setTimeout(run, Math.max(3000, this.retryUntil - this.now()));
      };
      if (this.token) run();
    }
    stop() { this.revision++; clearTimeout(this.timer); this.timer = null; }
    clearSession() { this.token = null; this.accountId = null; this.session.remove(TOKEN_KEY); }
    disconnect() {
      this.stop(); this.clearSession(); this.session.remove(PKCE_KEY); this.snapshot = null; this.queue = [];
      this.emit('queue', []); this.emit('disconnect', null);
      this.emit('status', { connected: false, stale: false, message: 'Spotify disconnected.' });
    }
    get canSeek() { return (this.token?.scope || '').split(' ').includes('user-modify-playback-state'); }
    async seek(positionMs) {
      if (!this.canSeek) throw new Error('Reconnect Spotify to enable seeking from the timeline.');
      const snapshot = this.snapshot, revision = this.revision;
      if (!snapshot?.track) throw new Error('No Spotify track is active.');
      if (!Number.isFinite(positionMs)) throw new Error('Invalid track position.');
      // Seeking past the duration can skip tracks. Keep the handle within this track.
      const target = Math.round(Math.min(Math.max(0, snapshot.track.durationMs - 1), Math.max(0, positionMs)));
      this.playbackVersion++; this.seeking = true;
      try { await this.api('/me/player/seek?position_ms=' + target, true, { method: 'PUT' }); }
      finally { this.seeking = false; }
      if (revision !== this.revision || this.snapshot?.track?.uri !== snapshot.track.uri) return;
      this.snapshot = { ...this.snapshot, progressMs: target, receivedAt: this.now() };
      this.emit('playback', this.snapshot);
      return target;
    }
    position(now = this.now()) {
      const s = this.snapshot;
      if (!s?.track) return null;
      return Math.min(s.track.durationMs, Math.max(0, s.progressMs + (s.playing ? Math.min(10000, Math.max(0, now - s.receivedAt)) : 0)));
    }
  }
  globalThis.PhosphorSpotify = SpotifyObserver;
})();
