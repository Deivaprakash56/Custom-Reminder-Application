# Demo video build

Scripts that produced `docs/media/nudge-demo.mp4`. Everything is generated: the app is recorded
with Playwright and the music is synthesized, so there is no third-party footage or audio.

1. Serve the app: `python3 -m http.server 8765 --directory docs`
2. `node capture.js` drives the app with demo data (`seed.js`) and records 2x-resolution frames
   (slowed down 2.5x while recording) plus cursor, camera and caption cues into `cap/`.
3. `python3 music.py` writes the original 112 BPM soundtrack (`music.wav`, needs numpy + scipy).
4. `python3 edit.py` renders the 1080p60 film: zooms, cursor, captions, title cards, phone mock-up.
5. `python3 audio.py` adds UI sound effects at the editor's cues and writes `mix.wav`; then
   `ffmpeg -i video.mp4 -i mix.wav -c:v copy -c:a aac -b:a 192k -movflags +faststart nudge-demo.mp4`.

The product name and tagline are the `NAME` / `TAGLINE` constants at the top of `edit.py`.
