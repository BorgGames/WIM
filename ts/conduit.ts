import {Ephemeral, IBorgNode} from "./ephemeral.js";
import {PubSub} from "./util.js";
import {RTC} from "../js/streaming-client/built/rtc.js";
import {timeout} from "../js/streaming-client/built/util.js";

const jsonrpc = "2.0";
const decoder = new TextDecoder();
const cert = await RTCPeerConnection.generateCertificate({
    name: 'RSASSA-PKCS1-v1_5',
    hash: 'SHA-256',
    modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1])
} as RsaHashedKeyGenParams);

export class ConduitService {
    channel: RTCDataChannel;
    rtc: RTC;
    events: PubSub;
    private id: number;
    private calls: {[id: number]: {call: any, resolve: any, reject: any, id: number}};
    private expectedLength?: number;
    private reconstructedMessage?: string;

    constructor(rtc: RTC, channel: RTCDataChannel) {
        this.rtc = rtc;
        this.events = new PubSub();
        this.channel = channel;
        this.channel.addEventListener('message', (e: MessageEvent) => this.onResponse(e.data));
        this.channel.addEventListener('close', e => this.close('channel closed'));
        this.rtc.rtc.addEventListener('connectionstatechange', (e: Event) => {
            switch (this.rtc.rtc.connectionState) {
            case "disconnected": case "failed": case "closed":
                this.close(this.rtc.rtc.connectionState);
                return;
            }
        });
        this.calls = {};
        this.id = 0;
    }

    onResponse(data: any) {
        if (this.expectedLength && data.length < this.expectedLength) {
            console.error('ConduitService: incomplete response: ', data);
            return;
        }
        let msg = decoder.decode(data);
        console.debug('ConduitService.onResponse', msg);
        if (msg.startsWith('Content-Length: ')) {
            const idx = msg.indexOf('\r\n\r\n');
            if (idx === -1){
                console.error('ConduitService: bad header: ', msg);
                return;
            }
            const len = parseInt(msg.substring(16, idx));
            msg = msg.substring(idx + 4);
            if (msg === "" && len > 0) {
                this.expectedLength = len;
                this.reconstructedMessage = "";
                return;
            }

            this.expectedLength = undefined;
        }
        // TODO: reconstruct msg if it's split
        let response = null;
        try {
            response = JSON.parse(msg);
        } catch (e) {
            console.error('ConduitService: bad response: ', msg);
            return;
        }
        const id = response.id;
        const call = this.calls[id];
        delete this.calls[id];
        if (response.error)
            call.reject(response.error);
        else
            call.resolve(response.result);
    }

    call<T>(method: string, params: any[] | Record<string, any>) {
        const id = this.id++;
        return new Promise<T>((resolve, reject) => {
            const call = {jsonrpc, id, method, params};
            this.calls[id] = {call, resolve, reject, id};
            let request = JSON.stringify(call);
            request = `Content-Length: ${request.length}\r\n\r\n${request}`
            this.channel.send(request);
        });
    }

    close(reason: string) {
        this.events.publish('close', reason);
        console.debug('ConduitService.close', reason);
        this.rtc.close();
    }

    static async connect(serviceName: string, verMin?: string, verMax?: string, cancel?: Promise<any>) {
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

async function _connect(serviceName: string, offer: IBorgNode, cancel?: Promise<any>) {
    let cancelled = false;
    if (cancel)
        cancel.catch(() => cancelled = true);

    const info = JSON.parse(offer.peer_connection_offer);
    const serviceOffer = JSON.parse(info.Offer);
    const sessionId = offer.session_id;

    const signal = new Ephemeral(null, serviceName);

    const cfg = signal.cfgDefaults({});

    const onRTCCandidate = (candidateJSON: string) => {
        signal.sendCandidate(candidateJSON);
    };

    return await new Promise<ConduitService>(async (resolve, reject) => {
        const rtc = new RTC(serviceOffer, signal.getAttemptId(), onRTCCandidate, [], [cert]);

        rtc.rtc.addEventListener('datachannel', async (e: RTCDataChannelEvent) => {
            const channel = e.channel;
            console.log("conduit datachannel", channel.label, channel.id, channel.readyState);
            resolve(new ConduitService(rtc, channel));
        });
        rtc.rtc.addEventListener('connectionstatechange', (e: Event) => {
            console.log("conduit connectionstatechange", rtc.rtc.connectionState);
            switch (rtc.rtc.connectionState) {
                case "disconnected": case "failed": case "closed":
                    reject(rtc.rtc.connectionState);
                    rtc.close();
                    return;
            }
        });

        const myAnswer = await rtc.createAnswer();

        signal.connect(cfg, sessionId, myAnswer, (candidate: string, theirCreds: any) => {
            rtc.setRemoteCandidate(candidate, theirCreds);
        });
    });
}