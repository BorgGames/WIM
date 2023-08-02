import { deltaStream, makeRequest } from "./onedrive.js";
import { wait } from "./streaming-client/src/util.js";

export class OneDriveSignal {
    async connect(cfg, sessionId, answer, onCandidate) {
        this.onCandidate = onCandidate;
        this.sessionId = sessionId;
        this.answer = answer;
        this.candidateIndex = 0;

        this.submitAnswer();

        this.fetchCandidates();
    }

    async submitAnswer() {
        const response = await makeRequest('special/approot:/PCs/'
            + this.pc + '/' + this.sessionId + '.sdp.client:/content', {
            method: 'PUT',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify(this.answer)
        });

        if (!response.ok)
            throw new Error('Failed to submit answer');
    }

    async sendCandidate(candidate) {
        const response = await makeRequest('special/approot:/PCs/'
            + this.pc + '/' + this.sessionId + this.candidateIndex++ + '.ice.client:/content', {
            method: 'PUT',
            headers: { 'Content-Type': 'text/plain' },
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
        await deltaStream('special/approot:/PCs/' + this.pc, async (candidate) => {
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

    static async postAssignment(pc, gameID, sessionId, cancellation) {
        cancellation = cancellation || { cancel: false };
        const response = await makeRequest('special/approot:/PCs/' + pc + '/'
            + sessionId + '.ass.client:/content', {
            method: 'PUT',
            headers: { 'Content-Type': 'text/plain' },
            body: '' + gameID
        });

        if (response.status !== 201)
            throw new Error('Failed to create assignment file');

        var serverSdp = null;
        let shouldCancel = () => !!serverSdp || cancellation.cancel;
        let restartDelay = async (link) => {
            await wait(1000);
            return link;
        };
        const sdpNameUpper = pc.toUpperCase() + ".SDP";

        await deltaStream('special/approot:/PCs/' + pc, async (candidate) => {
            if (!candidate.hasOwnProperty('file')) return;
            if (candidate.name.toUpperCase() !== sdpNameUpper) return;
            const sdpResponse = await fetch(candidate['@microsoft.graph.downloadUrl']);
            if (sdpResponse.ok) {
                serverSdp = await sdpResponse.text();
                return;
            }
            throw new Error('Failed to retrieve server SDP');
        }, restartDelay, shouldCancel);

        if (serverSdp === null && cancellation.cancel)
            throw new Error('postAssignment cancelled');

        return serverSdp;
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