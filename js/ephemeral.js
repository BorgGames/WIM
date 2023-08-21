import { wait } from "./streaming-client/src/util.js";

const API = 'https://borg-ephemeral.azurewebsites.net/ephemeral/';

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
        const response = await fetch(this.endpoint + this.sessionId + '/answer', {
            method: 'PUT',
            headers: {'Content-Type': 'text/plain'},
            body: JSON.stringify(this.answer)
        });

        if (!response.ok)
            throw new Error('Failed to submit answer');
    }

    async sendCandidate(candidate) {
        const response = await fetch(this.endpoint + this.sessionId + '/answerIce', {
            method: 'PUT',
            headers: {'Content-Type': 'text/plain'},
            body: candidate
        });

        if (!response.ok)
            throw new Error('Failed to submit ICE candidate');
    }
    
    static async getNodes(endpoint) {
        endpoint = endpoint || API;
        const response = await fetch(endpoint + 'offers');
        if (!response.ok)
            throw new Error('Failed to fetch nodes');

        return await response.json();
    }

    async fetchCandidates() {
        const seen = new Set();
        while (this.stopCode === 0) {
            const response = await fetch(this.endpoint + this.sessionId);
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

    constructor(endpoint) {
        this.endpoint = endpoint || API;
        this.stopCode = 0;
    }

    close(code) {
        this.stopCode = code;
    }
}