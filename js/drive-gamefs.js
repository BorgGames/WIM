import { deltaStream, makeRequest } from "./onedrive.js";
import { wait } from "./streaming-client/src/util.js";

export class OneDriveRunningGames {
    static async launch(pc, gameID, sessionID, timeout) {
        let cancelled = false;
        timeout.then(() => cancelled = true);
        const gamePath = 'special/approot:/PCs/' + pc + '/running/' + gameID;
        const sessionPath = gamePath + '/' + sessionID;
        const response = await makeRequest(sessionPath + '.game:/content', {
            method: 'PUT',
            headers: { 'Content-Type': 'text/plain' },
            body: '' + gameID
        });

        if (response.status !== 201)
            throw new Error('Failed to request game launch');

        var result = null;
        let shouldCancel = () => !!result || cancelled;
        let restartDelay = async (link) => {
            await wait(1000);
            return link;
        };

        const responsePath = sessionPath + '.launch';
        await deltaStream(gamePath, async (candidate) => {
            if (!candidate.hasOwnProperty('file')) return;
            if (candidate.name !== sessionID + '.launch') return;
            const launchResponse = await fetch(candidate['@microsoft.graph.downloadUrl']);
            if (!launchResponse.ok)
                throw new Error('Failed to fetch launch response');

            const responseText = await launchResponse.text();
            if (responseText === 'OK') {
                result = responseText;
            } else {
                throw new Error('Failed to launch game: ' + responseText);
            }
        }, restartDelay, shouldCancel);

        if (result === null && cancelled)
            throw new Error('game launch cancelled');

        return result;
    }
}