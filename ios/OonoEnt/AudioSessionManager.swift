import AVFoundation
import os

private let audioLog = Logger(subsystem: "com.panashemapika.oono-ent", category: "audio-session")

/// Configures the iOS audio session so radio + video playback survives
/// backgrounding. Without `.playback`, the OS treats our WKWebView as
/// "ambient" media and silences it the moment the user swipes home or
/// locks the iPad.
///
/// Combined with `UIBackgroundModes: audio` in Info.plist (already set),
/// this lets:
///   • the radio `<audio>` element keep streaming when the app is
///     backgrounded or the screen is locked.
///   • a fullscreen / Picture-in-Picture `<video>` (IPTV, VOD iframes)
///     continue playing in the floating PiP window the OS pops out for
///     us when `allowsPictureInPictureMediaPlayback` is on.
enum AudioSessionManager {
    static func configure() {
        let session = AVAudioSession.sharedInstance()
        do {
            // .playback  — full background playback even when the silent
            //              switch is on.
            // .moviePlayback — voice-over-ducking, lock-screen controls,
            //              and PiP all activate under this mode.
            // .mixWithOthers — let other apps (e.g. a phone call) duck us
            //              instead of getting hard-stopped.
            try session.setCategory(
                .playback,
                mode: .moviePlayback,
                options: [.mixWithOthers, .allowAirPlay, .allowBluetoothA2DP],
            )
            try session.setActive(true, options: [])
            audioLog.info("AVAudioSession configured for background playback")
        } catch {
            audioLog.error("AVAudioSession setup failed: \(error.localizedDescription, privacy: .public)")
        }
    }
}
