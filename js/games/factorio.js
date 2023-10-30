import * as Steam from "../auth/steam.js";

import {SYNC} from "../onedrive.js";

import {devMode} from "../dev.js";
import {promiseOr} from "../util.js";

const LOGIN = 'https://borg-ephemeral.azurewebsites.net/cors/factorio/login';
export const REPRESENTATIVE_PACKAGE_IDS = [88199];
export const APP_ID = 427520;
export const LOCAL_DATA = "Games/Factorio";
const LOCAL_DATA_URL = `special/approot:/${LOCAL_DATA}`;
const PLAYER_DATA_URL = LOCAL_DATA_URL + "/player-data.json";

const steamQR = new QRCode(document.getElementById('steam-qr'), 'https://borg.games');

const playFull = document.getElementById('factorio');
const loginContainer = document.getElementById('factorio-login-container');
const loginForm = document.getElementById('factorio-login-form');
const uname = loginForm.elements["username"];
const pwd = loginForm.elements["password"];

const creds = JSON.parse(localStorage.getItem('factorio-creds'));
if (creds) {
    uname.value = creds.user;
    pwd.value = creds.pass;
}

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

    localStorage.removeItem('factorio-creds');

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

async function credsMissing() {
    try {
        var [player, creds] = await Promise.all([getPlayerData(), getCreds()]);
    } catch (e) {
        console.error('loginRequired', e);
        return true;
    }
    const user = player["service-username"];
    const token = player["service-token"];
    const required = !user || !token || !creds;
    if (!required)
        localStorage.removeItem('factorio-creds');
    return required;
}

export async function loginRequired() {
    const creds = credsMissing().then(has => !has);
    const steam = devMode()
        ? Steam.hasLicenseToAny([APP_ID], REPRESENTATIVE_PACKAGE_IDS)
        : Promise.resolve(false);
    return !await promiseOr([creds, steam]);
}

let loginCheck = null;

const playFactorio = document.getElementById('factorio-play');
playFactorio.addEventListener('click', expand);

export async function expand() {
    playFactorio.style.display = 'none';
    document.getElementById('factorio-login').style.display = 'inline-block';
    const needsLogin = await checkLogin();
    if (needsLogin && devMode()) {
        const steam = await Steam.getSteam();
        console.log('conduit connected. querying about Steam...');
        try {
            const result = await steam.call('LoginWithQR', [null]);
            steamQR.makeCode(result.ChallengeURL);
        } catch (e) {
            console.log('unable to initiate Steam QR login: ', e);
        }
    }
}

if (creds)
    expand();

playFactorio.addEventListener('mouseenter', checkLogin);

function credsEntered() {
    return uname.validity.valid && pwd.validity.valid
}

for (const input of [uname, pwd]) {
    input.addEventListener('input', () => {
        playFull.disabled = !credsEntered();
        localStorage.setItem('factorio-creds', JSON.stringify({
            user: uname.value,
            pass: pwd.value,
        }));
    });
}

async function checkLogin() {
    if (loginCheck)
        return await loginCheck;

    loginCheck = (async () => {
        playFull.disabled = !credsEntered();
        const needsLogin = await loginRequired();
        playFull.disabled = needsLogin && !credsEntered();
        console.log('Factorio needs login', needsLogin);
        loginContainer.classList.toggle('needs-login', needsLogin);
        return needsLogin;
    })();
    return await loginCheck;
}

