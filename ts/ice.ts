export function getIceServers() {
    let json = localStorage.getItem('iceServers');
    if (json === null)
        return [];
    return JSON.parse(json);
}

export async function updateIceServers() {
    let response = await fetch("https://borg.metered.live/api/v1/turn/credentials?apiKey=" + API_KEY);
    if (!response.ok)
        return;
    localStorage.setItem('iceServers', await response.text());
}

export function getConnectionType(rtc: RTCPeerConnection) {
    const receivers = rtc.getReceivers();
    for (const receiver of receivers) {
        if (receiver.track.kind !== "video" || !receiver.transport)
            continue;
        let ice = receiver.transport.iceTransport;
        let pair = ice.getSelectedCandidatePair();
        if (pair === null)
            continue;

        for (const candidate of [pair.local!, pair.remote!]) {
            if (candidate.type === "relay")
                return "relay";
        }
        return pair.local!.type;
    }

    return "unknown";
}

const API_KEY = "c8f6f80012a6fff80645fc4194580912564a";