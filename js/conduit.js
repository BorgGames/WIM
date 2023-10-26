import {Ephemeral} from "./ephemeral.js";
import {RTC} from "./streaming-client/src/rtc.js";

export class ConduitService {
    static async connect(serviceName, verMin, verMax, cancel) {
        let cancelled = false;
        if (cancel)
            cancel.catch(() => cancelled = true);

        while (!cancelled) {
            const nodes = await Ephemeral.getNodes(null, serviceName, verMin, verMax, cancel);
            for (const offer of nodes) {
                try {
                    return _connect(offer, cancel);
                } catch (e) {
                    console.error('ConduitService.connect', e);
                }
            }
        }
    }
}

async function _connect(offer, cancel) {
    let cancelled = false;
    if (cancel)
        cancel.catch(() => cancelled = true);

    const info = JSON.parse(offer.peer_connection_offer);
    const serviceOffer = JSON.parse(info.Offer);
    const sessionId = offer.sessionId;

    const signal = undefined;

    const onRTCCandidate = (candidate) => {
        this.signal.sendCandidate(candidate);
    };

    const rtc = new RTC(serviceOffer, signal.getAttemptId(), onRTCCandidate);

    rtc.rtc.addEventListener('datachannel', async e => {
        const channel = e.channel;
        console.log("conduit datachannel", channel.label, channel.id, channel.readyState);
        resolve(new ConduitService(rtc, channel));
    });
}