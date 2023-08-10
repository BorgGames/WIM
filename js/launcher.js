import { OneDriveRunningGames as GameFS } from "./drive-gamefs.js";
import * as util from "./streaming-client/src/util.js";
import { GameID } from "./gid.js";

const gameList = document.getElementById('game-list');
const details = document.getElementById('game-details');
const titleUI = document.getElementById('game-title');
const launchButton = document.getElementById('launch-button');
const gamePC = document.getElementById('game-pc');
const runningUI = document.getElementById('game-running');

export class Launcher {
    static async selectGame(uri) {
        if (uri === null) {
            details.style.display = 'none';
            Launcher.selectedGame = null;
            return;
        }

        details.style.display = 'block';
        const game = Launcher.games[uri];
        titleUI.innerText = game.title;
        while (gamePC.options.length > 0) {
            gamePC.options[0].remove();
        }

        const running = document.createElement('div');
        runningUI.innerHTML = '';
        runningUI.appendChild(running);

        for (const offer of game.offers) {
            const option = document.createElement("option");
            option.value = offer.pc;
            option.innerText = offer.pc;
            gamePC.appendChild(option);
            const exe = GameID.tryGetExe(offer.Uri);
            loadRunning(running, offer.pc, exe);
        }
        gamePC.disabled = game.offers.length < 2;

        Launcher.selectedGame = game;
    }

    static initialize(games) {
        Launcher.games = games;
        gameList.addEventListener('change', gameSelected);
        launchButton.addEventListener('click', launchRequested)
    }
}

async function loadRunning(to, pc, exe) {
    const timeout = util.timeout(3000);
    const instances = Object.entries(await GameFS.getRunning(pc, exe, timeout));

    if (instances.length === 0)
        return;

    const pcUI = document.createElement('div');
    const head = document.createElement('h4');
    head.innerText = pc;
    pcUI.appendChild(head);
    for (const [session, info] of instances) {
        const ui = document.createElement('a');
        ui.title = "Click to connect";
        ui.href = `#pc=${pc}&id=${session}&game=${exe}`;
        const thumbnail = document.createElement('img');
        thumbnail.alt = 'Session ' + session;
        thumbnail.classList.add('game-stream-thumbnail');
        if (info.hasOwnProperty('image'))
            thumbnail.src = info.image;
        else
            thumbnail.src = "img/placeholder.png";
        ui.appendChild(thumbnail);
        pcUI.appendChild(ui);
    }
    to.appendChild(pcUI);
}

function gameSelected(e) {
    Launcher.selectGame(e.target.value);
}

function launchRequested(e) {
    Launcher.launch(Launcher.selectedGame.offers[0]);
}
