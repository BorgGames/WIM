import {AudioPlayer} from '../js/streaming-client/built/audio.js';
import {unpack} from "../js/streaming-client/built/msg.js";
import {Msg} from "../js/streaming-client/built/enum.js";

AudioPlayer.OPUS_WASM = '/js/streaming-client/built/wasm/opus.wasm';

export class Session {
    static async waitForCommandRequest(channel: RTCDataChannel) {
        return new Promise<void>((resolve, reject) => {
            function listener(event: MessageEvent<ArrayBuffer>) {
                channel.removeEventListener('message', listener);
                if (event.data.byteLength !== 1) {
                    try {
                        const status = unpack(event.data);
                        switch (status.type) {
                            case Msg.Status:
                            case Msg.Chat:
                                reject(status.str);
                                break;
                            default:
                                throw new Error("unexpected");
                        }
                    } catch (e) {
                        const strBuf = new Int8Array(event.data);
                        try {
                            reject("unexpected: " + new TextDecoder().decode(strBuf));
                        } catch (e) {
                            reject({msg: "unexpected", data: event.data});
                        }
                    }
                } else {
                    const msg = new Uint8Array(event.data)[0];
                    if (msg === 42)
                        resolve();
                    else
                        reject({msg: "unexpected", data: msg});
                }
            }

            channel.addEventListener('message', listener);
        });
    }
}