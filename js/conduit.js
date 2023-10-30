import {Ephemeral} from "./ephemeral.js";
import {PubSub} from "./util.js";
import {RTC} from "./streaming-client/src/rtc.js";
import {timeout} from "./streaming-client/src/util.js";

const jsonrpc = "2.0";
const decoder = new TextDecoder();
const cert = await RTCPeerConnection.generateCertificate({
    name: 'RSASSA-PKCS1-v1_5',
    hash: 'SHA-256',
    modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1])
});

export class ConduitService {
    constructor(rtc, channel) {
        this.rtc = rtc;
        this.events = new PubSub();
        this.channel = channel;
        this.channel.addEventListener('message', e => this.onResponse(e.data));
        this.channel.addEventListener('close', e => this.close('channel closed'));
        this.rtc.rtc.addEventListener('connectionstatechange', e => {
            switch (this.rtc.rtc.connectionState) {
            case "disconnected": case "failed": case "closed":
                this.close(this.rtc.rtc.connectionState);
                return;
            }
        });
        this.calls = {};
        this.id = 0;
    }

    onResponse(data) {
        let msg = decoder.decode(data);
        if (msg.startsWith('Content-Length: ')) {
            const idx = msg.indexOf('\r\n\r\n');
            if (idx === -1){
                console.error('ConduitService: bad header: ', msg);
                return;
            }
            msg = msg.substring(idx + 4);
        }
        const response = JSON.parse(msg);
        const id = response.id;
        const call = this.calls[id];
        delete this.calls[id];
        if (response.error)
            call.reject(response.error);
        else
            call.resolve(response.result);
    }

    call(method, params) {
        const id = this.id++;
        return new Promise((resolve, reject) => {
            const call = {jsonrpc, id, method, params};
            this.calls[id] = {call, resolve, reject, id};
            let request = JSON.stringify(call);
            request = `Content-Length: ${request.length}\r\n\r\n${request}`
            this.channel.send(request);
        });
    }

    close(reason) {
        this.events.publish('close', reason);
        console.debug('ConduitService.close', reason);
        this.rtc.close();
    }

    static async connect(serviceName, verMin, verMax, cancel) {
        let cancelled = false;
        if (cancel)
            cancel.catch(() => cancelled = true);

        while (!cancelled) {
            const nodes = await Ephemeral.getNodes(null, serviceName, verMin, verMax, cancel);
            for (const offer of nodes) {
                try {
                    return _connect(serviceName, offer, cancel);
                } catch (e) {
                    console.error('ConduitService.connect', e);
                }
            }
            try {
                await timeout(nodes.length === 0 ? 1000 : 30);
            } catch (e){}
        }

        return null;
    }
}

async function _connect(serviceName, offer, cancel) {
    let cancelled = false;
    if (cancel)
        cancel.catch(() => cancelled = true);

    const info = JSON.parse(offer.peer_connection_offer);
    const serviceOffer = JSON.parse(info.Offer);
    const sessionId = offer.session_id;

    const signal = new Ephemeral(null, serviceName);

    const cfg = signal.cfgDefaults({});

    const onRTCCandidate = (candidate) => {
        signal.sendCandidate(candidate);
    };

    return await new Promise(async (resolve, reject) => {
        const rtc = new RTC(serviceOffer, signal.getAttemptId(), onRTCCandidate, [], [cert]);

        rtc.rtc.addEventListener('datachannel', async e => {
            const channel = e.channel;
            console.log("conduit datachannel", channel.label, channel.id, channel.readyState);
            resolve(new ConduitService(rtc, channel));
        });
        rtc.rtc.addEventListener('connectionstatechange', e => {
            console.log("conduit connectionstatechange", rtc.rtc.connectionState);
            switch (rtc.rtc.connectionState) {
                case "disconnected": case "failed": case "closed":
                    reject(rtc.rtc.connectionState);
                    rtc.close();
                    return;
            }
        });

        const myAnswer = await rtc.createAnswer();

        signal.connect(cfg, sessionId, myAnswer, (candidate, theirCreds) => {
            rtc.setRemoteCandidate(candidate, theirCreds);
        });
    });
}