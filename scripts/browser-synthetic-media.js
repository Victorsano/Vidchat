// Browser-only test instrumentation. Never imported by application code.
// Produces canvas video and an oscillator audio track; no physical device access.
window.__rtcTestPeers = [];
const NativePeer = window.RTCPeerConnection;
window.RTCPeerConnection = class extends NativePeer {
  constructor(...args) {
    super(...args);
    window.__rtcTestPeers.push(this);
  }
};
navigator.mediaDevices.getUserMedia = async (constraints) => {
  const stream = new MediaStream();
  if (constraints.video) {
    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 180;
    const ctx = canvas.getContext("2d");
    let frame = 0;
    const timer = setInterval(() => {
      ctx.fillStyle = frame++ % 2 ? "#a47eb9" : "#caab83";
      ctx.fillRect(0, 0, 320, 180);
      ctx.fillStyle = "#fff";
      ctx.font = "24px sans-serif";
      ctx.fillText("Synthetic test " + frame, 20, 90);
    }, 80);
    const video = canvas.captureStream(12).getVideoTracks()[0];
    video.addEventListener("ended", () => clearInterval(timer));
    stream.addTrack(video);
  }
  if (constraints.audio) {
    const audio = new AudioContext();
    const oscillator = audio.createOscillator();
    oscillator.frequency.value = 220;
    const destination = audio.createMediaStreamDestination();
    oscillator.connect(destination);
    oscillator.start();
    void audio.resume();
    const track = destination.stream.getAudioTracks()[0];
    track.addEventListener("ended", () => {
      oscillator.stop();
      void audio.close();
    });
    stream.addTrack(track);
  }
  return stream;
};
