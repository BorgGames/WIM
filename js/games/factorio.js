import * as Steam from "../auth/steam.js";

import {SYNC} from "../onedrive.js";

import {devMode} from "../dev.js";
import {promiseOr} from "../util.js";

export const REPRESENTATIVE_PACKAGE_IDS = [88199];
export const APP_ID = 427520;
export const LOCAL_DATA = "Games/Factorio";
const LOCAL_DATA_URL = `special/approot:/${LOCAL_DATA}`;
const PLAYER_DATA_URL = LOCAL_DATA_URL + "/player-data.json";
const playFull = document.getElementById('factorio');
const loginContainer = document.getElementById('factorio-login-container');

async function getPlayerData() {
    const response = await SYNC.download(PLAYER_DATA_URL);
    if (response === null)
        return {};
    return await response.json();
}

async function credsMissing() {
    try {
        var player = await getPlayerData();
    } catch (e) {
        console.error('loginRequired', e);
        return true;
    }
    const user = player["service-username"];
    const token = player["service-token"];
    const required = !user || !token;
    if (!required)
        localStorage.removeItem('factorio-creds');
    return required;
}

export async function loginRequired() {
    const creds = credsMissing().then(has => !has);
    const steam = Steam.hasLicenseToAny([APP_ID], REPRESENTATIVE_PACKAGE_IDS);
    return !await promiseOr([creds, steam]);
}

let loginCheck = null;

const playFactorio = document.getElementById('factorio-play');
playFactorio.addEventListener('click', expand);

export async function expand() {
    playFactorio.style.display = 'none';
    document.getElementById('factorio-login').style.display = 'inline-block';
    const needsLogin = await checkLogin();
    if (needsLogin) {
        const steam = await Steam.getSteam();
        console.log('conduit connected. querying about Steam...');
        try {
            const result = await steam.call('LoginWithQR', [null]);
            await Steam.loginWithQR(result.ChallengeURL);
            if (await checkLogin()) 
                alert("You don't have Factorio on Steam, login with username and password instead");
        } catch (e) {
            console.log('unable to initiate Steam QR login: ', e);
        }
    }
}

playFactorio.addEventListener('mouseenter', checkLogin);

async function checkLogin() {
    if (loginCheck)
        return await loginCheck;

    Steam.getSteam();

    loginCheck = (async () => {
        const needsLogin = await loginRequired();
        playFull.disabled = needsLogin && modeSwitch.dataset['mode'] === 'steam';
        console.log('Factorio needs login', needsLogin);
        loginContainer.classList.toggle('needs-login', needsLogin);
        return needsLogin;
    })();
    const result = await loginCheck;
    loginCheck = null;
    return result;
}

const modeSwitch = document.getElementById('mode-switch');
modeSwitch.addEventListener('click', e => switchLoginMode(e));
function switchLoginMode(e) {
    e?.preventDefault();

    const mode = modeSwitch.dataset['mode'] === 'steam' ? 'password' : 'steam';
    modeSwitch.dataset['mode'] = mode;
    modeSwitch.innerText = mode === 'steam'
        ? 'Use in-game login instead'
        : 'Login with Steam instead';

    for(const mode of document.querySelectorAll('.login-mode')) {
        mode.classList.toggle('selected');
    }

    if (mode === 'steam') {
        checkLogin();
    } else {
        playFull.disabled = false;
    }
}
