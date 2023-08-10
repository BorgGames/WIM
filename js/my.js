import * as OneDrive from "./onedrive.js";
import { GameID } from "./gid.js";

export class Games {
    static games = {};
}
export async function getGames(pc, list) {
    const response = await OneDrive.makeRequest(`special/approot:/PCs/${pc}.games.json:/content`);
    const items = await response.json();
    for (const item of items) {
        item.pc = pc;
        const exe = GameID.tryGetExe(item.Uri);
        if (exe === null) {
            console.warn("Unsupported uri: " + item.Uri);
            continue;
        }
        if (Games.games.hasOwnProperty(item.Uri)) {
            Games.games[item.Uri].offers.push(item);
            continue;
        }
        Games.games[item.Uri] = {
            offers: [item],
            title: item.Title,
        };

        const gameItem = document.createElement('option');
        gameItem.innerText = item.Title;
        gameItem.value = item.Uri;
        list.size = list.size + 1;
        list.appendChild(gameItem);
    }
}

export async function waitForCommandRequest(channel) {
    return new Promise((resolve, reject) => {
        function listener(event) {
            channel.removeEventListener('message', listener);
            if (event.data.byteLength !== 1)
                reject({ msg: "unexpected", data: event.data });
            else {
                const msg = new Uint8Array(event.data)[0];
                if (msg === 42)
                    resolve();
                else
                    reject({ msg: "unexpected", data: msg });
            }
        }

        channel.addEventListener('message', listener);
    });
}