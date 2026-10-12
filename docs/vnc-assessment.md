# VNC/noVNC assessment

**Status: disabled by default; no VNC server or proxy is installed or started.** The studio already exposes its editor through a loopback-only web UI, so it does not need remote desktop access to provide live scene editing.

noVNC supplies a browser-side VNC client. A usable connection also needs a running VNC server and, for servers without WebSocket support, a WebSocket-to-TCP proxy such as websockify. That would add a remote-desktop service capable of controlling the whole Windows session, which is broader than the editor's needs. See the [noVNC project](https://github.com/novnc/noVNC) and [websockify project](https://github.com/novnc/websockify).

If a future workflow explicitly needs VNC, keep the VNC server and proxy bound to `127.0.0.1`, require VNC authentication, keep the service off unless needed, and never expose it through a public or LAN interface without a separately reviewed access-control design. Do not use it to bypass CAPTCHA or other access checks.
