import { MY as OneDrive } from "./onedrive.js";
import { GameID } from "./gid.js";

interface IMyGame {
    title: string;
    offers: any[];
}

export class Games {
    static games: Record<string, IMyGame> = {};
}
export async function getGames(pc: string, list: HTMLSelectElement) {
    let json = null;
    try {
        json = await OneDrive.download(`special/approot:/PCs/${pc}.games.json`);
    } catch (e) {
        console.warn('Failed to fetch game list from ' + pc, e);
        return;
    }
    if (json === null)
        return;
    const items = await json.json();
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

