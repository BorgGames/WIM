import * as util from "../js/streaming-client/built/util.js";
import * as Msg from '../js/streaming-client/built/msg.js';

import {Client, IExitEvent} from '../js/streaming-client/built/client.js';
import {ClientAPI} from "./client-api.js";
import {Ephemeral, IBorgNode, INodeFilter} from "./ephemeral.js";
import {Session} from "./session.js";

import {getNetworkStatistics} from "./connectivity-check.js";
import {devMode} from "./dev.js";
import {notify} from "./notifications.js";
import {configureInput} from "./borg-input.js";

const clientApi = new ClientAPI();
const status = document.getElementById('game-status')!;
const videoContainer = document.querySelector('.video-container')!;
const video = <HTMLVideoElement>document.getElementById('stream')!;
const videoBitrate = <HTMLInputElement>document.getElementById('video-bitrate');

const NETWORK = new URLSearchParams(window.location.search).get('interlink');

let controlChannel: RTCDataChannel | null = null;

const resume = document.getElementById('video-resume')!;
resume.onclick = () => video.play();

export class Home {
    static async init() {
        const networkText = document.getElementById('network')!;
        networkText.innerText = NETWORK || '';

        const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
        if (isSafari)
            setInterval(safariHack, 3000);
        videoBitrate.addEventListener('input', changeBitrate);

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
                //set up client object with an event callback: gets connect, status, chat, and shutter events
                const client = new Client(clientApi, signalFactory, videoContainer, (event) => {
                    console.log('EVENT', i, event);

                    switch (event.type) {
                        case 'exit':
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
                            }, 180000);
                            stall_reset = setTimeout(() => {
                                if (!client.exited() && controlChannel !== null) {
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
                                Launch: "borg:demo/" + config.demo,
                                PersistenceRoot: undefined,
                                SteamLicenses: undefined,
                                GogToken: undefined,
                                Cml: undefined,
                            };
                            channel.send("\x15" + JSON.stringify(launch));
                            await Session.waitForCommandRequest(channel);
                            controlChannel = channel;
                            break;
                        case 'persistence':
                            console.warn('persistence not available');
                            break;
                        case 'auth':
                            console.warn('auth not available');
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

            const uri = new URL('borg:demo/' + config.demo);

            document.body.classList.add('video');

            let persistenceID: string | undefined = undefined;

            if (uri.searchParams.get('trial') === '1')
                notify('Trial mode: 5 minutes', 30000);

            status.innerText = 'looking for a node...';
            const nodes = await Ephemeral.getNodes(null, NETWORK, config.nodeFilter);
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

function safariHack() {
    if (!controlChannel) return;

    controlChannel.send(Msg.reinit());
}

interface ILaunchConfig {
    demo: string;
    nodeFilter?: INodeFilter,
    sessionId?: string;
}