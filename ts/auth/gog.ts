import {SYNC} from "../onedrive.js";
import {devMode} from "../dev.js";

const AUTH_ENDPOINT = devMode()
    ? 'https://localhost:7173/cors/gog/'
    : 'https://borg-ephemeral.azurewebsites.net/cors/gog/';

const TOKENS_URL = 'special/approot:/Stores/gog-tokens.json';
const TOKENS_KEY = 'gog-tokens';

export async function getToken() {
    let tokens = JSON.parse(localStorage.getItem(TOKENS_KEY)!);

    if (tokens === null) {
        const response = await SYNC.download(TOKENS_URL);
        if (response === null) {
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

    localStorage.setItem(TOKENS_KEY, JSON.stringify(tokens));
    try {
        await saveTokens();
    } catch (e) {
        console.error('error saving tokens', e);
    }

    document.body.classList.add('gog');
    document.body.classList.remove('gog-pending');

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

export async function handleLogin() {
    try {
        const query = new URLSearchParams(window.location.search);
        if (!query.has('gog_code'))
            return;
        const code = query.get('gog_code')!;
        query.delete('gog_code');
        window.history.replaceState({}, document.title, window.location.pathname + '?' + query.toString());
        await completeLogin(code);
    } catch (e) {
        console.error('error handling GOG login', e);
    }
}

async function completeLogin(code: string) {
    const url = AUTH_ENDPOINT + 'code2token?code=' + encodeURIComponent(code);
    const response = await fetch(url, {
        method: 'POST',
    });
    if (!response.ok) {
        let error = "";
        try {
            error = await response.text();
        } catch (e) {
        }
        if (response.status === 401 && error)
            throw new Error(error);
        if (error)
            error = "\r\n" + error;
        throw new Error(`HTTP ${response.status}: ${response.statusText} ${error}`);
    }
    const tokens = await response.json();
    localStorage.setItem(TOKENS_KEY, JSON.stringify(tokens));

    console.log('GOG.com logged in');

    gogLogin.style.display = 'none';
    document.body.classList.remove('gog-pending');
    document.body.classList.add('gog');
}

async function saveTokens() {
    const tokens = localStorage.getItem(TOKENS_KEY);
    const save = tokens !== null && tokens !== ''
        ? await SYNC.makeRequest(TOKENS_URL + ':/content', {
            method: 'PUT',
            headers: {'Content-Type': 'application/json'},
            body: localStorage.getItem(TOKENS_KEY),
        }) : await SYNC.makeRequest(TOKENS_URL, {
            method: 'DELETE',
        });
    if (!save.ok)
        throw new Error(`Failed to save GOG account: HTTP ${save.status}: ${save.statusText}`);
}

const codeInput = <HTMLInputElement>document.getElementById('gog-code')!;
const gogLogin = document.getElementById('gog-login-dialog')!;
codeInput.addEventListener('input', async event => {
    if (codeInput.value.startsWith('https://embed.gog.com/on_login_success?')) {
        const params = new URLSearchParams(codeInput.value);
        const code = params.get('code');
        if (!code)
            return;

        console.log('GOG code:', code);
        codeInput.classList.remove('bad');
        codeInput.disabled = true;
        try {
            await completeLogin(code);
        } catch (e) {
            codeInput.classList.add('bad');
            throw e;
        } finally {
            codeInput.disabled = false;
        }
    }
});
const disconnectGog = document.getElementById('disconnect-gog');
disconnectGog!.addEventListener('click', async event => {
    event.preventDefault();

    document.body.classList.remove('gog');
    document.body.classList.add('gog-pending');

    localStorage.removeItem(TOKENS_KEY);
    await saveTokens();
});