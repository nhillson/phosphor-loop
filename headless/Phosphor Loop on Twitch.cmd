<# : Phosphor Loop on Twitch or Kick. Double-click this file to install it (a desktop icon), then use the icon.
@echo off
set "PL_SELF=%~f0"
powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command "& ([ScriptBlock]::Create([IO.File]::ReadAllText($env:PL_SELF))) -Install"
exit /b
#>
# ---------------------------------------------------------------------------------------------------------------
# PHOSPHOR LOOP ON TWITCH OR KICK, the hidden streamer for Windows
#
# Double-click the "Phosphor Loop on Twitch" icon on the desktop to go live; double-click it again to stop.
# Nothing opens on screen: Phosphor Loop runs in a hidden browser on the graphics chip, records itself with the
# computer's sound, and ffmpeg sends that to Twitch or Kick. A tray icon by the clock says it's live (right-click it for
# Stop, Settings and the Go live page).
#
# The first time it asks where you stream (Twitch or Kick) and for the stream key (kept encrypted for this Windows
# user; Kick also needs its Stream URL), then
# downloads Phosphor Loop (the twitch-stream branch) and ffmpeg into %LOCALAPPDATA%\PhosphorLoopStream.
# Each start checks GitHub for a newer Phosphor Loop and fetches it.
#
# This file is three things: the installer (as a .cmd it runs itself with -Install), the program (installed as
# PhosphorLoopStream.ps1) and, for Claude, its own test bed: on any computer it can run with -Console and test
# switches (see the param block), sending the stream to a file instead of Twitch or Kick.
# Plain ASCII only: Windows PowerShell 5.1 reads files without a byte-order mark as ANSI.
# ---------------------------------------------------------------------------------------------------------------
param(
  [switch]$Install,                 # copy this file to its home, make the desktop icon, then start
  [switch]$Console,                 # no tray icon or dialogs: report in this window (testing)
  [string]$Out = '',                # send the stream to this file instead of Twitch or Kick (testing)
  [switch]$BandwidthTest,           # Twitch only: send as a bandwidth test (viewers don't see it)
  [int]$StopAfterPieces = 0,        # stop after this many quarter-second pieces have gone out (testing)
  [string]$Browser = '',            # Chrome or Edge (found by itself)
  [string]$BrowserArgs = '',        # extra browser switches (testing)
  [switch]$Windowed,                # a browser window placed off screen instead of a hidden browser
  [string]$Ffmpeg = '',             # ffmpeg (downloaded by itself)
  [string]$Site = '',               # a folder with Phosphor Loop's files (downloaded by itself)
  [string]$Sound = '',              # system (default), mic, or none
  [string]$HomeDir = ''             # where everything is kept (testing)
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch {}

$OnWindows = [Environment]::OSVersion.Platform -eq 'Win32NT'
$Branch = 'twitch-stream'
$Repo = 'nhillson/phosphor-loop'
$FfmpegZip = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip'
$TwitchIngest = 'rtmp://ingest.global-contribute.live-video.net/app/'
if (-not $HomeDir) { $HomeDir = if ($OnWindows) { Join-Path $env:LOCALAPPDATA 'PhosphorLoopStream' } else { Join-Path $HOME '.phosphorloopstream' } }
New-Item -ItemType Directory -Force -Path $HomeDir | Out-Null
$LogFile = Join-Path $HomeDir 'log.txt'
$SettingsFile = Join-Path $HomeDir 'settings.json'
$StopFile = Join-Path $HomeDir 'stop.request'
$UseTray = $OnWindows -and -not $Console
$script:Secret = ''

function Write-Log([string]$text) {
  if ($script:Secret) { $text = $text.Replace($script:Secret, '<stream key>') }
  $line = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + '  ' + $text
  try {
    if ((Test-Path $LogFile) -and (Get-Item $LogFile).Length -gt 2MB) { Move-Item -Force $LogFile ($LogFile + '.old') }
    Add-Content -Path $LogFile -Value $line
  } catch {}
  if (-not $UseTray) { Write-Host $line }
}

if ($UseTray) {
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing
  [System.Windows.Forms.Application]::EnableVisualStyles()
}
function Show-Message([string]$text, [string]$kind = 'Information') {
  Write-Log ('message: ' + $text)
  if ($UseTray) { [void][System.Windows.Forms.MessageBox]::Show($text, 'Phosphor Loop on Twitch or Kick', 'OK', $kind) }
}

# ---------------------------------------------------------------------------------------------------------------
# Install: copy this file home as PhosphorLoopStream.ps1 and put the icon on the desktop. The icon runs PowerShell
# through "conhost --headless", the Windows console host with no window at all, so nothing flashes up.
# ---------------------------------------------------------------------------------------------------------------
function New-AppIcon([string]$path) {
  $bmp = New-Object System.Drawing.Bitmap 64, 64
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  $g.Clear([System.Drawing.Color]::Transparent)
  $g.FillEllipse((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 24, 22, 25))), 2, 2, 60, 60)
  $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(255, 139, 26, 184)), 5
  for ($i = 0; $i -lt 3; $i++) { $g.DrawEllipse($pen, 10 + 7 * $i, 10 + 7 * $i, 44 - 14 * $i, 44 - 14 * $i) }
  $g.FillEllipse((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 213, 132, 245))), 27, 27, 10, 10)
  $g.Dispose()
  $icon = [System.Drawing.Icon]::FromHandle($bmp.GetHicon())
  $fs = [System.IO.File]::Create($path)
  $icon.Save($fs)
  $fs.Close()
  return $icon
}
if ($Install) {
  if (-not $OnWindows) { Write-Host 'Installing is for Windows.'; exit 1 }
  $self = $env:PL_SELF
  if (-not $self -or -not (Test-Path $self)) { $self = $PSCommandPath }
  $target = Join-Path $HomeDir 'PhosphorLoopStream.ps1'
  # Plain ASCII, as Windows PowerShell expects
  [IO.File]::WriteAllText($target, [IO.File]::ReadAllText($self), [Text.Encoding]::ASCII)
  Add-Type -AssemblyName System.Drawing
  $ico = Join-Path $HomeDir 'icon.ico'
  [void](New-AppIcon $ico)
  $sh = New-Object -ComObject WScript.Shell
  $lnk = $sh.CreateShortcut((Join-Path ([Environment]::GetFolderPath('Desktop')) 'Phosphor Loop on Twitch.lnk'))
  $lnk.TargetPath = Join-Path $env:WINDIR 'System32\conhost.exe'
  $lnk.Arguments = '--headless powershell.exe -NoProfile -ExecutionPolicy Bypass -File "' + $target + '"'
  $lnk.IconLocation = $ico
  $lnk.Description = 'Double-click to go live on Twitch or Kick; double-click again to stop'
  $lnk.WorkingDirectory = $HomeDir
  $lnk.Save()
  Write-Log 'installed'
  Start-Process -FilePath (Join-Path $env:WINDIR 'System32\conhost.exe') -ArgumentList @('--headless', 'powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"' + $target + '"')) -WorkingDirectory $HomeDir
  exit 0
}

# ---------------------------------------------------------------------------------------------------------------
# One at a time: a second double-click asks the running one to stop
# ---------------------------------------------------------------------------------------------------------------
$created = $false
$Mutex = New-Object System.Threading.Mutex($true, 'PhosphorLoopStreamRunning', [ref]$created)
if (-not $created) {
  Set-Content -Path $StopFile -Value 'stop'
  Write-Log 'asked the running stream to stop'
  exit 0
}
Remove-Item -Force -ErrorAction SilentlyContinue $StopFile

# ---------------------------------------------------------------------------------------------------------------
# Settings: where it streams (Twitch or Kick, and Kick's Stream URL), the stream key (encrypted for this Windows
# user), the picture size, the link code that
# pairs the stream with the Go live page, and which Phosphor Loop is downloaded
# ---------------------------------------------------------------------------------------------------------------
$cfg = [ordered]@{ platform = 'twitch'; server = ''; key = ''; quality = '720'; sound = 'system'; link = ''; site = '' }
if (Test-Path $SettingsFile) {
  try { $saved = Get-Content -Raw $SettingsFile | ConvertFrom-Json; foreach ($k in @($cfg.Keys)) { if ($saved.PSObject.Properties[$k]) { $cfg[$k] = [string]$saved.$k } } } catch {}
}
# An NVIDIA graphics card encodes 1080p sharply without loading the processor, so a new setup starts at 1080p there
$script:HasNvidia = $false
if ($OnWindows) { try { $script:HasNvidia = [bool](@(Get-CimInstance Win32_VideoController -ErrorAction Stop | Where-Object { $_.Name -match 'NVIDIA' }).Count) } catch {} }
if ($script:HasNvidia -and -not (Test-Path $SettingsFile)) { $cfg.quality = '1080' }
if (-not $cfg.link) {
  $chars = 'abcdefghijkmnpqrstuvwxyz23456789'
  $cfg.link = -join (1..10 | ForEach-Object { $chars[(Get-Random -Maximum $chars.Length)] })
}
function Save-Settings { $cfg | ConvertTo-Json | Set-Content -Path $SettingsFile -Encoding ASCII }
function Get-Key {
  if (-not $cfg.key) { return '' }
  try {
    $s = ConvertTo-SecureString $cfg.key
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))
  } catch { return '' }
}
function Set-Key([string]$plain) { $cfg.key = (ConvertTo-SecureString $plain -AsPlainText -Force | ConvertFrom-SecureString) }
function Get-PlatformName { if ($cfg.platform -eq 'kick') { 'Kick' } else { 'Twitch' } }
# Kick's Stream URL as pasted: tidied, rtmps:// added if it's missing, and /app added when only the server is given.
# Empty when it isn't a stream address at all.
function Get-KickServer([string]$text) {
  $u = ([string]$text) -replace '\s', ''
  if (-not $u) { return '' }
  if ($u -notmatch '^[A-Za-z]+://') { $u = 'rtmps://' + $u }
  $u = $u.TrimEnd('/')
  if ($u -notmatch '^rtmps?://[A-Za-z0-9.-]+(:[0-9]+)?(/[^?#]*)?$') { return '' }
  if ($u -match '^rtmps?://[^/]+$') { $u += '/app' }
  return $u
}

function Show-Setup {
  $f = New-Object System.Windows.Forms.Form
  $f.Text = 'Phosphor Loop on Twitch or Kick'
  $f.StartPosition = 'CenterScreen'; $f.FormBorderStyle = 'FixedDialog'; $f.MaximizeBox = $false; $f.MinimizeBox = $false
  $f.ClientSize = New-Object System.Drawing.Size 470, 420
  $f.Font = New-Object System.Drawing.Font 'Segoe UI', 10
  $f.TopMost = $true
  # The rows top to bottom; the Kick-only ones (its Stream URL) show only when Kick is picked
  $rows = New-Object System.Collections.ArrayList
  $mk = {
    param($ctl, $h, $kickOnly, $after)
    $ctl.Left = 22; $ctl.Width = 426
    if ($h) { $ctl.Height = $h }
    $f.Controls.Add($ctl)
    [void]$rows.Add(@{ c = $ctl; kick = [bool]$kickOnly; after = [int]$after })
  }
  $t = New-Object System.Windows.Forms.Label; $t.Text = 'A few things from your streaming site, once. They stay on this computer.'; $t.Font = New-Object System.Drawing.Font 'Segoe UI', 10.5, ([System.Drawing.FontStyle]::Bold); & $mk $t 42 $false 6
  $l0 = New-Object System.Windows.Forms.Label; $l0.Text = '1. Where do you stream?'; & $mk $l0 22 $false 2
  $pf = New-Object System.Windows.Forms.ComboBox; $pf.DropDownStyle = 'DropDownList'; [void]$pf.Items.Add('Twitch'); [void]$pf.Items.Add('Kick'); & $mk $pf 0 $false 14
  $lu = New-Object System.Windows.Forms.Label; $lu.Text = '2. Your Kick Stream URL (it starts with rtmps://):'; & $mk $lu 22 $true 2
  $ub = New-Object System.Windows.Forms.TextBox; $ub.Text = $cfg.server; & $mk $ub 0 $true 14
  $l2 = New-Object System.Windows.Forms.Label; & $mk $l2 22 $false 2
  $kb = New-Object System.Windows.Forms.TextBox; $kb.UseSystemPasswordChar = $true; if ($cfg.key) { $kb.Text = Get-Key }; & $mk $kb 0 $false 4
  $ln = New-Object System.Windows.Forms.LinkLabel; & $mk $ln 40 $false 10
  $l3 = New-Object System.Windows.Forms.Label; $l3.Text = 'Picture size:'; & $mk $l3 22 $false 2
  $q = New-Object System.Windows.Forms.ComboBox; $q.DropDownStyle = 'DropDownList'
  if ($script:HasNvidia) { [void]$q.Items.Add('720p - smooth'); [void]$q.Items.Add('1080p - sharpest (recommended: this PC has an NVIDIA card)') }
  else { [void]$q.Items.Add('720p - smooth (recommended)'); [void]$q.Items.Add('1080p - sharper; needs a strong computer and fast internet') }
  $q.SelectedIndex = if ($cfg.quality -eq '1080') { 1 } else { 0 }; & $mk $q 0 $false 6
  $msgL = New-Object System.Windows.Forms.Label; $msgL.ForeColor = [System.Drawing.Color]::Firebrick; & $mk $msgL 40 $false 6
  $ok = New-Object System.Windows.Forms.Button; $ok.Text = 'Go live'; $ok.Width = 140; $ok.Height = 34; $ok.Left = 308
  $cancel = New-Object System.Windows.Forms.Button; $cancel.Text = 'Cancel'; $cancel.Width = 100; $cancel.Height = 34; $cancel.Left = 200; $cancel.DialogResult = 'Cancel'
  $f.Controls.Add($ok); $f.Controls.Add($cancel); $f.AcceptButton = $ok; $f.CancelButton = $cancel
  $layout = {
    $kick = ($pf.SelectedIndex -eq 1)
    $l2.Text = if ($kick) { '3. Your Kick stream key:' } else { '2. Your Twitch stream key (it starts with live_):' }
    $ln.Text = if ($kick) { 'Where are they? Open my Kick dashboard (Settings, then Stream Key: copy the Stream URL and the Stream Key)' }
               else { 'Where is it? Open my Twitch stream settings (then press Copy next to Primary Stream key)' }
    $yy = 16
    foreach ($row in $rows) {
      $show = (-not $row.kick) -or $kick
      $row.c.Visible = $show
      if ($show) { $row.c.Top = $yy; $yy += $row.c.Height + $row.after }
    }
    $ok.Top = $yy + 4; $cancel.Top = $yy + 4
    $f.ClientSize = New-Object System.Drawing.Size 470, ($yy + 54)
  }
  $pf.SelectedIndex = if ($cfg.platform -eq 'kick') { 1 } else { 0 }
  & $layout
  $pf.Add_SelectedIndexChanged({ $msgL.Text = ''; & $layout })
  $ln.Add_LinkClicked({ if ($pf.SelectedIndex -eq 1) { Start-Process 'https://kick.com/dashboard' } else { Start-Process 'https://dashboard.twitch.tv/settings/stream' } })
  $ok.Add_Click({
    $kick = ($pf.SelectedIndex -eq 1)
    $key = $kb.Text -replace '\s', ''
    if ($kick) {
      $server = Get-KickServer $ub.Text
      if (-not $server) { $msgL.Text = 'Paste your Kick Stream URL (it starts with rtmps://). On Kick it is under Settings, Stream Key.'; return }
      if ($key -match '^rtmps?://') { $msgL.Text = 'That is the Stream URL. Paste it in the box above, and the Stream Key in this one.'; return }
      if ($key.Length -lt 8) { $msgL.Text = 'Paste your Kick Stream Key (on the same Kick page, press Copy next to Stream Key).'; return }
      $cfg.server = $server
    } elseif (-not $key.StartsWith('live_')) {
      $msgL.Text = 'That does not look like a Twitch stream key. On Twitch, press Copy next to Primary Stream key, then paste it here (Ctrl+V).'
      return
    }
    $cfg.platform = if ($kick) { 'kick' } else { 'twitch' }
    Set-Key $key
    $cfg.quality = if ($q.SelectedIndex -eq 1) { '1080' } else { '720' }
    Save-Settings
    $f.DialogResult = 'OK'
    $f.Close()
  })
  $r = $f.ShowDialog()
  return ($r -eq 'OK')
}

# ---------------------------------------------------------------------------------------------------------------
# The relay: a tiny web server for the hidden browser (it serves Phosphor Loop's files and takes the recording in
# pieces), and ffmpeg, which turns the pieces into a Twitch or Kick stream. Written in C# so it runs on its own threads
# while the tray icon stays responsive.
# ---------------------------------------------------------------------------------------------------------------
$relaySource = @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public class PLRelay {
  public string Root = "";
  public int Port = 0;
  public string Ffmpeg = "ffmpeg";
  public string VideoArgs = "";
  public string OutputArgs = "";
  public string Secret = "";
  public string LogPath = "";
  public int Width = 1280, Height = 720;
  public volatile string StatusJson = "";
  public volatile int Pieces = 0, TotalPieces = 0, QuickFails = 0, Runs = 0;
  public volatile bool GaveUp = false, FfmpegLive = false;
  public volatile string LastError = "";
  public DateTime FfmpegStarted = DateTime.MinValue;

  readonly object ffLock = new object();
  readonly object logLock = new object();
  HttpListener listener;
  Thread thread;
  Process ff;
  int ep = -1;
  bool ended = true;
  volatile bool running;

  [DllImport("kernel32.dll")] static extern uint SetThreadExecutionState(uint flags);
  public static void KeepAwake(bool on) {
    try { SetThreadExecutionState(on ? 0x80000001u : 0x80000000u); } catch (Exception) { }
  }

  public void Start() {
    listener = new HttpListener();
    listener.Prefixes.Add("http://localhost:" + Port + "/");
    listener.Start();
    running = true;
    thread = new Thread(Loop);
    thread.IsBackground = true;
    thread.Start();
  }

  void Loop() {
    while (running) {
      HttpListenerContext ctx;
      try { ctx = listener.GetContext(); } catch (Exception) { if (!running) return; continue; }
      HttpListenerContext c = ctx;
      ThreadPool.QueueUserWorkItem(delegate(object o) { Handle(c); });
    }
  }

  void Handle(HttpListenerContext ctx) {
    try {
      HttpListenerRequest req = ctx.Request;
      HttpListenerResponse res = ctx.Response;
      string path = req.Url.AbsolutePath;
      if (req.HttpMethod == "POST" && path == "/push") { Reply(res, Push(req)); return; }
      if (req.HttpMethod == "POST" && path == "/status") {
        using (StreamReader r = new StreamReader(req.InputStream, Encoding.UTF8)) StatusJson = r.ReadToEnd();
        Reply(res, "ok");
        return;
      }
      Serve(req, res, path);
    } catch (Exception e) {
      Log("server: " + e.Message);
      try { ctx.Response.Abort(); } catch (Exception) { }
    }
  }

  static string TypeOf(string f) {
    switch (Path.GetExtension(f).ToLowerInvariant()) {
      case ".html": return "text/html; charset=utf-8";
      case ".js": return "text/javascript; charset=utf-8";
      case ".json": return "application/json";
      case ".css": return "text/css";
      case ".png": return "image/png";
      case ".jpg": case ".jpeg": return "image/jpeg";
      case ".webp": return "image/webp";
      case ".svg": return "image/svg+xml";
      case ".ico": return "image/x-icon";
      case ".txt": return "text/plain; charset=utf-8";
      default: return "application/octet-stream";
    }
  }

  void Serve(HttpListenerRequest req, HttpListenerResponse res, string path) {
    if (path == "/") path = "/index.html";
    string rel = Uri.UnescapeDataString(path).TrimStart('/').Replace('/', Path.DirectorySeparatorChar);
    string root = Path.GetFullPath(Root).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
    string full = Path.GetFullPath(Path.Combine(root, rel));
    if (!full.StartsWith(root, StringComparison.OrdinalIgnoreCase) || !File.Exists(full)) {
      res.StatusCode = 404;
      res.Close();
      return;
    }
    byte[] data = File.ReadAllBytes(full);
    res.ContentType = TypeOf(full);
    res.AddHeader("Cache-Control", "no-cache");
    res.ContentLength64 = data.Length;
    if (req.HttpMethod != "HEAD") res.OutputStream.Write(data, 0, data.Length);
    res.Close();
  }

  static void Reply(HttpListenerResponse res, string text) {
    byte[] b = Encoding.UTF8.GetBytes(text);
    res.ContentType = "text/plain";
    res.ContentLength64 = b.Length;
    res.OutputStream.Write(b, 0, b.Length);
    res.Close();
  }

  static void Drain(HttpListenerRequest req) {
    try { req.InputStream.CopyTo(Stream.Null); } catch (Exception) { }
  }

  // One quarter-second piece of the recording. "restart" asks the page to begin a fresh recording (ffmpeg needs
  // each recording from its beginning); "stop" means the stream has given up.
  string Push(HttpListenerRequest req) {
    int e;
    int.TryParse(req.QueryString["ep"], out e);
    bool first = req.QueryString["first"] == "1", audio = req.QueryString["audio"] == "1";
    lock (ffLock) {
      if (GaveUp || !running) { Drain(req); return "stop"; }
      if (ff != null && ff.HasExited) Ended();
      // A first piece always gets a fresh ffmpeg: a browser started again begins its own recording from the top
      if (e != ep || ff == null || first) {
        if (!first) { Drain(req); return "restart"; }
        if (QuickFails > 0) Thread.Sleep(Math.Min(10000, 2000 * QuickFails));
        if (!StartFfmpeg(audio)) { Drain(req); return "error"; }
        ep = e;
      }
      try {
        req.InputStream.CopyTo(ff.StandardInput.BaseStream);
        ff.StandardInput.BaseStream.Flush();
        Pieces++;
        TotalPieces++;
        if (!FfmpegLive && (DateTime.UtcNow - FfmpegStarted).TotalSeconds > 8) FfmpegLive = true;
        return "ok";
      } catch (Exception x) {
        Log("ffmpeg stopped taking the picture: " + x.Message);
        Ended();
        ep = -1;
        return "restart";
      }
    }
  }

  bool StartFfmpeg(bool audio) {
    StopFfmpeg(false);
    // (No -thread_queue_size on the input: ffmpeg 8 and newer refuse it there and stop at once)
    StringBuilder a = new StringBuilder("-y -hide_banner -loglevel warning -f matroska -i pipe:0 ");
    if (!audio) a.Append("-f lavfi -i anullsrc=channel_layout=stereo:sample_rate=48000 ");
    a.Append("-map 0:v:0 -map ").Append(audio ? "0:a:0 " : "1:a:0 ");
    a.Append("-vf scale=" + Width + ":" + Height + ":force_original_aspect_ratio=decrease:flags=lanczos,pad=" + Width + ":" + Height + ":(ow-iw)/2:(oh-ih)/2,fps=30 ");
    a.Append(VideoArgs).Append(" -c:a aac -b:a 160k -ar 48000 -ac 2 ");
    if (!audio) a.Append("-shortest ");
    a.Append(OutputArgs);
    ProcessStartInfo si = new ProcessStartInfo(Ffmpeg, a.ToString());
    si.UseShellExecute = false;
    si.RedirectStandardInput = true;
    si.RedirectStandardError = true;
    si.CreateNoWindow = true;
    try { ff = Process.Start(si); } catch (Exception x) { LastError = "ffmpeg would not start: " + x.Message; Log(LastError); return false; }
    FfmpegStarted = DateTime.UtcNow;
    Pieces = 0;
    ended = false;
    Runs++;
    Process p = ff;
    Thread t = new Thread(delegate() {
      try { string line; while ((line = p.StandardError.ReadLine()) != null) { if (line.Trim().Length > 0) { LastError = Mask(line); Log("ffmpeg: " + line); } } } catch (Exception) { }
    });
    t.IsBackground = true;
    t.Start();
    Log("ffmpeg started (" + (audio ? "with sound" : "no sound") + ")");
    return true;
  }

  // ffmpeg finished: a run that ended within 20 seconds counts as a quick failure; three in a row and it gives up
  void Ended() {
    if (ended) return;
    ended = true;
    FfmpegLive = false;
    double secs = (DateTime.UtcNow - FfmpegStarted).TotalSeconds;
    if (secs < 20) QuickFails++; else QuickFails = 0;
    Log("ffmpeg ended after " + Math.Round(secs) + " s");
    if (QuickFails >= 3) GaveUp = true;
    StopFfmpeg(false);
  }

  void StopFfmpeg(bool gently) {
    Process p = ff;
    ff = null;
    if (p == null) return;
    try { p.StandardInput.Close(); } catch (Exception) { }
    try { if (!p.WaitForExit(gently ? 6000 : 300)) p.Kill(); } catch (Exception) { }
  }

  public void Stop() {
    running = false;
    try { listener.Stop(); } catch (Exception) { }
    lock (ffLock) { StopFfmpeg(true); FfmpegLive = false; }
  }

  string Mask(string s) { return Secret.Length > 0 ? s.Replace(Secret, "<stream key>") : s; }

  public void Log(string s) {
    lock (logLock) {
      try { File.AppendAllText(LogPath, DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "  " + Mask(s) + Environment.NewLine); } catch (Exception) { }
    }
  }
}
'@
if ($PSVersionTable.PSEdition -eq 'Core') {
  Add-Type -TypeDefinition $relaySource -ReferencedAssemblies @('System.Net.HttpListener', 'System.Diagnostics.Process', 'System.Collections', 'System.Threading', 'System.Threading.Thread', 'System.Threading.ThreadPool', 'System.Net.Primitives', 'System.Collections.Specialized', 'System.Runtime.InteropServices', 'System.ComponentModel.Primitives', 'System.Private.Uri', 'System.Runtime', 'System.Linq', 'System.Console', 'System.Runtime.Extensions', 'System.IO', 'System.Text.Encoding.Extensions') -IgnoreWarnings -WarningAction SilentlyContinue
} else {
  Add-Type -TypeDefinition $relaySource
}

# ---------------------------------------------------------------------------------------------------------------
# The tray icon (Windows): the only thing that shows while it streams
# ---------------------------------------------------------------------------------------------------------------
$script:Tray = $null
$script:Port = 0
function Say([string]$text, [switch]$Problem) {
  Write-Log $text
  if ($script:Tray) {
    $script:Tray.BalloonTipTitle = 'Phosphor Loop on ' + (Get-PlatformName)
    $script:Tray.BalloonTipText = $text
    $script:Tray.BalloonTipIcon = if ($Problem) { 'Warning' } else { 'Info' }
    $script:Tray.ShowBalloonTip(6000)
  }
}
function Set-TrayText([string]$text) {
  if ($script:Tray) { if ($text.Length -gt 63) { $text = $text.Substring(0, 63) }; $script:Tray.Text = $text }
}
if ($UseTray) {
  $tray = New-Object System.Windows.Forms.NotifyIcon
  $tray.Icon = New-AppIcon (Join-Path $HomeDir 'icon.ico')
  $tray.Text = 'Phosphor Loop: getting ready'
  $menu = New-Object System.Windows.Forms.ContextMenuStrip
  $miState = $menu.Items.Add('Getting ready...'); $miState.Enabled = $false
  [void]$menu.Items.Add('-')
  $miPage = $menu.Items.Add('Open the Go live page (settings and Next look)')
  $miSettings = $menu.Items.Add('Change Twitch or Kick, stream key or picture size...')
  $miLog = $menu.Items.Add('Show the log')
  [void]$menu.Items.Add('-')
  $miStop = $menu.Items.Add('Stop streaming')
  $miPage.Add_Click({ if ($script:Port) { Start-Process ('http://localhost:' + $script:Port + '/stream.html?runner=1&link=' + $cfg.link) } })
  $miSettings.Add_Click({ if (Show-Setup) { Say 'Saved. Stopping now; double-click the desktop icon to go live with the new settings.'; Set-Content -Path $StopFile -Value 'stop' } })
  $miLog.Add_Click({ Start-Process notepad.exe $LogFile })
  $miStop.Add_Click({ Set-Content -Path $StopFile -Value 'stop' })
  $tray.ContextMenuStrip = $menu
  $tray.Visible = $true
  $script:Tray = $tray
  $script:MenuState = $miState
}

# ---------------------------------------------------------------------------------------------------------------
# Getting ready: settings, Phosphor Loop's files, ffmpeg, a browser
# ---------------------------------------------------------------------------------------------------------------
$relay = $null
$script:BrowserProc = $null
function Stop-Browser {
  $p = $script:BrowserProc
  $script:BrowserProc = $null
  if ($p -and -not $p.HasExited) {
    if ($OnWindows) { & taskkill.exe /PID $p.Id /T /F 2>&1 | Out-Null } else { try { $p.Kill($true) } catch { try { $p.Kill() } catch {} } }
  }
}
function Stop-All([string]$why) {
  Write-Log ('stopping: ' + $why)
  if ($relay) { $relay.Stop() }
  Stop-Browser
  if ($OnWindows) { [PLRelay]::KeepAwake($false) }
  Remove-Item -Force -ErrorAction SilentlyContinue $StopFile
  if ($script:Tray) { $script:Tray.Visible = $false; $script:Tray.Dispose(); $script:Tray = $null }
  try { $Mutex.ReleaseMutex() } catch {}
}

try {
  $streamKey = ''
  if (-not $Out) {
    $streamKey = Get-Key
    if (-not $streamKey -or ($cfg.platform -eq 'kick' -and -not $cfg.server)) {
      if (-not $UseTray) { throw 'No stream key saved; run it once on Windows to set it up.' }
      if (-not (Show-Setup)) { Stop-All 'setup cancelled'; exit 0 }
      $streamKey = Get-Key
    }
    $script:Secret = $streamKey
  }
  if ($Sound) { $cfg.sound = $Sound }

  # Phosphor Loop's files: the newest from the branch, unless they're already here
  if (-not $Site) {
    $Site = Join-Path $HomeDir 'site'
    $sha = ''
    try { $sha = [string](Invoke-RestMethod -Uri ('https://api.github.com/repos/' + $Repo + '/commits/' + $Branch) -Headers @{ Accept = 'application/vnd.github.sha' } -UseBasicParsing -TimeoutSec 15) } catch { Write-Log ('could not check for a newer version: ' + $_.Exception.Message) }
    $sha = $sha.Trim()
    if (-not (Test-Path (Join-Path $Site 'index.html')) -or ($sha -and $sha -ne $cfg.site)) {
      Say 'Getting the newest Phosphor Loop (this takes a minute the first time)...'
      Set-TrayText 'Phosphor Loop: downloading'
      $zip = Join-Path $HomeDir 'site.zip'
      Invoke-WebRequest -Uri ('https://codeload.github.com/' + $Repo + '/zip/refs/heads/' + $Branch) -OutFile $zip -UseBasicParsing
      $tmp = Join-Path $HomeDir 'site-new'
      Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $tmp
      Add-Type -AssemblyName System.IO.Compression.FileSystem
      $z = [IO.Compression.ZipFile]::OpenRead($zip)
      try {
        foreach ($en in $z.Entries) {
          $parts = $en.FullName -split '/', 2
          if ($parts.Count -lt 2 -or -not $parts[1] -or $parts[1].EndsWith('/')) { continue }
          if ($parts[1] -like 'android/*' -or $parts[1] -like 'tests/*' -or $parts[1] -like '.github/*') { continue }
          $dest = Join-Path $tmp ($parts[1] -replace '/', [IO.Path]::DirectorySeparatorChar)
          New-Item -ItemType Directory -Force -Path (Split-Path $dest) | Out-Null
          [IO.Compression.ZipFileExtensions]::ExtractToFile($en, $dest, $true)
        }
      } finally { $z.Dispose() }
      Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $Site
      Move-Item $tmp $Site
      Remove-Item -Force -ErrorAction SilentlyContinue $zip
      $cfg.site = $sha
      Save-Settings
      # A newer copy of this program came with it: use it from the next start
      $newSelf = Join-Path $Site 'headless\Phosphor Loop on Twitch.cmd'
      $mine = Join-Path $HomeDir 'PhosphorLoopStream.ps1'
      if ($OnWindows -and (Test-Path $newSelf) -and (Test-Path $mine)) {
        $a = [IO.File]::ReadAllText($newSelf); $b = [IO.File]::ReadAllText($mine)
        if ($a -ne $b) { [IO.File]::WriteAllText($mine, $a, [Text.Encoding]::ASCII); Write-Log 'updated the program for next time' }
      }
      Write-Log ('Phosphor Loop files: ' + $sha)
    }
  }

  # ffmpeg
  if (-not $Ffmpeg) {
    $Ffmpeg = Join-Path $HomeDir 'ffmpeg.exe'
    if (-not (Test-Path $Ffmpeg)) {
      Say ('Getting ffmpeg, the part that sends video to ' + (Get-PlatformName) + ' (first time only, a few minutes)...')
      Set-TrayText 'Phosphor Loop: downloading ffmpeg'
      $zip = Join-Path $HomeDir 'ffmpeg.zip'
      Invoke-WebRequest -Uri $FfmpegZip -OutFile $zip -UseBasicParsing
      Add-Type -AssemblyName System.IO.Compression.FileSystem
      $z = [IO.Compression.ZipFile]::OpenRead($zip)
      try {
        $en = $z.Entries | Where-Object { $_.FullName -like '*/bin/ffmpeg.exe' } | Select-Object -First 1
        [IO.Compression.ZipFileExtensions]::ExtractToFile($en, $Ffmpeg, $true)
      } finally { $z.Dispose() }
      Remove-Item -Force -ErrorAction SilentlyContinue $zip
    }
  }

  # The video encoder, best first: the NVIDIA card's encoder (NVENC: the sharpest, and it spares the processor),
  # Intel's QuickSync chip, then x264 on the processor. Each is tried on a short test picture with the exact settings
  # it would stream with, so one this computer can't run is skipped.
  $h = if ($cfg.quality -eq '1080') { 1080 } else { 720 }
  $w = [int]($h * 16 / 9)
  # 1080p on Twitch gets 8000 kbps: above Twitch's long-standing 6000 suggestion, sharper on busy pictures, and
  # still under the 8500 kbps that Twitch takes in. Kick takes at most 8000 kbps with the sound, so 7500 there.
  $rate = if ($h -eq 1080) { if ($cfg.platform -eq 'kick') { '7500k' } else { '8000k' } } else { '4500k' }
  $buf = if ($h -eq 1080) { if ($cfg.platform -eq 'kick') { '15000k' } else { '16000k' } } else { '9000k' }
  # NVENC at its slowest, sharpest preset: two passes over each frame, a look-ahead of 20 frames, and adaptive
  # quantisation in space and time (more of the bits go where the eye notices). Constant bitrate with a one-second
  # buffer and a keyframe every 2 s, as Twitch and Kick want.
  $nvBest = "-c:v h264_nvenc -preset p7 -tune hq -rc cbr -multipass fullres -b:v $rate -maxrate $rate -bufsize $rate -g 60 -no-scenecut 1 -bf 2 -rc-lookahead 20 -spatial-aq 1 -aq-strength 8 -temporal-aq 1 -profile:v high -pix_fmt yuv420p"
  # The same card with plainer settings, for older NVIDIA cards that can't do all of the above
  $nvPlain = "-c:v h264_nvenc -preset p5 -tune hq -rc cbr -b:v $rate -maxrate $rate -bufsize $rate -g 60 -bf 0 -profile:v high -pix_fmt yuv420p"
  $qsvArgs = "-c:v h264_qsv -preset veryfast -b:v $rate -maxrate $rate -bufsize $buf -g 60 -bf 0 -pix_fmt nv12"
  $x264Args = "-c:v libx264 -preset veryfast -b:v $rate -maxrate $rate -bufsize $buf -g 60 -keyint_min 60 -sc_threshold 0 -pix_fmt yuv420p -profile:v high"
  $probeFile = Join-Path $HomeDir 'probe.txt'
  function Test-Encoder([string]$encArgs) {
    try {
      $pa = '-hide_banner -loglevel error -f lavfi -i testsrc2=s=' + $w + 'x' + $h + ':r=30:d=2 ' + $encArgs + ' -f null -'
      $p = Start-Process -FilePath $Ffmpeg -ArgumentList $pa -NoNewWindow -Wait -PassThru -RedirectStandardError $probeFile
      return ($p.ExitCode -eq 0)
    } catch { return $false }
  }
  $enc = 'x264'
  $videoArgs = $x264Args
  foreach ($c in @(@('NVIDIA', $nvBest), @('NVIDIA', $nvPlain), @('QuickSync', $qsvArgs))) {
    if (Test-Encoder $c[1]) { $enc = $c[0]; $videoArgs = $c[1]; break }
    $why = ''
    try { $why = ([string](Get-Content -Raw $probeFile) -replace '\s+', ' ').Trim() } catch {}
    if ($why.Length -gt 200) { $why = $why.Substring(0, 200) }
    Write-Log ('encoder not usable here: ' + ($c[1] -split ' ')[1] + ' ' + ($c[1] -split ' ')[3] + ': ' + $why)
  }
  $script:EncShort = switch ($enc) { 'NVIDIA' { 'NVIDIA' } 'QuickSync' { 'Intel' } default { 'CPU' } }
  $script:EncLong = switch ($enc) { 'NVIDIA' { 'the NVIDIA card' } 'QuickSync' { 'the Intel graphics chip' } default { 'the processor' } }
  $script:SizeText = [string]$h + 'p'
  Write-Log ("encoder: $enc, ${w}x$h at $rate (" + $videoArgs + ')')

  # Where it goes: Twitch, Kick (its own Stream URL, over rtmps), or a file for a test
  if ($Out) { $outputArgs = '-f flv "' + $Out + '"' }
  else {
    if ($cfg.platform -eq 'kick') { $url = $cfg.server + '/' + $streamKey }
    else {
      $url = $TwitchIngest + $streamKey
      if ($BandwidthTest) { $url += '?bandwidthtest=true' }
    }
    Write-Log ('streaming to ' + (Get-PlatformName) + ' at ' + $url.Replace($streamKey, '<stream key>'))
    $outputArgs = '-f flv -flvflags no_duration_filesize "' + $url + '"'
  }

  # The web server, on the first free port from 47810
  $relay = New-Object PLRelay
  $relay.Root = $Site; $relay.Ffmpeg = $Ffmpeg; $relay.VideoArgs = $videoArgs; $relay.OutputArgs = $outputArgs
  $relay.Secret = $streamKey; $relay.LogPath = $LogFile; $relay.Width = $w; $relay.Height = $h
  foreach ($p in 47810..47830) {
    try { $relay.Port = $p; $relay.Start(); $script:Port = $p; break } catch { $relay = New-Object PLRelay -Property @{ Root = $Site; Ffmpeg = $Ffmpeg; VideoArgs = $videoArgs; OutputArgs = $outputArgs; Secret = $streamKey; LogPath = $LogFile; Width = $w; Height = $h } }
  }
  if (-not $script:Port) { throw 'Could not start the small web server on this computer (ports 47810-47830 are all taken).' }
  Write-Log ('web server on port ' + $script:Port)

  # The browser: Chrome if it's here, otherwise Edge (always on Windows)
  if (-not $Browser) {
    $cands = @()
    if ($OnWindows) {
      $cands += Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'
      $cands += Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe'
      $cands += Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe'
      $cands += Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'
      $cands += Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe'
    }
    $Browser = $cands | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
    if (-not $Browser) { throw 'Could not find Chrome or Edge on this computer.' }
  }
  Write-Log ('browser: ' + $Browser)
  $dbg = 47850 + (Get-Random -Maximum 40)
  # Which screen's sharing to auto-pick for the sound: Chrome calls a single screen "Entire screen", and several "Screen 1", "Screen 2"...
  $screens = 1
  if ($UseTray) { $screens = [System.Windows.Forms.Screen]::AllScreens.Count }
  $pick = if ($screens -gt 1) { 'Screen 1' } else { 'Entire screen' }
  $pageUrl = 'http://localhost:' + $script:Port + '/index.html?stream=1&runner=1&link=' + $cfg.link + '&sound=' + $cfg.sound + '&at=0'

  function Start-Browser([bool]$windowed) {
    $profileDir = Join-Path $HomeDir 'browser'
    $a = @('--user-data-dir="' + $profileDir + '"', '--no-first-run', '--no-default-browser-check', '--disable-extensions',
      '--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream',
      ('"--auto-select-desktop-capture-source=' + $pick + '"'), ('--remote-debugging-port=' + $dbg),
      '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
      '--disable-features=CalculateNativeWinOcclusion,Translate', '--force-device-scale-factor=1', '--hide-scrollbars', '--mute-audio',
      ('--window-size=' + $w + ',' + $h))
    if ($windowed) { $a += @('--window-position=-32000,-32000', ('--app=' + $pageUrl)) }
    else {
      $a += @('--headless=new', '--enable-gpu', '--ignore-gpu-blocklist')
      if ($OnWindows) { $a += '--use-angle=d3d11' }
    }
    if ($BrowserArgs) { $a += $BrowserArgs }
    if (-not $windowed) { $a += ('"' + $pageUrl + '"') }
    $si = New-Object System.Diagnostics.ProcessStartInfo $Browser, ($a -join ' ')
    $si.UseShellExecute = $false
    $si.CreateNoWindow = $true
    $script:BrowserProc = [System.Diagnostics.Process]::Start($si)
    $script:BrowserStarted = Get-Date
    Write-Log ('browser started (' + $(if ($windowed) { 'off-screen window' } else { 'hidden' }) + ')')
  }

  # Talks to the hidden browser through its debugging connection: makes its page exactly the stream's size (a
  # hidden browser's "window" loses some height to toolbars it doesn't draw), then "clicks" the page so it may ask
  # for the computer's sound
  function Invoke-BrowserSetup {
    $t = $null; $ver = $null
    foreach ($i in 1..40) {
      try {
        $list = Invoke-RestMethod -Uri ('http://127.0.0.1:' + $dbg + '/json/list') -UseBasicParsing -TimeoutSec 3
        $t = @($list | Where-Object { $_.type -eq 'page' -and $_.url -like '*runner=1*' })[0]
        $ver = Invoke-RestMethod -Uri ('http://127.0.0.1:' + $dbg + '/json/version') -UseBasicParsing -TimeoutSec 3
      } catch {}
      if ($t -and $ver -and $relay.StatusJson) { break }
      Start-Sleep -Milliseconds 500
      if ($UseTray) { [System.Windows.Forms.Application]::DoEvents() }
    }
    if (-not $t -or -not $ver) { Write-Log 'could not reach the hidden browser to set it up'; return 'unreachable' }
    $ws = New-Object System.Net.WebSockets.ClientWebSocket
    $none = [Threading.CancellationToken]::None
    $script:CdpId = 0
    $call = {
      param([string]$method, [hashtable]$params, [string]$session, [int]$secs)
      $script:CdpId++
      $id = $script:CdpId
      $m = @{ id = $id; method = $method; params = $params }
      if ($session) { $m.sessionId = $session }
      $bytes = [Text.Encoding]::UTF8.GetBytes(($m | ConvertTo-Json -Depth 8 -Compress))
      [void]$ws.SendAsync((New-Object System.ArraySegment[byte] -ArgumentList @(,$bytes)), [System.Net.WebSockets.WebSocketMessageType]::Text, $true, $none).Wait(5000)
      $buf = New-Object byte[] 262144
      $sb = New-Object System.Text.StringBuilder
      $until = (Get-Date).AddSeconds($secs)
      while ((Get-Date) -lt $until) {
        $task = $ws.ReceiveAsync((New-Object System.ArraySegment[byte] -ArgumentList @(,$buf)), $none)
        while (-not $task.Wait(200)) { if ($UseTray) { [System.Windows.Forms.Application]::DoEvents() }; if ((Get-Date) -gt $until) { break } }
        if (-not $task.IsCompleted) { break }
        [void]$sb.Append([Text.Encoding]::UTF8.GetString($buf, 0, $task.Result.Count))
        if (-not $task.Result.EndOfMessage) { continue }
        $j = $sb.ToString() | ConvertFrom-Json
        [void]$sb.Clear()
        if ($j.PSObject.Properties['id'] -and $j.id -eq $id) { return $j }
      }
      return $null
    }
    try {
      if (-not $ws.ConnectAsync([Uri]$ver.webSocketDebuggerUrl, $none).Wait(5000)) { return 'no connection' }
      $att = & $call 'Target.attachToTarget' @{ targetId = $t.id; flatten = $true } '' 10
      $sid = $att.result.sessionId
      $size = { $r = & $call 'Runtime.evaluate' @{ expression = '[innerWidth, innerHeight]'; returnByValue = $true } $sid 10; return @($r.result.result.value) }
      $in = & $size
      if ($in.Count -eq 2 -and ($in[0] -ne $w -or $in[1] -ne $h)) {
        $win = & $call 'Browser.getWindowForTarget' @{ targetId = $t.id } '' 10
        if ($win -and $win.result) {
          $bw = [int]$win.result.bounds.width + ($w - [int]$in[0]); $bh = [int]$win.result.bounds.height + ($h - [int]$in[1])
          [void](& $call 'Browser.setWindowBounds' @{ windowId = $win.result.windowId; bounds = @{ width = $bw; height = $bh } } '' 10)
          foreach ($k in 1..10) { $in2 = & $size; if ($in2.Count -eq 2 -and $in2[0] -eq $w -and $in2[1] -eq $h) { break }; Start-Sleep -Milliseconds 200 }
          Write-Log ('page size ' + ($in -join 'x') + ' -> ' + ($in2 -join 'x'))
        }
      }
      $r = & $call 'Runtime.evaluate' @{ expression = 'window.__plRunnerSound ? window.__plRunnerSound() : "missing"'; userGesture = $true; awaitPromise = $true; returnByValue = $true } $sid 30
      if ($r -and $r.result -and $r.result.result.value) { return [string]$r.result.result.value }
      return ('no answer: ' + ($r | ConvertTo-Json -Depth 6 -Compress))
    } catch { return ('error: ' + $_.Exception.Message) }
    finally { try { $ws.Dispose() } catch {} }
  }

  if ($OnWindows) { [PLRelay]::KeepAwake($true) }
  Set-TrayText 'Phosphor Loop: starting'
  $script:UseWindow = [bool]$Windowed
  Start-Browser $script:UseWindow
  $soundResult = Invoke-BrowserSetup
  Write-Log ('sound: ' + $soundResult)
  # The computer's sound comes from screen sharing, which a hidden browser on Windows can be refused (NotReadableError).
  # Then try once as a browser window placed off screen; if that gets no sound either, go back to the hidden browser
  # and stream without sound.
  if ($OnWindows -and -not $script:UseWindow -and $cfg.sound -eq 'system' -and ([string]$soundResult).StartsWith('failed')) {
    Write-Log 'no sound in the hidden browser; trying a browser window placed off screen'
    Stop-Browser
    $relay.StatusJson = ''
    $script:UseWindow = $true
    Start-Browser $true
    $soundResult = Invoke-BrowserSetup
    Write-Log ('sound (off-screen window): ' + $soundResult)
    if (-not ([string]$soundResult).StartsWith('ok')) {
      Write-Log 'no sound that way either; back to the hidden browser, without sound'
      Stop-Browser
      $relay.StatusJson = ''
      $script:UseWindow = $false
      Start-Browser $false
      $soundResult = Invoke-BrowserSetup
      Write-Log ('sound: ' + $soundResult)
    }
  }

  # -----------------------------------------------------------------------------------------------------------
  # Running: every second, look at how it's going
  # -----------------------------------------------------------------------------------------------------------
  $script:Done = $false
  $script:Said = @{}
  $script:BrowserRestarts = 0
  $script:LastRuns = 0
  function Tick {
    if ($script:Done) { return }
    if (Test-Path $StopFile) { $script:Done = $true; return }
    if ($StopAfterPieces -gt 0 -and $relay.TotalPieces -ge $StopAfterPieces) { $script:Done = $true; return }
    $st = $null
    if ($relay.StatusJson) { try { $st = $relay.StatusJson | ConvertFrom-Json } catch {} }
    if ($st) {
      # The picture drawn by the slow software stand-in instead of the graphics chip: try a hidden window instead
      if (-not $script:Said['renderer']) { $script:Said['renderer'] = 1; Write-Log ('drawn by: ' + $st.renderer + ', ' + $st.w + 'x' + $st.h) }
      if (-not $script:UseWindow -and $OnWindows -and ($st.renderer -match 'SwiftShader|llvmpipe|Basic Render|Software')) {
        $script:UseWindow = $true
        Write-Log 'the hidden browser has no graphics chip; switching to an off-screen window'
        Stop-Browser
        $relay.StatusJson = ''
        Start-Browser $script:UseWindow
        [void](Invoke-BrowserSetup)
        return
      }
    }
    if ($relay.FfmpegLive -and $relay.Runs -ne $script:LastRuns) {
      $script:LastRuns = $relay.Runs
      $sw = if ($st -and ([string]$st.sound).StartsWith('ok')) { 'with your computer''s sound' } else { 'but without sound (see the log)' }
      if ($Out) { Say ('Recording to ' + $Out + ' ' + $sw + '.') }
      elseif ($BandwidthTest -and $cfg.platform -ne 'kick') { Say ('Practice run on Twitch (viewers cannot see it), ' + $sw + '.') }
      else { Say ('You are live on ' + (Get-PlatformName) + ', ' + $sw + '. Double-click the desktop icon again to stop.') }
    }
    if ($relay.GaveUp) {
      $why = $relay.LastError
      $pn = Get-PlatformName
      $what = if ($cfg.platform -eq 'kick') { 'the Stream URL and Stream Key' } else { 'the stream key' }
      $plain = if ($why -match '401|403|Unauthorized|Forbidden|denied') { $pn + ' did not accept ' + $what + '. Right-click the tray icon, choose Change Twitch or Kick, stream key..., and paste ' + $what + ' again.' }
               elseif ($why -match 'resolve|Network|Connection|timed out|I/O error|refused') { 'Could not reach ' + $pn + '. Check the internet connection, then double-click the icon again.' }
               else { 'The stream stopped working: ' + $why }
      Say $plain -Problem
      Show-Message $plain 'Warning'
      $script:Done = $true
      return
    }
    if ($script:BrowserProc -and $script:BrowserProc.HasExited) {
      $script:BrowserRestarts++
      if ($script:BrowserRestarts -gt 3) { Say 'The hidden browser keeps closing. Stopping; see the log.' -Problem; $script:Done = $true; return }
      Write-Log 'the hidden browser closed; starting it again'
      $relay.StatusJson = ''
      Start-Browser $script:UseWindow
      [void](Invoke-BrowserSetup)
    }
    $state = if ($relay.FfmpegLive) { if ($Out) { 'recording a test' } else { 'LIVE on ' + (Get-PlatformName) } } else { 'starting' }
    $fps = if ($st) { [string]$st.fps + ' fps' } else { '' }
    $sd = if ($st -and ([string]$st.sound).StartsWith('ok')) { 'sound on' } else { 'no sound' }
    $parts = @($state, $fps, $sd, ($script:SizeText + ' ' + $script:EncShort)) | Where-Object { $_ -and $_.Trim() }
    Set-TrayText ('Phosphor Loop: ' + ($parts -join ', '))
    $inner = @($fps, $sd) | Where-Object { $_ }
    if ($script:MenuState) { $script:MenuState.Text = "Phosphor Loop is $state (" + ($inner -join ', ') + ") - $($script:SizeText), encoded by $($script:EncLong)" }
  }

  if ($UseTray) {
    $timer = New-Object System.Windows.Forms.Timer
    $timer.Interval = 1000
    $appCtx = New-Object System.Windows.Forms.ApplicationContext
    $timer.Add_Tick({ try { Tick } catch { Write-Log ('tick: ' + $_.Exception.Message) }; if ($script:Done) { $timer.Stop(); $appCtx.ExitThread() } })
    $timer.Start()
    [System.Windows.Forms.Application]::Run($appCtx)
  } else {
    while (-not $script:Done) { Tick; Start-Sleep -Milliseconds 500 }
  }
  $last = $relay.StatusJson
  $pieces = $relay.TotalPieces
  if ($Out -or -not $UseTray) { Write-Log ('pieces sent: ' + $pieces + '; last report: ' + $last) }
  if (-not $Out) { Say 'Stopped streaming.' }
  Stop-All 'finished'
} catch {
  $err = $_.Exception.Message
  Write-Log ('problem: ' + $err + ' ' + $_.InvocationInfo.PositionMessage)
  Stop-All 'problem'
  Show-Message ('Phosphor Loop could not go live: ' + $err + "`n`nThe details are in " + $LogFile) 'Error'
  exit 1
}
