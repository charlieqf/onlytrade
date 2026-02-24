# Room BGM Track

Current stream pages use one shared BGM file for all rooms.

## Required filename

- `room_loop.mp3`

## Behavior

- All room pages use `/audio/bgm/room_loop.mp3`.
- Playback starts after user interaction if the browser blocks autoplay.
- BGM ducks while TTS is speaking to keep voices clear.

## Notes

- Keep the file compressed (for example 64-128 kbps MP3) to reduce bandwidth.
- Do not upload copyrighted music unless you have distribution rights.
