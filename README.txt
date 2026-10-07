PHOSPHOR LOOP
A video feedback synthesizer that runs in your web browser.

WHAT'S IN THIS FOLDER
  index.html   The workstation. Open this on your computer.
  phone.html   The page your phone opens when you scan the QR code.
  qrcode.js    Draws the QR code (MIT license, Kazuhiko Arase).
  sw.js        Keeps a copy in the browser so it opens without internet.
  nature/      About 500 nature photos for the Picture input, with their credits
               (CREDITS.txt) and the list the app reads (pictures.json).
  icon-180.png, icon-192.png   Icons for phone and tablet home screens.
  android/     The Android app (GitHub builds it by itself; see ANDROID APP below).

ANDROID APP
  Install it (Android 10 or newer):
  1. On the phone, open this address in Chrome:
       https://github.com/nhillson/phosphor-loop/releases/latest/download/PhosphorLoop.apk
     It downloads straight away (about 1 MB).
  2. Tap Open on the download message (or open Downloads and tap
     PhosphorLoop.apk).
  3. If Android says your browser isn't allowed to install apps, tap
     Settings, switch on "Allow from this source", then tap back.
  4. Tap Install. If Google Play Protect pops up, choose the option that
     installs anyway ("Install without scanning", or "More details" >
     "Install anyway"). It asks only because the app isn't from the Play Store.
  5. Open Phosphor Loop from your apps. The first time, Android explains how
     to leave full screen; tap Got it. Allow the camera and microphone when
     you pick Camera or Microphone.

  What's different in the app:
  - It opens full screen and keeps the screen awake.
  - Phone sound (under React to sound) hears Spotify, YouTube or any app on
    the phone. Android asks to "record or cast"; tap Start. Only the sound
    is used. A few apps keep their sound private; use Microphone for those.
  - Plug the phone into a projector or TV (a USB-C to HDMI adapter, or cast
    the screen) and the picture moves there by itself while the controls
    stay on the phone. Keep Phosphor Loop open on the phone during the show.
  - Snapshots and recordings go to the phone's Gallery, in a Phosphor Loop
    album.
  - Screen sharing and MIDI controllers need a computer.
  - Updates to the website reach the app by themselves whenever the phone
    is online. The app is also rebuilt after every update, so its built-in
    offline copy always matches the site. Installing a new copy is optional;
    install it over the old one the same way (presets stay).

  How it's built: each time the site or the android folder changes, GitHub
  builds the app (Actions tab, "Android app") and puts it on the Releases page.
  To build it again by hand: Actions > Android app > Run workflow.

YOU CAN JUST DOUBLE-CLICK index.html
Everything works that way except the phone link: both loops,
cross-feed, drawing, pictures, video files, your webcam and screen sharing.
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
     Press "Save all nature pictures" there too, so every photo works offline.
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

ADMIN: SHARED PRESETS FOR EVERYONE
  Shared presets show up for everyone who opens the site. Only someone with
  a GitHub key that can change this site's files can add them.
  One-time setup, on your computer:
  1. Signed in to GitHub, open github.com/settings/personal-access-tokens/new
  2. Token name: Phosphor Loop presets. Expiration: the longest choice.
  3. Repository access: Only select repositories, then pick phosphor-loop.
  4. Permissions: find Contents and set it to Read and write.
  5. Press Generate token, then Copy.
  6. Open nhillson.github.io/phosphor-loop/#admin, paste the key into
     Admin key under Shared presets, and press Unlock.
  From then on, in that browser: set up a look, press "Share current look
  with everyone" under Shared presets and name it. Everyone gets it about a
  minute later. On a shared preset, the pencil renames it and x takes it
  away. The key stays in that browser only; "Stop being the admin on this
  device" forgets it. If the key runs out, make a new one the same way.

TIPS
  - My presets: set up a look, press "Save current look" and name it. Presets
    stay in this browser on this device (another browser or computer won't
    see them). Save under the same name to update one.
  - Save a preset while Autopilot is running and it keeps Autopilot's
    settings and pins too. Loading it starts Autopilot again from that look.
    Those presets are marked AUTO.
  - Shared presets: looks the admin picks out for everyone, at the top of
    the presets. To add your own as the admin, see ADMIN below.
  - Crowded controls? Click any section heading to fold it away, or use
    "Collapse all" at the top of the controls.
  - Press the Guide button (top right) or G for a tour of every control and
    a set of one-click recipes.
  - Share this tab (Screen input) or aim the phone at the monitor for
    classic "camera pointed at the TV" feedback.
  - Loop B: slide "What you see" to Both, then raise "Feed A into B" and/or
    "Feed B into A". Or pick "Loop A's picture" as loop B's input to feed it
    in directly.
  - The Feed sliders pour one loop into the other loop's trails, so the loop
    being fed has to be on screen and have some Trails. Raising a feed brings
    that loop on screen by itself, and if its Trails are at 0 a note under the
    sliders offers a one-click fix.
  - Melt (in "Shape loop", under Flow) makes the picture push itself around:
    how bright each spot is decides which way it slides, so the echoes fold
    into each other like marbling. Low is a gentle drip, high is wild.
    Keep Trails high. The Guide's "Marbled" recipe sets it up in one click.
  - Pushed by B and Dyed by B (right under Melt; they say "by A" when you're
    shaping loop B) let the other loop's picture reshape this one without
    ever showing it. Pushed by: the other loop's bright parts and outlines
    sweep this loop's trails into currents and swirls, like Melt driven by
    the other loop. Dyed by: wherever the other loop is bright, this loop's
    colors get stained and keep turning, so its shapes show up as shifting
    rainbow bands. Both keep the other loop running even when it's hidden.
    The Guide's "Currents" and "Rainbow ghost" recipes show them off.
  - "Loop A feeds on itself" (the section under Shape loop) has seven
    effects where the picture decides what happens to it next:
      Look-up       each spot copies from a spot its own color points to
      Chase         Zoom and Spin turn around the brightest part, so the
                    tunnel wanders off after the light (needs Zoom or Spin)
      Breathe       brighter pulls back, darker pushes in, movement spins
                    faster: the loop finds its own rhythm
      Color chase   red is pushed by green, green by blue, blue by red
      Restless      only what's changing stays; still parts fade
      Fractal fold  each frame is folded through the Mandelbrot formula
      Crystal       the picture cracks into pieces that turn on their own
    Autopilot and Surprise me use them now and then, and the Fader limits
    menu lists them. Guide recipes: "Fractal garden", "Shattered mirror"
    and "Prism".
  - Text: press Text under "What feeds the loop" and type your own words in
    the Your text box (a band name, a title, the venue). They change as you
    type. Bold, Outline, Classic and Typewriter change the lettering, and long
    text wraps onto more lines by itself. Presets keep the words. The Guide's
    "Name in lights" recipe flies them down a tunnel.
  - Grow (in "Shape loop", under Dyed by) makes the picture grow patterns out
    of itself, like coral, zebra stripes or fingerprints. They start at
    outlines and spread through anything lit. Fine, Medium and Big set how far
    apart the stripes sit. Keep Trails high. Try the Guide's "Living picture"
    recipe.
  - Time warp (in "Shape loop", at the bottom) shows each part of the picture
    from a different moment: one edge (or the middle) is now, the other up to
    about a second and a half ago. Anything moving stretches into ribbons and
    waves. Top to bottom, Side to side and From the middle pick which way time
    runs. Try the Guide's "Rubber time" recipe with a camera and wave your
    arms.
  - Autopilot (in the row of buttons under the picture, next to Surprise me,
    or the P key) changes the settings slowly by itself. Every 1 to 3 new
    looks (at random) it also puts in a different nature picture, from the
    kind chosen in the gallery. A picture of your own stays put, and
    switching off Picture under "Inputs Autopilot can use" stops it too.
  - Autopilot never lets the picture turn white. It keeps an eye on the
    screen, and if too much of it gets close to white it turns its own
    Trails, feeds and Grow down a notch on the loop that's doing it, shows
    one loop instead of two, or moves on to the next look. Nothing is dimmed,
    and pinned settings and fader limits are always respected. When you
    steer by hand (Autopilot off) it leaves the picture alone.
  - Check each look (under Autopilot settings, on unless switched off):
    Autopilot tries each new look out of sight on the hidden loop first and
    looks at it for a few seconds. One that's turning white, nearly black,
    plain or frozen is thrown away and another tried, up to six in all,
    and it keeps the richest. Switch it off to see every look it makes.
    Watching the picture uses tiny copies that never make it stutter.
    Under it, a tally shows how many looks have been judged since the page
    opened, how many passed (and on the first try), and why the rest didn't.
  - More like this and Not this (in the small strip right under the picture,
    or the Y and X keys; they can go on MIDI pads too) teach Autopilot your
    taste. Beside them, a countdown shows the seconds this look has left.
    In full screen during a taste session, a small timer and the two buttons
    appear at the bottom middle when the mouse moves (or the picture is
    tapped), and fade away after a few still seconds; "Keep timer and rating
    buttons showing in full screen" (under Taste profiles) keeps them showing.
    The button you pressed glows for as long as that look is on screen.
    A rating is for the whole picture on screen, never one loop alone: both
    loops' looks, how they're shown and fed into each other (one pushing,
    dyeing or being the input of the other; zooming and turning alike or
    apart; which inputs and effects meet) and how the screen looks (how
    busy, how many shades, how much detail, movement and color). Autopilot
    picks each new look, and how to mix it with the other loop, by the
    picture they'd make together. While Autopilot runs, Not this also skips
    to the next look. Ratings stay in this browser (the newest 400 per
    taste profile).
  - Taste profiles (the section under Autopilot settings): ratings are kept
    in named profiles and Autopilot follows the lit one. Tap the lit one
    again to follow no taste at all. "Start taste session" makes a new
    profile from scratch: rate Autopilot's looks, then press "Finish and
    name it" in the green bar under the picture (rating with no profile lit
    starts a session too). On your own profiles: ✎ rename, ⤓ save as a file
    to send to someone, × delete. "Open a taste file…" (or dropping the file
    on the page) adds a profile someone sent. Rating while a SHARED profile
    is lit makes your own copy of it. Saved presets don't count as likes.
  - Train again: with one of your profiles lit, "Train … again" starts
    another session for it. Autopilot follows the profile as it would live,
    you rate what it brings, and "Finish and add them" adds the new ratings.
    Made for one profile per song, trained as often as you like.
  - What taste learns: every setting of both loops (inputs, effects and how
    strong, mirror, zoom, spin, trails, color, warp, Input size, Blend,
    softness, Wave/Shape patterns, Grow size, Time warp direction, Only
    movement, edges, drift, brightness, Spectrograph style), which nature
    picture shows (and its kind), and how the screen looks. With a taste to
    follow, Autopilot picks nature pictures you've liked, and a picture it
    brings back comes with its nature picture.
  - Not just loops and settings but which go together.
    Each loop's settings tied to its input ("Shape with Melt, zoomed in"),
    effects that come together, whole looks, and whole pairs of looks with
    how they're shown and fed into each other. At "Stick to what I like",
    Autopilot mostly brings back pictures you rated up, barely changed, so
    you know roughly what will be on screen (How wild sets how much).
  - Follow my taste (under Taste profiles) goes from "Surprise me"
    (ignores your taste) to "Stick to what I like". Autopilot then makes
    several looks and keeps one you'd probably like, starts some looks from
    one you liked (varied a little), and Check each look leans towards
    tries that look like your favourites. It also learns whether you like
    both loops showing at once. Learn from hints counts a skip in a new
    look's first few seconds a little against it, and a pinned setting for
    that setting.
  - Admin: ⇪ on one of your own taste profiles shares it with everyone
    (kept in presets.json; the same name replaces it). On a shared one, ✎
    renames it and × takes it away.
  - Next look (beside Autopilot under the picture, under Autopilot
    settings, or the L key): skips straight to Autopilot's next new look,
    cutting in quickly, and starts Autopilot if it's off. The wait for the
    look after that starts over. It can be learned onto a MIDI button too.
  - Pins: while Autopilot runs, a small pin shows beside each setting. Tap
    it (or just move that slider, with "Pin it, keep going" chosen) and the
    setting stays put on the loop you're changing (the A or B tab) while
    Autopilot keeps changing everything else. Tap a lit pin to let it go
    again.
  - When you move a control while it runs (under Autopilot settings): "Pin
    it, keep going" pins what you move; "Play along" lets you play with the
    sliders without pinning anything or stopping Autopilot (it changes them
    again with its next look); "Stop Autopilot" hands everything to you.
  - Pin on both loops: right-click a pin (or press and hold it on a
    touchscreen) and the setting stays put on both loops, the same on each.
    The pin then says AB. Right-click it again to let it go on both.
  - Autopilot settings (the section under Looks): how often a new look
    comes, how slowly it fades in, how wild it gets, and how often it mixes
    the two loops.
  - How wild also sets how much each new look changes, for every slider and
    input alike. At Calm only a few change (about 1 in 5 inputs and main
    sliders, effects rarely on). In the middle about 3 in 4 get something
    new: the input usually switches, and every effect (Flow, Melt, Push,
    Dye, Split, Grow, Time warp, the seven feeds-on-itself effects and a
    second input) is on in about half the looks, on its own roll. At Wild
    nearly everything changes and most effects are on at once. "Change on the beat" makes each new look cut in on a beat
    when music is playing. Under "Inputs Autopilot can use", switch off any
    input (Camera, 3D worlds, Fractals, Ink, Text and so on) you don't want it to bring in.
  - Fader limits (the button under Autopilot settings): one slider with two
    handles for every slider Autopilot moves, both loops at once. Drag the
    left handle to the lowest and the right handle to the highest you want
    (Trails between 40 and 90, say). Autopilot only picks values between
    them. It never moves the handles and doesn't sit on them. Sliders you
    move yourself and pinned ones aren't limited. Double-click a slider in
    the menu to open it back up. Presets saved with Autopilot keep them.
  - Music visualizer: under "React to sound" choose Computer sound. In the
    box Chrome opens, pick any screen on the Entire Screen tab (with two
    monitors, Screen 1 or Screen 2 both give the whole computer's sound),
    switch on "Also share system audio" and press Share, then play Spotify
    or anything else. Microphone listens to the room instead.
  - Video sound (next to Record): picks the sound in videos you record.
    Click it to step through Off, Mic, Computer and Both (mic and computer
    mixed together). If React to sound already hears that sound, the video
    keeps it with nothing more to allow. If not, Record asks first: for Mic,
    choose Allow; for Computer, Chrome's sharing box opens (pick a screen on
    the Entire Screen tab, switch on "Also share system audio", press Share).
    In the phone app it says Phone: choose Phone sound under React to sound.
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
  - Ink in water: Ink under "What feeds the loop" drops colored ink that
    curls into threads. The Flow slider adds those swirling currents to any
    look.
  - 3D worlds: 3D world under "What feeds the loop" takes you into one of nine.
      Cubes: through floating cubes towards a glowing light.
      Horizon: low over a wet valley floor towards a striped sunset, with
        glowing grid mountains on both sides.
      Cavern: down a winding cave with coral-like walls and glowing veins.
      Black hole: circling a black hole whose pull bends the light, so its
        glowing disk shows over the top and underneath.
      Aurora: gliding over a frozen lake under the northern lights.
      Mercury: circling drops of liquid metal that merge and split.
      Fractal: down a hall where bubbles grow on bubbles without end.
      Nebula: through glowing clouds of gas and dark dust.
      City: drifting sideways along a wet street at night, past shops,
        lamps and cars, with rows of buildings and a skyline behind.
    "3D world" under "What feeds the loop" adds any of them to any look;
    pick which one in the row of buttons that opens underneath. Input size
    widens or narrows the view. With React to sound on, the flight surges
    forward on the kick and the lights flare on the beat. For warp-speed
    streaks, raise Trails to about 60 and Zoom to about 30.
  - Fractals: Fractals under "What feeds the loop" flies a camera through
    one of six 3D fractals. Pick which in the row of buttons underneath.
      Menger sponge: a cube with a cross-shaped hole through it, and the
        same hole through every smaller cube, without end.
      Mandelbulb: the Mandelbrot set worked out in 3D, buds on buds.
      Mandelbox: a block folded over and over into arches, ribs and pits.
      Sierpinski: a golden pyramid made of smaller and smaller pyramids.
      Julia: a slice of a 4D Julia set, swirling rainbow tubes.
      Kaleidoscope: a shape mirrored over and over into faceted crystal.
    There's no set path: the camera wanders on its own, turning and rolling,
    sweeping round the outside, diving deep into the detail (it never runs
    out) and climbing back out again, about once a minute. Loop A and loop B
    each take their own route. It never touches the surface.
  - Spectrograph: a picture of the sound itself. Under "What feeds the
    loop" press Spectrograph, then Computer sound or Microphone right
    underneath. Low sounds sit at the bottom, high ones at the top, and the
    louder, the brighter. Scrolling slides left like a heart monitor; Round
    ripples out from the middle (try the Sound tunnel recipe in the Guide).
    It sets its own brightness, and its loud parts lie over the trails
    instead of adding to them, so it never washes out to white. Set Amount
    under React to sound to 0 to see it without the picture pumping.
  - Nature pictures: press Picture under "What feeds the loop", then
    "Nature pictures..." for a gallery of about 500 photos (sea life, birds,
    bugs, frogs, flowers, mushrooms and more). Tap one to feed it in. The
    arrow buttons and Shuffle flip through the kind chosen in the gallery
    without opening it, and work from a MIDI controller too (Learn). Each
    photo's credit shows under its name. "Your own picture..." still loads
    a file of yours.
  - Split lines (under Mirror): every other line of the picture slides left
    and the lines between slide right, like a scrambled TV.
  - Camera: a phone's back camera shows the world the right way round; a
    front camera or computer webcam works like a mirror. With more than one
    camera, a list under Camera picks which one.
  - Leaving full screen: move the mouse or tap the picture and an "Exit full
    screen" button shows at the top right (it fades again when you stop).
    Esc works too. The output window has the same button.
  - Keys: Space freeze, N neutral, R surprise,
    P autopilot, L next look, C clear, F full screen, V record (press
    again to stop and save; works in full screen too), G guide.
  - Naming: before a picture or video saves, a box on the picture shows its
    usual name. Type a new one, or press Enter to keep it. "Don't save"
    throws it away, but only after a second click.
