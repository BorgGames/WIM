import * as util from "./streaming-client/src/util.js";
import * as Msg from './streaming-client/src/msg.js';
import * as Factorio from './games/factorio.js';
import * as Minecraft from "./games/mc.js";
import * as Steam from "./auth/steam.js";

import {Client} from './streaming-client/src/client.js';
import {ClientAPI} from "./client-api.js";
import {Ephemeral} from "./ephemeral.js";
import {OneDrivePersistence} from "./drive-persistence.js";
import {Session} from "./session.js";

import {getNetworkStatistics} from "./connectivity-check.js";
import {devMode} from "./dev.js";
import {SYNC} from "./onedrive.js";

const clientApi = new ClientAPI();
const status = document.getElementById('game-status');
const video = document.getElementById('stream');
const videoBitrate = document.getElementById('video-bitrate');

let controlChannel = null;

const resume = document.getElementById('video-resume');
resume.onclick = () => video.play();

const mcLoginDialog = document.getElementById('mc-login-dialog');
const modeSwitch = document.getElementById('mode-switch');
const inviteButtons = document.querySelectorAll('button.invite');
const inviteText = 'Join Borg P2P Cloud Gaming network to play remotely or rent your PC out.' +
    ' You will need to install the Borg software on a gaming PC under Windows Pro.' +
    ' You can download the Borg node software from the Microsoft Store.';
const invite = {
    title: 'Setup Borg node',
    text: inviteText,
    uri: 'https://borg.games/setup',
};
const emailInvite = "mailto:"
    + "?subject=" + encodeURIComponent('Invite: Join Borg P2P Cloud Gaming')
    + "&body=" + encodeURIComponent(inviteText
        + '\n\nDownload Borg app from Microsoft Store: https://www.microsoft.com/store/apps/9NTDRRR4814S'
        + '\n\nSetup instructions: https://borg.games/setup'
    );

export class Home {
    static async init() {
        modeSwitch.addEventListener('click', e => switchLoginMode(e));
        if (!devMode())
            switchLoginMode();
        const steamLogin = document.getElementById('steam-login');
        steamLogin.addEventListener('click', () => Steam.login());

        const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
        if (isSafari)
            setInterval(safariHack, 3000);
        let loginPromise = Home.login();
        videoBitrate.addEventListener('input', changeBitrate);

        for (const button of inviteButtons) {
            button.addEventListener('click', () => {
                if (navigator.canShare && navigator.canShare(invite)) {
                    navigator.share(invite)
                        .then(() => console.log('Share was successful.'))
                        .catch((error) => console.log('Sharing failed', error));
                } else {
                    window.open(emailInvite);
                }
            })
        }

        function changeBitrate() {
            const short = videoBitrate.value < 4 ? "low"
                : videoBitrate.value < 8 ? "medium"
                    : videoBitrate.value < 12 ? "high"
                        : "ultra";
            const qualityText = document.getElementById('video-quality');
            qualityText.innerText = videoBitrate.title = `${short} - ${videoBitrate.value} Mbps`;
            localStorage.setItem('encoder_bitrate', videoBitrate.value);
            if (controlChannel)
                controlChannel.send(Msg.config({encoder_bitrate: +videoBitrate.value}));
        }

        videoBitrate.value = parseInt(localStorage.getItem('encoder_bitrate')) || 2;
        changeBitrate();

        const loginButton = document.getElementById('loginButton');
        loginButton.addEventListener('click', () => {
            Home.login(true);
        });
        let loggedIn = await loginPromise;
        if (!loggedIn && SYNC.account)
            loggedIn = await Home.login(true);

        loginButton.disabled = loggedIn;

        if (Steam.loginRedirected()) {
            const licenses = await Steam.onLogin();
            const factorioLicense = licenses.find(l => l.AppID === Factorio.APP_ID || Factorio.REPRESENTATIVE_PACKAGE_IDS.includes(l.PackageID));
            Factorio.expand();
            if (!factorioLicense)
                alert("Factorio license not found.");
        }
    }

    static async login(loud) {
        let token;
        try {
            token = await SYNC.login(loud);
        } catch (e) {
            console.error(e);
        }
        if (token)
            await Home.showStorage();
        else if (!SYNC.account || loud)
            Home.showLogin();

        return !!token;
    }

    static async showStorage() {
        const response = await SYNC.makeRequest('');
        if (!response.ok) {
            console.error(response);
            Home.showLogin();
            return;
        }
        const items = await response.json();
        const progress = document.getElementById('space');
        progress.max = items.quota.total;
        progress.value = items.quota.used;
        const GB = 1024 * 1024 * 1024;
        progress.innerText = progress.title = `${Math.round(items.quota.used / GB)} GB / ${Math.round(items.quota.total / GB)} GB`;
        document.body.classList.add('sync');
        document.body.classList.remove('sync-pending');
    }

    static showLogin() {
        document.body.classList.remove('sync-pending');
    }

    static runClient(nodes, persistenceID, config, timeout) {
        const signalFactory = (onFatal) => new Ephemeral();

        return new Promise(async (resolve) => {
            const clients = [];

            function killOthers(current) {
                for (let j = 0; j < clients.length; j++) {
                    if (clients[j] !== current)
                        clients[j].destroy(Client.StopCodes.CONCURRENT_SESSION);
                    else
                        console.log('we have a winner: ', j);
                }
                clients.length = 1;
                clients[0] = current;
            }

            for (let i = 0; i < nodes.length; i++) {
                const offer = nodes[i];
                //set up client object with an event callback: gets connect, status, chat, and shutter events
                const client = new Client(clientApi, signalFactory, video, (event) => {
                    console.log('EVENT', i, event);

                    switch (event.type) {
                        case 'exit':
                            document.removeEventListener('keydown', hotkeys, true);
                            if (event.code !== Client.StopCodes.CONCURRENT_SESSION)
                                resolve(event.code);
                            else
                                clients.removeByValue(client);
                            break;
                        case 'status':
                            if (client.exitCode === Client.StopCodes.CONCURRENT_SESSION)
                                break;
                            status.innerText = event.msg;
                            console.log(i, event.msg);
                            const resumeRequired = event.msg === 'video suspend';
                            resume.style.display = resumeRequired ? 'inline-block' : 'none';
                            if (resumeRequired)
                                video.autoplay = false;
                            break;
                    }
                }, async (name, channel) => {
                    switch (name) {
                        case 'control':
                            await Session.waitForCommandRequest(channel);
                            if (client.exited())
                                break;
                            const stats = await getNetworkStatistics(channel);
                            if (client.exited())
                                break;
                            await Session.waitForCommandRequest(channel);
                            if (client.exited())
                                break;
                            killOthers(client);
                            if (client.exited())
                                break;
                            const launch = {
                                Launch: "borg:games/" + config.game,
                                PersistenceRoot: SYNC.isLoggedIn() ? persistenceID : undefined,
                            };
                            channel.send("\x15" + JSON.stringify(launch));
                            await Session.waitForCommandRequest(channel);
                            controlChannel = channel;
                            break;
                        case 'persistence':
                            if (SYNC.isLoggedIn()) {
                                const persistence = new OneDrivePersistence(channel, [persistenceID]);
                                console.log('persistence enabled');
                            }
                            break;
                    }
                });
                clients.push(client);

                //set up useful hotkeys that call client methods: destroy can also be used to cancel pending connection
                const hotkeys = (event) => {
                    event.preventDefault();

                    if (event.code === 'Backquote' && event.ctrlKey && event.altKey) {
                        client.destroy(0);
                    } else if (event.code === 'Enter' && event.ctrlKey && event.altKey) {
                        util.toggleFullscreen(client.element);
                    } else if (event.code === 'Slash' && event.ctrlKey && event.altKey) {
                        document.body.classList.toggle('video-overlay');
                    }
                };
                document.addEventListener('keydown', hotkeys, true);

                async function run() {
                    try {
                        const info = JSON.parse(offer.peer_connection_offer);
                        const sdp = JSON.parse(info.Offer);

                        const encoder_bitrate = parseInt(localStorage.getItem('encoder_bitrate')) || 2;

                        await Promise.race([
                            timeout,
                            client.connect(offer.session_id, sdp, {
                                encoder_bitrate
                            })]);
                    } catch (e) {
                        if (clients.removeByValue(client) && clients.length === 0)
                            resolve(e);
                    }
                }

                run();
            }
        });
    }

    static async launch(config) {
        const timeout = util.timeout(1000 /*s*/ * 60 /*m*/ * 3);

        try {
            if (!config.sessionId)
                config.sessionId = crypto.randomUUID();

            if ((config.game === 'factorio' || config.game === 'minecraft') && !SYNC.isLoggedIn()) {
                if (!await showLoginDialog())
                    return;
            }

            const gameName = config.game === 'minecraft' ? 'Minecraft' : 'Factorio';

            document.body.classList.add('video');

            let persistenceID = undefined;
            if (SYNC.isLoggedIn())
                persistenceID = await ensureSyncFolders(gameName);

            switch (config.game) {
                case 'factorio':
                    if (config.user && await Factorio.loginRequired())
                        await Factorio.login(config.user, config.pwd);
                    break;
                case 'minecraft':
                    if (await Minecraft.loginRequired()) {
                        const login = await Minecraft.beginLogin();
                        showMinecraftLogin(login);
                        try {
                            await Minecraft.completeLogin(login.code);
                        } finally {
                            mcLoginDialog.style.display = 'none';
                        }
                    }
                    break;
            }
            if (config.game === 'factorio' && config.user) {
                if (await Factorio.loginRequired())
                    await Factorio.login(config.user, config.pwd);
            }

            status.innerText = 'looking for a node...';
            const nodes = await Ephemeral.getNodes();
            if (nodes.length === 0)
                throw new Error('No nodes currently available. Try again later.');

            const code = await Home.runClient(nodes, persistenceID, config, timeout);

            if (code !== 0)
                alert(`Exit code: ${code}`);
        } catch (e) {
            console.error(e);
            alert(e);
        } finally {
            controlChannel = null;
            document.body.classList.remove('video');

            video.src = '';
            video.load();
        }
    }
}

function switchLoginMode(e) {
    e?.preventDefault();

    const mode = modeSwitch.dataset['mode'] === 'steam' ? 'password' : 'steam';
    modeSwitch.dataset['mode'] = mode;
    modeSwitch.innerText = mode === 'steam'
        ? 'Enter Factorio.com password or token instead'
        : 'Login with Steam instead';

    for(const mode of document.querySelectorAll('.login-mode')) {
        mode.classList.toggle('selected');
    }
}

async function showLoginDialog() {
    const dialog = document.getElementById('login-dialog');
    dialog.style.display = 'flex';
    const promise = new Promise(async (resolve) => {
        const doLogin = async () => {
            try {
                resolve(await Home.login(true));
            } catch (e) {
                resolve(false);
            }
        };
        // if (SYNC.account)
        //     await doLogin();
        document.getElementById('onedriveLogin').onclick = doLogin;
        document.getElementById('cancelLogin').onclick = () => resolve(false);
    });
    try {
        await promise;
    } finally {
        dialog.style.display = 'none';
    }
}

function showMinecraftLogin(login) {
    document.getElementById('mc-code').innerText = login.code;
    document.getElementById('mc-login-link').href = login.location;
    mcLoginDialog.style.display = 'flex';
}

async function ensureSyncFolders(game) {
    const url = 'special/approot:/Games/' + game;
    let response = await SYNC.makeRequest(url, {
        method: 'PUT',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({folder: {}})
    });

    if (response.status === 409)
        response = await SYNC.makeRequest(url);

    if (!response.ok)
        throw new Error(`Failed to create Sync folder: HTTP ${response.status}: ${response.statusText}`);

    const item = await response.json();

    return item.id;
}

function safariHack() {
    if (!controlChannel) return;

    controlChannel.send(Msg.reinit());
}