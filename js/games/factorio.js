import {SYNC} from "../onedrive.js";

const LOGIN = 'https://borg-ephemeral.azurewebsites.net/cors/factorio/login';
export const LOCAL_DATA = "Games/Factorio";
const LOCAL_DATA_URL = `special/approot:/${LOCAL_DATA}`;
const PLAYER_DATA_URL = LOCAL_DATA_URL + "/player-data.json";

// https://auth.factorio.com/api-login
export async function login(user, pwd) {
    const response = await fetch(LOGIN, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
            username: user,
            password: pwd,
            api_version: 4,
            require_game_ownership: true,
        }),
    });
    const json = await response.json();
    if (!response.ok || !json.token)
        throw new Error(json.message);

    const playerData = await getPlayerData();
    playerData["service-username"] = json.username;
    playerData["service-token"] = json.token;

    const putResponse = await SYNC.makeRequest(PLAYER_DATA_URL + ':/content', {
        method: 'PUT',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(playerData)
    });

    if (!putResponse.ok)
        throw new Error(`Failed to save player data: HTTP ${putResponse.status}: ${putResponse.statusText}`);

    const credsResponse = await SYNC.makeRequest(LOCAL_DATA_URL + '/creds.json:/content', {
        method: 'PUT',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
            user: user,
            pass: pwd,
        })
    });

    if (!credsResponse.ok)
        throw new Error(`Failed to save credentials: HTTP ${credsResponse.status}: ${credsResponse.statusText}`);

    console.log('Factorio logged in');

    return json.token;
}

async function getPlayerData() {
    const response = await SYNC.download(PLAYER_DATA_URL);
    if (response === null)
        return {};
    return await response.json();
}

async function getCreds() {
    const response = await SYNC.download(LOCAL_DATA_URL + '/creds.json');
    if (response === null)
        return null;
    try {
        return await response.json();
    } catch (e) {
        console.error('getCreds', e);
        return null;
    }
}

export async function loginRequired() {
    const [player, creds] = await Promise.all([getPlayerData(), getCreds()]);
    const user = player["service-username"];
    const token = player["service-token"];
    return !user || !token || !creds;
}