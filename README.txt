PHOSPHOR LOOP
A video feedback synthesizer that runs in your web browser.

WHAT'S IN THIS FOLDER
  index.html   The workstation. Open this on your computer.
  phone.html   The page your phone opens when you scan the QR code.
  qrcode.js    Draws the QR code (MIT license, Kazuhiko Arase).

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
     Drag in index.html, phone.html and qrcode.js (README.txt is optional),
     then click "Commit changes".
  4. Click "Settings" (top of the repository), then "Pages" in the left list.
     Under "Build and deployment", set Source to "Deploy from a branch",
     Branch to "main" and the folder to "/ (root)". Click "Save".
  5. Wait a minute or two and refresh. The page shows your address:
       https://YOUR-GITHUB-NAME.github.io/phosphor-loop/
     Bookmark it. That's Phosphor Loop, and anyone can open it there.

USING YOUR PHONE AS AN INPUT
  1. On the computer, open your https:// address in Chrome or Edge.
  2. Under "What feeds loop A", click Phone. A QR code appears.
  3. Point your phone's camera app at the QR code and open the link.
  4. Tap "Start camera" and allow the camera. The phone's picture appears
     on the computer within a few seconds.
Both devices need internet. The free PeerJS service introduces them to each
other, then the video goes phone-to-computer directly (or through PeerJS's
relay if your network blocks direct links). Nothing is recorded.

TIPS
  - Share this tab (Screen input) or aim the phone at the monitor for
    classic "camera pointed at the TV" feedback.
  - Loop B and Cross-feed: slide "What you see" to Both, then raise
    Cross-feed. Channels 9 (Twins) and 0 (Weave) show it off.
  - Keys: 1-9 and 0 channels, Space freeze, R surprise, C clear, F full screen.
