import {makeRequest} from "./onedrive.js";

const prefix = "special/approot:";

async function forwarder(event) {
    const request = JSON.parse(event.data);
    try {
        if (!request.uri.startsWith('app:'))
            throw new Error('Invalid URI');
        const url = prefix + request.uri.substring('app:'.length);
        const response = await makeRequest(url, request.options);
        const text = await response.text();
        event.target.send(JSON.stringify({
            status: response.status,
            text
        }));
    } catch (e) {
        event.target.send(JSON.stringify({
            status: 502,
            text: JSON.stringify(e)
        }));
    }
}

export class OneDrivePersistence {
    constructor(channel) {
        this.channel = channel;
        channel.addEventListener('message', forwarder);
    }

    destroy() {
        this.channel.removeEventListener('message', forwarder);
    }
}