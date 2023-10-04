export function configureRTC(rtc) {
    const transceivers = rtc.getTransceivers();
    if (transceivers.length === 0)
        return;
    const videoCodecs = RTCRtpReceiver.getCapabilities('video').codecs;
    const limitedH264 = videoCodecs.filter(c => c.mimeType === 'video/H264'
        && !c.sdpFmtpLine.includes('profile-level-id=42e01f')).length === 0;
    if (limitedH264) {
        const video = transceivers.find(t => t.receiver.track.kind === 'video');
        videoCodecs.sort((a, b) => a.mimeType === 'video/VP8' ? -1 : 1);
        if ("setCodecPreferences" in video)
            video.setCodecPreferences(videoCodecs);
    }
}