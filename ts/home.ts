import * as util from "../js/streaming-client/built/util.js";
import * as GOG from "./auth/gog.js";
import * as Factorio from './games/factorio.js';
import * as Minecraft from "./games/mc.js";
import * as Msg from '../js/streaming-client/built/msg.js';
import * as Steam from "./auth/steam.js";

import {Client, IExitEvent} from '../js/streaming-client/built/client.js';
import {ClientAPI} from "./client-api.js";
import {Ephemeral, IBorgNode} from "./ephemeral.js";
import {OneDrivePersistence} from "./drive-persistence.js";
import {Session} from "./session.js";

import {getNetworkStatistics} from "./connectivity-check.js";
import {devMode} from "./dev.js";
import {SYNC} from "./onedrive.js";
import {notify} from "./notifications.js";
import {configureInput} from "./borg-input.js";

const clientApi = new ClientAPI();
const status = document.getElementById('game-status')!;
const videoContainer = document.querySelector('.video-container')!;
const video = <HTMLVideoElement>document.getElementById('stream')!;
const videoBitrate = <HTMLInputElement>document.getElementById('video-bitrate');

const NETWORK = null;

let controlChannel: RTCDataChannel | null = null;

const resume = document.getElementById('video-resume')!;
resume.onclick = () => video.play();

const mcLoginDialog = document.getElementById('mc-login-dialog')!;
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
        const networkText = document.getElementById('network')!;
        networkText.innerText = NETWORK || '';
        const steamLogin = document.getElementById('steam-login')!;
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
            const value = +videoBitrate.value;
            const short = value < 4 ? "low"
                : value < 12 ? "medium"
                    : value < 20 ? "high"
                        : "ultra";
            const qualityText = document.getElementById('video-quality')!;
            qualityText.innerText = videoBitrate.title = `${short} - ${videoBitrate.value} Mbps`;
            localStorage.setItem('encoder_bitrate', videoBitrate.value);
            if (controlChannel)
                controlChannel.send(Msg.config({encoder_bitrate: value}));
        }

        videoBitrate.value = String(parseInt(localStorage.getItem('encoder_bitrate')!) || 2);
        changeBitrate();

        const loginButton = <HTMLButtonElement>document.getElementById('loginButton');
        loginButton.addEventListener('click', () => {
            Home.login(true);
        });
        let loggedIn = await loginPromise;
        if (!loggedIn && SYNC.account)
            loggedIn = await Home.login(true);

        loginButton.disabled = loggedIn;

        if (Steam.loginRedirected())
            await handleSteamLogin();

        if (loggedIn && await GOG.getToken() !== null)
            document.getElementById('gog-div')!.style.display = 'block';
    }

    static async login(loud?: boolean) {
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
        const progress = <HTMLProgressElement>document.getElementById('space')!;
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

    static runClient(nodes: IBorgNode[], persistenceID: string | null | undefined,
                     config: ILaunchConfig, timeout: Promise<any>) {
        const signalFactory = (_: any) => new Ephemeral(null, NETWORK);

        return new Promise(async (resolve) => {
            const clients = new Array<Client>();

            function killOthers(current: Client) {
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
                let stall = 0;
                let stall_reset = 0;
                let auth: GOG.GogAuth | null = null;
                //set up client object with an event callback: gets connect, status, chat, and shutter events
                const client = new Client(clientApi, signalFactory, videoContainer, (event) => {
                    console.log('EVENT', i, event);

                    switch (event.type) {
                        case 'exit':
                            if (auth !== null)
                                auth.destroy();
                            const exitCode = (event as IExitEvent).code;
                            document.removeEventListener('keydown', hotkeys, true);
                            if (exitCode !== Client.StopCodes.CONCURRENT_SESSION)
                                resolve(exitCode);
                            else
                                clients.removeByValue(client);
                            break;
                        case 'stall':
                            if (stall !== 0) break;
                            stall = setTimeout(() => {
                                if (!client.exited())
                                    client.destroy(Client.StopCodes.CONNECTION_TIMEOUT);
                            }, 30000);
                            stall_reset = setTimeout(() => {
                                if (!client.exited() && controlChannel !== null) {
                                    controlChannel.send(Msg.reinit());
                                    stall_reset = 0;
                                }
                            });
                            console.debug('stall started: ', stall);
                            break;
                        case 'frame':
                            if (stall !== 0) {
                                console.debug('stall cleared: ' + stall);
                                clearTimeout(stall);
                                stall = 0;
                            }
                            if (stall_reset !== 0) {
                                console.debug('stall reset cleared: ' + stall_reset);
                                clearTimeout(stall_reset);
                                stall_reset = 0;
                            }
                            break;
                        case 'status':
                            if (client.exitCode === Client.StopCodes.CONCURRENT_SESSION)
                                break;
                            const str = event.msg!.str!;
                            status.innerText = str;
                            console.log(i, str);
                            const resumeRequired = str === 'video suspend';
                            resume.style.display = resumeRequired ? 'inline-block' : 'none';
                            if (resumeRequired)
                                video.autoplay = false;
                            break;
                        case 'chat':
                            notify(event.msg!.str!, 30000);
                            break;
                    }
                }, async (name: string, channel: RTCDataChannel) => {
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
                                SteamLicenses: SYNC.isLoggedIn() ? await Steam.getSignedLicenses() : undefined,
                                GogToken: SYNC.isLoggedIn() ? await GOG.getToken() : undefined,
                                Cml: SYNC.isLoggedIn() ? await Minecraft.getCreds() : undefined,
                            };
                            channel.send("\x15" + JSON.stringify(launch));
                            await Session.waitForCommandRequest(channel);
                            controlChannel = channel;
                            break;
                        case 'persistence':
                            if (SYNC.isLoggedIn() && persistenceID) {
                                const persistence = new OneDrivePersistence(channel, [persistenceID]);
                                console.log('persistence enabled');
                            } else {
                                console.warn('persistence not available');
                            }
                            break;
                        case 'auth':
                            if (SYNC.isLoggedIn()) {
                                auth = new GOG.GogAuth(channel, config.game);
                                console.log('auth enabled');
                            } else {
                                console.warn('auth not available');
                            }
                            break;
                    }
                });
                configureInput(client.input);
                clients.push(client);

                //set up useful hotkeys that call client methods: destroy can also be used to cancel pending connection
                const hotkeys = (event: KeyboardEvent) => {
                    if (client.exited()) {
                        document.removeEventListener('keydown', hotkeys, true);
                        return;
                    }
                    event.preventDefault();

                    if (event.code === 'Backquote' && event.ctrlKey && event.altKey) {
                        client.destroy(0);
                    } else if (event.code === 'Enter' && event.ctrlKey && event.altKey) {
                        util.toggleFullscreen(client.element);
                    } else if (event.code === 'Slash' && event.ctrlKey && event.altKey) {
                        document.getElementById('video-resolution')!.innerText = `${video.videoWidth} x ${video.videoHeight}`;
                        document.body.classList.toggle('video-overlay');
                    }
                };
                document.addEventListener('keydown', hotkeys, true);

                async function run() {
                    try {
                        const info = JSON.parse(offer.peer_connection_offer);
                        const sdp = JSON.parse(info.Offer);

                        const encoder_bitrate = parseInt(localStorage.getItem('encoder_bitrate')!) || 2;

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

    static async launch(config: ILaunchConfig) {
        const timeout = util.timeout(1000 /*s*/ * 60 /*m*/ * 5);

        try {
            if (!config.sessionId)
                config.sessionId = crypto.randomUUID();

            if ((config.game === 'factorio' || config.game === 'minecraft') && !SYNC.isLoggedIn()) {
                if (!await showLoginDialog())
                    return;
            }

            const uri = new URL('borg:games/' + config.game);

            const gameName = config.game === 'minecraft' || config.game.startsWith("minecraft?")
                ? 'Minecraft' : 'Factorio';

            document.body.classList.add('video');

            let persistenceID: string | undefined = undefined;
            if (SYNC.isLoggedIn())
                persistenceID = await ensureSyncFolders(uri);

            switch (config.game) {
                case 'factorio':
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

            if (uri.searchParams.get('trial') === '1')
                notify('Trial mode: 5 minutes', 30000);

            status.innerText = 'looking for a node...';
            const nodes = await Ephemeral.getNodes(null, NETWORK, config.nodeMin, config.nodeMax);
            if (nodes.length === 0)
                throw new Error('No nodes currently available. Try again later.');

            const code = await Home.runClient(nodes, persistenceID, config, timeout);

            if (code !== 0)
                switch (code) {
                    case Client.StopCodes.GENERAL_ERROR:
                        alert(`Exit code: ${code}: ${status.innerText}`);
                        break;
                    default:
                        let message = code instanceof Error
                            ? (code.message || `Unexpected error: ${code}`)
                            : `Exit code: ${code}`;
                        alert(message);
                        break;
                }
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

async function handleSteamLogin() {
    if (!SYNC.isLoggedIn())
        if (!await showLoginDialog())
            return;
    const licenses = await Steam.onLogin();
    if (licenses === null) {
        alert("Steam login failed.");
        return;
    }
    const factorioLicense = licenses.find(l => l.AppID === Factorio.APP_ID || Factorio.REPRESENTATIVE_PACKAGE_IDS.includes(l.PackageID!));
    Factorio.expand();
    if (!factorioLicense)
        alert("Factorio license not found.");
}

export async function showLoginDialog(disableCancel?: boolean) {
    const dialog = document.getElementById('login-dialog')!;
    const cancel = document.getElementById('cancelLogin')!;
    cancel.style.display = !!disableCancel ? 'none' : 'inline-block';
    dialog.style.display = 'flex';
    const promise = new Promise<boolean>(async (resolve) => {
        const doLogin = async () => {
            try {
                resolve(await Home.login(true));
            } catch (e) {
                resolve(false);
            }
        };
        // if (SYNC.account)
        //     await doLogin();
        document.getElementById('onedriveLogin')!.onclick = doLogin;
        cancel.onclick = () => resolve(false);
    });
    try {
        return await promise;
    } finally {
        dialog.style.display = 'none';
    }
}

function showMinecraftLogin(login: Minecraft.IMinecraftLoginInit) {
    document.getElementById('mc-code')!.innerText = login.code;
    const loginLink = <HTMLAnchorElement>document.getElementById('mc-login-link');
    loginLink.href = login.location;
    mcLoginDialog.style.display = 'flex';
}

async function ensureSyncFolders(game: URL): Promise<string> {
    let gamePathParts = game.pathname.split('/').slice(1);
    if (gamePathParts.length === 0)
        throw new Error('Invalid game path');

    let gameDir = gamePathParts[0];
    let platform = null;

    if (gamePathParts.length === 1) {
        if (gameDir == 'minecraft')
            gameDir = 'Minecraft';
        else if (gameDir == 'factorio')
            gameDir = 'Factorio';
    } else {
        switch (gameDir) {
            case 'gog': case 'GOG':
                gameDir = 'GOG/' + gamePathParts[1];
                platform = 'GOG';
                break;
            default:
                throw new Error('Invalid game path');
        }
    }

    let url = 'special/approot:/Games/' + gameDir;
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

interface ILaunchConfig {
    game: string;
    nodeMin: string;
    nodeMax: string;
    sessionId?: string;
}