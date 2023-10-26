import { wait } from "./streaming-client/src/util.js";
import { devMode } from "./dev.js";

const API = devMode() ? 'https://localhost:7173/ephemeral/' : "https://borg-ephemeral.azurewebsites.net/ephemeral/";

export class Ephemeral {
    async connect(cfg, sessionId, answer, onCandidate) {
        this.onCandidate = onCandidate;
        this.sessionId = sessionId;
        this.answer = answer;

        await this.submitAnswer();

        console.debug('answer submitted');

        this.fetchCandidates().then(() => console.debug('candidates fetch stopped'));
    }

    async submitAnswer() {
        const headers = {'Content-Type': 'text/plain'};
        if (this.secret)
            headers.Secret = this.secret;
        const response = await fetch(this.endpoint + this.sessionId + '/answer', {
            method: 'PUT',
            headers: headers,
            body: JSON.stringify(this.answer)
        });

        if (!response.ok)
            throw new Error('Failed to submit answer');
    }

    async sendCandidate(candidate) {
        const headers = {'Content-Type': 'text/plain'};
        if (this.secret)
            headers.Secret = this.secret;
        const response = await fetch(this.endpoint + this.sessionId + '/answerIce', {
            method: 'PUT',
            headers: headers,
            body: candidate
        });

        if (!response.ok)
            throw new Error('Failed to submit ICE candidate');
    }

    static async getNodes(endpoint, secret, verMin, verMax) {
        endpoint = endpoint || API;
        const options = {};
        if (secret)
            options.headers = {'Secret': secret};
        let uri = endpoint + 'offers';
        const search = {};
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
        const options = {};
        if (this.secret)
            options.headers = {'Secret': this.secret};
        while (this.stopCode === 0) {
            const response = await fetch(this.endpoint + this.sessionId, options);
            if (!response.ok)
                throw new Error('Failed to fetch ICE candidates');

            const session = await response.json();
            for (const candidate of session.offerIce) {
                if (seen.has(candidate))
                    continue;
                await this.onCandidate(candidate, null);
                seen.add(candidate);
            }

            await wait(1000);
        }
    }

    cfgDefaults(cfg) {
        if (!cfg) cfg = {};
        return structuredClone(cfg);
    }

    getAttemptId() {
        console.warn('getAttemptId stub');
        return 41;
    }

    constructor(endpoint, secret) {
        this.endpoint = endpoint || API;
        if (secret)
            this.secret = secret;
        this.stopCode = 0;
    }

    close(code) {
        this.stopCode = code;
    }
}