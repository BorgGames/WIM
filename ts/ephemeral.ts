import { wait } from "../js/streaming-client/built/util.js";
import { devMode } from "./dev.js";

const API = devMode() ? 'https://localhost:7173/ephemeral/' : "https://borg-ephemeral.azurewebsites.net/ephemeral/";

export interface IBorgNode {
    session_id: string;
    /** JSON stringified RTCSessionDescription */
    peer_connection_offer: string;
}

export class Ephemeral {
    sessionId?: string;
    secret?: string;
    endpoint: string;
    stopCode: number;
    answer?: RTCLocalSessionDescriptionInit;
    private onCandidate: any;

    async connect(cfg: any, sessionId: string, answer: RTCLocalSessionDescriptionInit, onCandidate: any) {
        this.onCandidate = onCandidate;
        this.sessionId = sessionId;
        this.answer = answer;

        await this.submitAnswer();

        console.debug('answer submitted');

        this.fetchCandidates().then(() => console.debug('candidates fetch stopped'));
    }

    async submitAnswer() {
        const headers = this.makeHeaders();
        const response = await fetch(this.endpoint + this.sessionId + '/answer', {
            method: 'PUT',
            headers: headers,
            body: JSON.stringify(this.answer)
        });

        if (!response.ok)
            throw new Error('Failed to submit answer');
    }

    async sendCandidate(candidateJSON: string) {
        const headers = this.makeHeaders();
        const response = await fetch(this.endpoint + this.sessionId + '/answerIce', {
            method: 'PUT',
            headers: headers,
            body: candidateJSON
        });

        if (!response.ok)
            throw new Error('Failed to submit ICE candidate');
    }

    static async getNodes(endpoint?: string | null, secret?: string | null,
                          verMin?: string, verMax?: string,
                          cancel?: any): Promise<IBorgNode[]> {
        endpoint = endpoint || API;
        const options: RequestInit = {};
        if (secret)
            options.headers = {'Secret': secret};
        let uri = endpoint + 'offers';
        const search = <Record<string, string>>{};
        if (verMin !== undefined)
            search.verMin = verMin;
        if (verMax !== undefined)
            search.verMax = verMax;
        const filter = new URLSearchParams(search).toString();
        if (filter)
            uri += '?' + filter;
        const response = await fetch(uri, options);
        if (!response.ok)
            throw new Error('Failed to fetch nodes');

        return await response.json();
    }

    async fetchCandidates() {
        const seen = new Set();
        const options: RequestInit = {};
        if (this.secret)
            options.headers = {'Secret': this.secret};
        while (this.stopCode === 0) {
            const response = await fetch(this.endpoint + this.sessionId, options);
            if (!response.ok)
                throw new Error('Failed to fetch ICE candidates');

            const session = await response.json();
            let done = false;
            for (const candidate of session.offerIce) {
                if (seen.has(candidate))
                    continue;
                await this.onCandidate(candidate, null);
                seen.add(candidate);
                const obj = JSON.parse(candidate);
                if (obj && !obj.candidate) {
                    console.log('all candidates received');
                    done = true;
                }
            }
            if (done)
                return;

            await wait(1000);
        }
    }

    cfgDefaults(cfg: any) {
        if (!cfg) cfg = {};
        return structuredClone(cfg);
    }

    getAttemptId() {
        console.warn('getAttemptId stub');
        return "41";
    }

    private makeHeaders() {
        const headers: { 'Content-Type': string, Secret?: string } = { 'Content-Type': 'text/plain' };
        if (this.secret)
            headers.Secret = this.secret;
        return headers;
    }

    constructor(endpoint?: string | null, secret?: string | null) {
        this.endpoint = endpoint || API;
        if (secret)
            this.secret = secret;
        this.stopCode = 0;
    }

    close(code: number) {
        this.stopCode = code;
    }
}