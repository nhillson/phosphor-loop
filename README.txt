PHOSPHOR LOOP
A video feedback synthesizer that runs in your web browser.

WHAT'S IN THIS FOLDER
  index.html   The workstation. Open this on your computer.
  phone.html   The page your phone opens when you scan the QR code.
  qrcode.js    Draws the QR code (MIT license, Kazuhiko Arase).
  sw.js        Keeps a copy in the browser so it opens without internet.
  icon-180.png, icon-192.png   Icons for phone and tablet home screens.

YOU CAN JUST DOUBLE-CLICK index.html
Everything works that way except the phone link: channels, both loops,
cross-feed, painting, pictures, video files, your webcam and screen sharing.
Use Chrome or Edge.

TO CONNECT YOUR PHONE, PUT THE FOLDER ONLINE (free, one time, about 5 minutes)
Phones only allow a web page to use the camera when that page comes from a
secure web address (https://), so the folder needs to live on the web.
GitHub Pages hosts it for free:

  1. Go to https://github.com and sign up or sign in.
  2. Click the + at the top right, then "New repository".
     Name it phosphor-loop, leave it Public, and click "Create repository".
  3. On the next page, click the "uploading an existing file" link.
     Drag in every file from this folder,
     then click "Commit changes".
  4. Click "Settings" (top of the repository), then "Pages" in the left list.
     Under "Build and deployment", set Source to "Deploy from a branch",
     Branch to "main" and the folder to "/ (root)". Click "Save".
  5. Wait a minute or two and refresh. The page shows your address:
       https://YOUR-GITHUB-NAME.github.io/phosphor-loop/
     Bookmark it. That's Phosphor Loop, and anyone can open it there.

UPDATING YOUR SITE WITH A NEW VERSION
  1. Unzip the new version somewhere you can find it.
  2. Open your repository on github.com (github.com/YOUR-GITHUB-NAME/phosphor-loop).
  3. Click "Add file" (near the green "Code" button), then "Upload files".
  4. Drag in the new files. Files with the same names replace the old ones.
     Click "Commit changes".
  5. Click the "Actions" tab. A run called "pages build and deployment"
     appears. When it shows a green check (usually under a minute), the site
     is updated.
  6. Open your web address and press Ctrl+F5 (Ctrl+Shift+R also works) to
     skip the browser's saved copy. On the phone, close the tab and scan the
     code again. GitHub can keep serving the old copy for up to 10 minutes.

USING YOUR PHONE AS AN INPUT
  1. On the computer, open your https:// address in Chrome or Edge.
  2. Under "What feeds loop A", click Phone. A QR code appears.
  3. Point your phone's camera app at the QR code and open the link.
  4. Tap "Start camera" and allow the camera. The phone's picture appears
     on the computer within a few seconds.
Both devices need internet. The free PeerJS service introduces them to each
other, then the video goes phone-to-computer directly (or through PeerJS's
relay if your network blocks direct links). Nothing is recorded.

SHOW MODE (a computer that plays at gigs)
  1. Open your https:// address in Chrome once with internet. After a few
     seconds, Show setup says it's saved on this computer; from then on it
     opens without internet too (only the phone link still needs it).
  2. Click the icon left of the address, open Site settings, and set Camera,
     Microphone, MIDI devices, Pop-ups and redirects, and Window management
     to Allow, so nothing asks permission in the middle of a set.
  3. Under Show setup, switch on Show mode (or add ?show=1 to the address).
     Each time Phosphor Loop starts it then picks up the last look and
     Autopilot, reconnects the camera and microphone, keeps the screen awake,
     and opens the output window when a second screen is plugged in. Tap
     "Fill my other screen" in that window to put the picture on the projector.
  4. To start it with Windows, press Win+R, type shell:startup, and make a
     shortcut there with this target (one line, with your address):
       "C:\Program Files\Google\Chrome\Application\chrome.exe" --start-fullscreen https://YOUR-GITHUB-NAME.github.io/phosphor-loop/?show=1

MIDI CONTROLLER
  Under Show setup press "Use a MIDI controller" and allow it. Press Learn,
  touch a slider or button, then move a fader, turn a knob or press a button
  on the controller. Repeat for each control and press Learn again to finish.
  Mappings stay in this browser. A fader only takes over once it reaches the
  slider's current position, so loading a look never makes the picture jump.
  Endless knobs are recognized and work straight away.

TIPS
  - My presets: set up a look, press "Save current look" and name it. Presets
    stay in this browser on this device (another browser or computer won't
    see them). Save under the same name to update one.
  - Crowded controls? Click any section heading to fold it away, or use
    "Collapse all" at the top of the controls.
  - Press the Guide button (top right) or G for a tour of every control and
    eight one-click recipes.
  - Share this tab (Screen input) or aim the phone at the monitor for
    classic "camera pointed at the TV" feedback.
  - Loop B: slide "What you see" to Both, then raise "Feed A into B" and/or
    "Feed B into A". Or pick "Loop A's picture" as loop B's input to feed it
    in directly. Channels 9 (Twins) and 0 (Weave) show it off.
  - Autopilot (next to Surprise me, or the P key) changes the settings slowly
    by itself. Touch any control to take over again.
  - Music visualizer: under "React to sound" choose Computer sound. In the
    box Chrome opens, pick any screen on the Entire Screen tab (with two
    monitors, Screen 1 or Screen 2 both give the whole computer's sound),
    switch on "Also share system audio" and press Share, then play Spotify
    or anything else. Microphone listens to the room instead. Record keeps
    the sound in the video.
  - Computer sound works in Chrome and Edge. Firefox and Safari don't pass
    sound through screen sharing, so use Microphone there.
  - No screen sharing on Windows: choose Microphone and pick Stereo Mix
    under "Listen to". If it isn't listed, turn it on once: Settings >
    System > Sound > More sound settings > Recording tab > right-click >
    Show Disabled Devices > right-click Stereo Mix > Enable. Then reload.
  - Projector or second screen: press "Output window", drag the new window
    onto that screen and double-click it to fill it. The controls stay on
    your laptop. If nothing opens, allow pop-ups for the page.
  - Neutral (next to Surprise me, or the N key) shows just loop A's input
    with every effect off. Raise Trails first, then Zoom and Spin.
  - Keys: 1-9 and 0 channels, Space freeze, N neutral, R surprise,
    P autopilot, C clear, F full screen, H hide controls, G guide.
