﻿import {SYNC} from "../onedrive.js";
import {devMode} from "../dev.js";

const AUTH_ENDPOINT = devMode()
    ? 'https://localhost:7173/cors/gog/'
    : 'https://borg-ephemeral.azurewebsites.net/cors/gog/';

const TOKENS_URL = 'special/approot:/Stores/gog-tokens.json';

export async function getToken() {
    let tokens = JSON.parse(localStorage.getItem('gog-tokens')!);

    if (tokens === null) {
        const response = await SYNC.download(TOKENS_URL);
        if (response === null) {
            console.error('TODO: implement GOG login');
            return null;
        }
        tokens = await response.json();
    }

    // TODO skip refresh if token is still valid
    try {
        const refreshUrl = AUTH_ENDPOINT + 'refresh';
        const refresh = await fetch(refreshUrl, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(tokens),
        });
        if (!refresh.ok) {
            let error = "";
            try {
                error = await refresh.text();
            } catch (e) {
            }
            if (refresh.status === 401 && error)
                throw new Error(error);
            if (error)
                error = "\r\n" + error;
            throw new Error(`HTTP ${refresh.status}: ${refresh.statusText} ${error}`);
        }
        tokens = await refresh.json();
    } catch (e) {
        console.error('error refreshing token', e);
    }

    localStorage.setItem('gog-tokens', JSON.stringify(tokens));

    return tokens.access_token;
}

export class GogAuth {
    channel: RTCDataChannel;
    private _messageHandler: (event: any) => Promise<void>;

    constructor(channel: RTCDataChannel, game: string) {
        this.channel = channel;
        this._messageHandler = this.onMessage.bind(this);
        channel.addEventListener('message', this._messageHandler);
    }

    async onMessage(event: MessageEvent<string>) {
        try {
            const token = await getToken();
            this.channel.send(JSON.stringify({token}));
        } catch (e: any) {
            console.error('error getting GOG token', e);
            this.channel.send(JSON.stringify({error: e.name, message: e.message}));
        }
    }

    destroy() {
        this.channel.removeEventListener('message', this._messageHandler);
    }
}