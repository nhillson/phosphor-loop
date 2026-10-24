# Spotify song sequences — design draft

Status: proof-of-concept implementation complete; verification results below. Live Spotify sign-in is performed by the user.
Updated: 2026-10-24.

## Intended experience

Phosphor Loop connects to the listener’s Spotify account and displays the song currently playing and what Spotify reports as queued next. Each song has its own remembered sequence of visual looks and/or clips.

Example: play “Ghosts ’n’ Stuff,” build and name its steps, then play another song. The editor switches to that song’s sequence, initially empty if it has never been configured. When “Ghosts ’n’ Stuff” returns, its last saved sequence returns too. A known song restores its sequence rather than being cleared on every playback.

This replaces the current single global sequence model. It stays inside Phosphor Loop.

## Confirmed requirements

- Read the currently playing song from Spotify.
- Read the upcoming queue, including the next song when available.
- Associate one remembered sequence with each song.
- Restore the latest sequence when that song plays again.
- Show an empty sequence for a previously unconfigured song.
- Keep a configurable number of beats for each step.
- Stack the editor’s steps vertically rather than in a horizontal scrolling row.
- Allow each step to be renamed independently of its saved preset or clip.
- Support copying, pasting, and duplicating steps.
- Write and clarify this design before beginning implementation.

## Confirmed follow-up decisions

- This is a proof of concept. Spotify supplies track metadata and playback state; Phosphor Loop continues to produce visuals and track the captured audio locally.
- A remembered sequence starts automatically when its song starts playing.
- Spotify pause pauses sequence advancement; resume continues from the corresponding song position.
- Seeking forward or backward selects the step corresponding to the new song position, rather than continuing an independent beat counter.
- Skipping to another song loads that song’s remembered sequence, or an empty sequence if none exists. A remembered sequence starts automatically when playback is active.
- The same song restarting from the beginning resets its sequence. Joining playback midway should select the corresponding step, consistent with seek behavior.
- Songs with no saved steps run Autopilot.
- Execution was authorized after these clarifications.
- Keep the Spotify integration focused on metadata and playback observation for this proof of concept. Provider documentation remains a reference, not an additional user approval flow.

## Proposed screen

A Spotify connection area sits above the song editor. It shows connection status, song title and artist, playback state, and upcoming song(s). Playback continues in the user’s existing Spotify player/device.

The active editor is clearly labeled with the song it belongs to. Its steps form a vertical list:

```text
Spotify: Connected
Now: Ghosts ’n’ Stuff — deadmau5
Next: [next queued song]

Sequence for Ghosts ’n’ Stuff                 Saved

1  Intro                                   16 beats
   Look: [saved look]           Rename / Copy / Duplicate / Remove

2  Build                                   32 beats
   Look or clip: [selection]   Rename / Copy / Duplicate / Remove

3  Drop                                    64 beats
   Look or clip: [selection]   Rename / Copy / Duplicate / Remove

[Add step] [Paste step]
```

Interpretation to confirm: “stacked vertically” means the steps within the active song’s sequence. If it also means displaying several complete song sequences vertically, the screen should instead have separate current-song and upcoming-song panels.

## Song identity and saving

Proposed: use Spotify track URI/ID, rather than song title, as the primary key. Distinct remixes, live versions and edits remain distinct unless the user explicitly copies a sequence between them. Track relinking and repeated queue entries need handling without relying on display names.

Autosave step edits, order, names, beat counts, sources, and transition settings. Switching songs saves the outgoing editor before loading the incoming one. Queue refreshes must never overwrite unsaved work or create a sequence for the wrong track.

First version proposal: persistence in this browser on this device, namespaced by Spotify account. Signing into Spotify alone does not provide cloud storage for Phosphor Loop sequences. Cross-device sync would require a separate storage design.

Look steps should copy their settings into the sequence, as the current implementation does. Editing the original preset would then leave existing song sequences intact. Local video files need a separate persistence decision: the current implementation requires selecting them again after reopening. Library clip identifiers can be stored, but the clip library must remain available.

Proposed data shape:

```json
{
  "schemaVersion": 1,
  "accountKey": "<account namespace>",
  "songs": {
    "spotify:track:<id>": {
      "title": "Ghosts ’n’ Stuff",
      "artists": ["deadmau5"],
      "updatedAt": "<timestamp>",
      "steps": [
        {
          "id": "<unique step id>",
          "name": "Intro",
          "beats": 16,
          "kind": "look",
          "payload": "<copied look settings or clip reference>"
        }
      ],
      "transition": { "type": "fade", "beats": 2 },
      "endBehavior": "<to be decided>"
    }
  }
}
```

Account lookup and any additional permissions needed for it must be verified during implementation; do not silently assume an account namespace is available from playback responses.

## Step editing

- **Rename:** editable step label; does not rename the preset, file, or song.
- **Duplicate:** insert an independent copy immediately after the original, with a new ID.
- **Copy:** copy the entire step, including its name, source/settings, and beat duration.
- **Paste:** insert a new independent step after the selected step, or append if none is selected.
- **Reorder:** retain move-up/move-down controls; drag-and-drop is optional.
- **Cross-song copy:** proposed internal clipboard remains available when the active song changes.
- **Clipboard scope:** proposed first version is inside Phosphor Loop; operating-system clipboard/export is a separate choice.

Missing local media should be labeled explicitly; copying a reference must not imply that a video file has been copied or uploaded.

## Song changes versus sequence playback

These are separate states: the song being heard, the song being edited, and the visual sequence currently running.

Proposed default: the active editor follows the current Spotify song automatically. A track change stops the outgoing sequence and loads the incoming song’s saved steps or an empty list. A remembered sequence starts automatically when the incoming song is playing; if paused, it loads at the corresponding position and waits for resume.

An empty sequence must not inherit steps from the previous song. Autopilot runs while the song has no saved steps. Adding its first step enables its song sequence at the current playback position.

Spotify repeat of the same track resets the sequence even when its track ID does not change. Pause/resume preserves song-relative alignment; seek recomputes the active step; skip switches song sequences. Connection loss and switching Spotify devices must preserve saved sequences and reconcile against the next reliable playback snapshot.

## Beat timing

Spotify playback metadata can identify the song and estimate its progress. It is not a sample-accurate beat clock. Implemented: Spotify supplies identity and playback state; song-relative step boundaries use the saved BPM and start offset. The existing local tracker can supply a detected BPM when the user requests it, and still drives audio-reactive effects.

Spotify authorization does not itself connect audio to Phosphor Loop. Computer-audio/loopback capture is needed for local BPM detection and audio-reactive effects, but song-position sequencing can run with a manually configured BPM alone. Do not assume Spotify Audio Analysis or Audio Features access is available to a newly created application.

Confirmed: sequences map to positions within the song. Cumulative step beat counts define the step boundaries. Pause, resume, seek, replay, and joining midway must resolve against that song position.

Implemented proof-of-concept approach: store a BPM and optional start offset per song, use Spotify progress to locate the active step, and transition when that song-relative position crosses a step boundary. Provide a manual BPM override so a remembered sequence can resolve immediately before the audio tracker acquires tempo. This is an approximation for tracks with tempo changes; supporting a full tempo map is outside the initial scope. Do not keep the earlier independent elapsed-beat counter as the authority after a seek.

## Spotify API feasibility and constraints

Checked against official documentation on 2026-10-24:

- [Playback state](https://developer.spotify.com/documentation/web-api/reference/get-information-about-the-users-current-playback) provides current item, playback progress and playback state.
- [Currently playing track](https://developer.spotify.com/documentation/web-api/reference/get-the-users-currently-playing-track) provides the current item; it can be absent or a non-song type.
- [Queue](https://developer.spotify.com/documentation/web-api/reference/get-queue) provides the currently playing item and queued items. Treat this as an observed snapshot, not a promise that a particular song will play next.
- Use read scopes for metadata, plus `user-read-private` for account identity. The canvas scrub bar additionally requests `user-modify-playback-state` for explicit seek gestures; existing sessions must reconnect to grant it.
- [Authorization Code with PKCE](https://developer.spotify.com/documentation/web-api/tutorials/code-pkce-flow) is the proposed browser authentication flow; do not put a client secret in the site.
- [Redirect URI rules](https://developer.spotify.com/documentation/web-api/concepts/redirect_uri) require HTTPS except explicit loopback IP addresses. `localhost` is not an allowed callback hostname. A registered callback on `http://127.0.0.1:8000/…` is a plausible local setup; double-clicked `file://` is not the proposed Spotify login path.
- [Development mode](https://developer.spotify.com/documentation/web-api/concepts/quota-modes) currently requires a Premium app owner and allows up to five authenticated, allowlisted users. App access must be confirmed before promising public availability.

Provider reference: the [queue endpoint policy notes](https://developer.spotify.com/documentation/web-api/reference/get-queue) include a restriction on synchronizing recordings with visual media. The user clarified that this is a metadata/playback-state proof of concept. Record that scope without treating the clarification as a provider permission determination or adding a separate approval workflow.

Operational design: poll with conservative configurable intervals, refresh around expected track boundaries, honor `429` backoff, refresh expired tokens, and distinguish unavailable/stale data from an actual track change. Never clear a song sequence because one API request fails. Disconnect must stop polling and remove credentials; treatment of retained Spotify-derived data must follow the provider’s requirements.

## Clarifications and proof-of-concept defaults

1. **Spotify setup — configured:** user supplied the new app’s public Client ID. User signs in through the app to verify live Spotify access.
2. **Playback start — resolved:** remembered sequences start automatically when the song plays.
3. **Alignment — resolved:** follow song position, including pause/resume, seeking, skipping and joining midway. Implemented with a per-song BPM/start-offset approximation.
4. **Empty sequences — resolved:** run Autopilot. Finished sequences retain the existing per-song Hold, Loop, or Start Autopilot choice; Hold is the default.
5. **Layout and queue — default:** vertical steps for the active song; show the next song and up to four more titles. Editing upcoming songs can be added later.
6. **Persistence and identity — default:** browser-local storage, separated by account and track URI. Releases/remixes remain separate. Copy works between songs.
7. **Editing while running — default:** save and apply immediately against current playback position. Undo is outside this proof of concept.
8. **Media — default:** retain look and clip steps. Local videos require re-selection after reopening; library clip IDs persist.

## Proposed implementation stages, after clarification

1. Confirm the remaining behavior questions and Spotify app configuration; update this document with decisions.
2. Add Spotify sign-in, disconnect, playback/queue readout, and reliable song-change detection.
3. Replace the global sequence store with per-song persistence and automatic editor switching.
4. Build the vertical step editor with names, copy/paste, duplication, and reordering.
5. Connect the agreed song/beat playback behavior to existing visual rendering and transitions.
6. Verify track changes, returning songs, same-track replay, pauses, seeks, stale queue data, missing media, reload persistence, and account changes.

## Implementation and verification

- `js/spotify.js`: Spotify metadata observer with explicit user-driven seek support, PKCE sign-in, session token refresh, account identity, playback and queue polling, rate-limit backoff, seeking, and disconnect. Public default client ID: `4c2e5c1af3044461b4d911072a0a0dbd`.
- Register `http://127.0.0.1:8000/` as the exact local redirect URI, open that URL, and use Connect Spotify. No client secret is used. Tokens remain in the tab's session storage, not in source or saved look presets.
- `js/step-sequencer.js`: song-position-to-step mapping plus the standalone audio-beat scheduler.
- `js/app.js`: canvas track timeline with elapsed/total time and clickable step checkpoints, per-account/per-track sequence store, automatic switching/start, Autopilot fallback, vertical step editor, internal cross-song clipboard, independent duplication, and transition rendering.
- Existing standalone drafts are preserved separately; they are never silently assigned to a Spotify song.
- Playback polls roughly every three seconds; queue polls every fifteen seconds and on track changes. This is a proof of concept, not sample-accurate Spotify event delivery. After ten seconds without a fresh playback snapshot, song-driven sequence advancement pauses.
- Each song defaults to 120 BPM and zero start offset. Set the BPM/offset once for that song, or use the detected BPM button after capturing audio. Variable-tempo maps are not implemented.
- Step edits save immediately. Editing a running song resolves the revised sequence against its current position. Stop holds the current look until Follow song, another song, or replay from the beginning.
- Initial layout is one active song editor with vertically stacked steps, plus the next song and up to four more queued titles. Upcoming-song editing, cloud sync, and native clipboard/export are not included.
- `npm run sequencer:test` checks authorization/refresh/backoff, position mapping, song restore and automatic playback, pause/seek/skip/replay, copy and duplication across songs, reload/account isolation, vertical mobile layout, real video decoding/playback, and disconnect. Browser tests use simulated Spotify responses; live account access still requires the user’s sign-in.

## Acceptance examples

- Configure three named steps for song A. Switch to previously unseen song B: B shows zero steps. Return to A: the same three steps and beat counts return.
- Rename a step to “Drop,” duplicate it, change the duplicate to 32 beats: the original stays unchanged.
- Copy a step from A and paste into B: B gets an independent step and A remains intact.
- Refresh the queue during editing: the current song’s edits survive and are not assigned to the next song.
- Playback API temporarily fails: the UI shows stale/disconnected state without deleting song sequences.
- A remembered song starts its sequence automatically when Spotify plays it.
- Pause Spotify: the sequence stops advancing. Resume: it continues at the corresponding song position.
- Seek forward or backward: the matching sequence step becomes active without replaying every intervening step.
- Skip songs: the old sequence stops and the incoming song’s saved sequence starts automatically, or its empty editor appears.
- All steps are usable in a vertical list without horizontal sequence scrolling.

## Canvas timeline (implemented follow-up)

The workstation canvas has an HTML overlay showing the current song, elapsed/total time, proportional step regions and the step at the playhead. It appears when Spotify reports an active track and stays out of recorded/projector canvas pixels. Step markers reflect beat counts, saved song BPM, start offset and loop mode; marker rendering is capped at 512 regions on long repeated sequences.

Drag the scrub bar to preview a position; release it to send one Spotify seek request. Clicking a step checkpoint seeks to that step’s start. Keyboard changes work too. Seeking preserves Spotify’s existing play/pause state and resolves the visual step against the new position. API errors leave the confirmed playback position intact. An in-flight playback poll from before the seek cannot overwrite the acknowledged seek.

The overlay offers Enable scrubbing for older read-only sessions; it starts Spotify reauthorization for `user-modify-playback-state`. Spotify requires Premium for its seek endpoint. Source: [Spotify Seek To Position](https://developer.spotify.com/documentation/web-api/reference/seek-to-position-in-currently-playing-track).

Follow song resumes the visual sequence at Spotify’s existing playback position after Stop or manual Autopilot takeover. It does not restart or seek the song.

## Hide and resize controls (implemented follow-up)

- Hide scrub bar is available on the overlay and in the transport. A small Show scrub bar control remains over the canvas when hidden, including in full screen. Visibility is remembered in this browser independently of song sequences.
- Step regions show their beat duration, with full names/counts in tooltips and accessible labels. The active step’s beat count also appears below the bar so narrow regions remain readable.
- Drag a step’s right edge to resize it. The preview snaps to whole beats from 1 to 1024, displays the candidate count, and shifts later regions. Release saves that count to the song and updates the vertical editor. Other steps retain their durations.
- Escape, a cancelled pointer gesture, hiding the bar, or a song switch cancels an unfinished resize. Dragging a boundary never sends a Spotify seek request.
- End handles work without Spotify seek permission. Arrow keys adjust the focused end by one beat, Shift+arrow by four, Home sets one beat, and End sets 1024.
- In Loop mode, every displayed occurrence edits the same underlying step; the preview recalculates repeated positions consistently.
