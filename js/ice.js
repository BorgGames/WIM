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

const API_KEY = "c8f6f80012a6fff80645fc4194580912564a";