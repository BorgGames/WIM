import { deltaStream, makeRequest } from "./onedrive.js";
import { wait } from "./streaming-client/src/util.js";

export class OneDriveRunningGames {
    static async launch(pc, gameID, sessionID, timeout) {
        let cancelled = false;
        timeout.catch(() => cancelled = true);
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
            await wait(5000);
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
    
    static async isRunning(pc, gameID, sessionID, timeout) {
        const running = await OneDriveRunningGames.getRunning(pc, gameID, timeout);
        return running && running.hasOwnProperty(sessionID);
    }
    
    static async assertRunning(pc, gameID, sessionID, timeout) {
        const isRunning = await OneDriveRunningGames.isRunning(pc, gameID, sessionID, timeout);
        if (!isRunning)
            throw new Error('Game exited');
    }

    static async getRunning(pc, gameID, timeout) {
        if (gameID.indexOf('/') !== -1)
            throw new Error('Invalid game ID: ' + gameID);
        let cancelled = false;
        timeout.catch(() => cancelled = true);
        const gamePath = 'special/approot:/PCs/' + pc + '/running/' + gameID;
        const response = await makeRequest(gamePath
            + ':/children?filter=file ne null and (endswith(name,\'.game\') or endswith(name, \'.jpg\'))');

        if (response.status === 404)
            return null;

        if (response.status !== 200)
            throw new Error('Failed to request game launch');

        const items = await response.json();
        const result = {};
        for (const item of items.value) {
            const session = item.name.substring(0, item.name.lastIndexOf('.'));
            if (!result.hasOwnProperty(session))
                result[session] = {};
            if (item.name.endsWith('.jpg'))
                result[session].image = item['@microsoft.graph.downloadUrl'];
            if (item.name.endsWith('.game'))
                result[session].running = true;
        }
        for (const [session, info] of Object.entries(result)) {
            if (!info.hasOwnProperty('running'))
                delete result[session];
        }
        return result;
    }
}