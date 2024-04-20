import {SYNC} from "../onedrive.js";

const AUTH_ENDPOINT = 'https://borg-ephemeral.azurewebsites.net/cors/minecraft/';
export const LOCAL_DATA = "Games/Minecraft";
const LOCAL_DATA_URL = `special/approot:/${LOCAL_DATA}`;
const CREDS_URL = LOCAL_DATA_URL + "/cml-creds.json";

export interface IMinecraftLoginInit {
    code: string;
    location: string;
}

export async function beginLogin(): Promise<IMinecraftLoginInit> {
    const response = await fetch(AUTH_ENDPOINT + 'login', {method: 'POST'});
    const code = await response.text();
    const location = response.headers.get('Location')!;
    return {code, location};
}

export async function completeLogin(code: string) {
    const completionUrl = AUTH_ENDPOINT + 'await/' + encodeURIComponent(code);
    const completion = await fetch(completionUrl, {method: 'POST'});
    if (!completion.ok) {
        let error = "";
        try {
            error = await completion.text();
        } catch (e) {}
        if (completion.status === 401 && error)
            throw new Error(error);
        if (error)
            error = "\r\n" + error;
        throw new Error(`HTTP ${completion.status}: ${completion.statusText} ${error}`);
    }
    const session = await completion.json();
    const save = await SYNC.makeRequest(CREDS_URL + ':/content', {
        method: 'PUT',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(session),
    });
    if (!save.ok)
        throw new Error(`Failed to save MC account: HTTP ${save.status}: ${save.statusText}`);

    console.log('Minecraft logged in');
}

export async function loginRequired() {
    try {
        var creds = await getCreds();
        if (creds === null)
            return true;
    } catch (e) {
        console.error('MC loginRequired', e);
        return true;
    }

    try {
        const profile = await getProfile(creds.accessToken);
        console.log('MC profile', profile);
        return false;
    } catch (e) {
        console.error('MC loginRequired', e);
        return true;
    }
}

async function getProfile(accessToken: string) {
    const profileUrl = AUTH_ENDPOINT + 'check/' + encodeURIComponent(accessToken);
    const profile = await fetch(profileUrl, {method: 'POST'});
    if (profile.status === 401)
        return new Error('Unauthorized');
    return await profile.json();
}

export async function getCreds() {
    const response = await SYNC.download(CREDS_URL);
    if (response === null)
        return null;

    try {
        return await response.json();
    } catch (e) {
        console.error('mc-creds', e);
        return null;
    }
}