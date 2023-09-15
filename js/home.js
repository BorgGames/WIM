import {Client} from './streaming-client/src/client.js';
import {ClientAPI} from "./client-api.js";
import {Ephemeral} from "./ephemeral.js";
import {Session} from "./session.js";

import * as util from "./streaming-client/src/util.js";
import * as Msg from './streaming-client/src/msg.js';
import {getNetworkStatistics} from "./connectivity-check.js";


const clientApi = new ClientAPI();
const status = document.getElementById('game-status');
const video = document.getElementById('stream');

export class Home {
    static runClient(nodes, timeout) {
        const signalFactory = (onFatal) => new Ephemeral();

        return new Promise(async (resolve) => {
            const clients = [];
            function killOthers(current){
                console.log('we have a winner!');
                for(let j = 0; j < clients.length; j++){
                    if (clients[j] !== current)
                        clients[j].destroy(Client.StopCodes.CONCURRENT_SESSION);
                }
                clients.length = 1;
                clients[0] = current;
            }
            for(let i = 0; i < nodes.length; i++) {
                const offer = nodes[i];
                //set up client object with an event callback: gets connect, status, chat, and shutter events
                const client = new Client(clientApi, signalFactory, video, (event) => {
                    console.log('EVENT', event);

                    switch (event.type) {
                        case 'exit':
                            document.removeEventListener('keydown', hotkeys, true);
                            if (event.code !== Client.StopCodes.CONCURRENT_SESSION)
                                resolve(event.code);
                            else
                                clients.removeByValue(client);
                            break;
                        case 'status':
                            status.innerText = event.msg;
                            break;
                    }
                }, async (name, channel) => {
                    switch (name) {
                        case 'control':
                            await Session.waitForCommandRequest(channel);
                            const stats = await getNetworkStatistics(channel);
                            await Session.waitForCommandRequest(channel);
                            killOthers(client);
                            channel.send(Msg.launch());
                            await Session.waitForCommandRequest(channel);
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
                    }
                };
                document.addEventListener('keydown', hotkeys, true);

                async function run(){
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

    static async launch(sessionId) {
        document.body.classList.add('video');

        const timeout = util.timeout(1000 /*s*/ * 60 /*m*/ * 3);

        try {
            if (!sessionId)
                sessionId = crypto.randomUUID();
            status.innerText = 'looking for a node...';
            const nodes = await Ephemeral.getNodes();
            if (nodes.length === 0)
                throw new Error('No nodes currently available. Try again later.');

            const code = await Home.runClient(nodes, timeout);

            if (code !== 0)
                alert(`Exit code: ${code}`);
        } catch (e) {
            console.error(e);
            alert(e);
        } finally {
            document.body.classList.remove('video');

            video.src = '';
            video.load();
        }
    }
}