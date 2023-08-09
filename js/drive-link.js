import {deltaStream, makeRequest} from "./onedrive.js";
import {wait} from "./streaming-client/src/util.js";

// TODO reduce traffic by using https://learn.microsoft.com/en-us/graph/query-parameters

export class OneDriveSignal {
    async connect(cfg, sessionId, answer, onCandidate) {
        this.onCandidate = onCandidate;
        this.sessionId = sessionId;
        this.answer = answer;
        this.candidateIndex = 0;

        this.submitAnswer().then(r => console.debug('answer submitted'));

        this.fetchCandidates().then(r => console.debug('candidates fetch stopped'));
    }
    
    sessionPath() {
        return 'special/approot:/PCs/' + this.pc + '/connections/' + this.sessionId;
    }

    async submitAnswer() {
        const response = await makeRequest('special/approot:/PCs/'
            + this.pc + '/connections/' + this.sessionId + '.sdp.client:/content', {
            method: 'PUT',
            headers: {'Content-Type': 'text/plain'},
            body: JSON.stringify(this.answer)
        });

        if (!response.ok)
            throw new Error('Failed to submit answer');
    }

    async sendCandidate(candidate) {
        const response = await makeRequest(this.sessionPath() + '/ice/'
            + this.candidateIndex++ + '.ice.client:/content', {
            method: 'PUT',
            headers: {'Content-Type': 'text/plain'},
            body: candidate
        });

        if (!response.ok)
            throw new Error('Failed to submit ICE candidate');
    }

    async fetchCandidates() {
        let shouldCancel = () => this.stopCode !== 0;
        let restartDelay = async (link) => {
            await wait(1000);
            return link;
        };
        await deltaStream(this.sessionPath() + '/ice', async (candidate) => {
            if (!candidate.hasOwnProperty('file')) return;
            if (!candidate.name.endsWith('.ice')) return;
            const downloadUrl = candidate['@microsoft.graph.downloadUrl'];
            if (!downloadUrl) return;
            const candidateResponse = await fetch(downloadUrl);
            if (!candidateResponse.ok)
                console.error('Failed to fetch ICE candidate', candidateResponse.status, candidateResponse.statusText);
            const jsonText = await candidateResponse.text();
            this.onCandidate(jsonText, null);
        }, restartDelay, shouldCancel);
    }

    static async getServerOffer(pc, timeout) {
        let cancelled = false;
        timeout.then(() => cancelled = true);

        const offer = {
            sdp: null,
        };
        let shouldCancel = () => !!offer.sdp || cancelled;
        let restartDelay = async (link) => {
            await wait(1000);
            return link;
        };

        await deltaStream('special/approot:/PCs/' + pc + '/connections', async (candidate) => {
            if (!candidate.hasOwnProperty('file')) return;
            if (!candidate.name.endsWith('.sdp')) return;
            const sdpResponse = await fetch(candidate['@microsoft.graph.downloadUrl']);
            if (sdpResponse.ok) {
                offer.sdp = JSON.parse(await sdpResponse.text());
                offer.session = candidate.name.substring(0, candidate.name.length - '.sdp'.length);
            }
        }, restartDelay, shouldCancel);

        if (offer.sdp === null && cancelled)
            throw new Error('cancelled');

        return offer;
    }

    cfgDefaults(cfg) {
        if (!cfg) cfg = {};
        return structuredClone(cfg);
    }

    getAttemptId() {
        console.warn('getAttemptId stub');
        return 41;
    }

    constructor(pc, onFatal) {
        this.pc = pc;
        this.onFatal = onFatal;
        this.stopCode = 0;
    }

    close(code) {
        this.stopCode = code;
    }
}