import {OneDriveRunningGames as GameFS} from "./drive-gamefs.js";
import * as util from "./streaming-client/src/util.js";
import {GameID} from "./gid.js";

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
        gamePC.removeEventListener('change', pcChanged);

        const running = document.createElement('div');
        runningUI.innerHTML = '';
        runningUI.appendChild(running);

        let preferred = localStorage.getItem('lastGamePC-' + uri);
        for (const offer of game.offers) {
            const option = document.createElement("option");
            option.value = offer.pc;
            option.dataset.offer = JSON.stringify(offer);
            option.innerText = offer.pc;
            option.defaultSelected = offer.pc === preferred;
            gamePC.appendChild(option);
            const exe = GameID.tryGetExe(offer.Uri);
            loadRunning(running, offer.pc, exe);
        }
        gamePC.disabled = game.offers.length < 2;
        gamePC.addEventListener('change', pcChanged);

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
        const container = document.createElement('fieldset');
        container.className = "game-connect";
        
        const ui = document.createElement('button');
        ui.title = "Click to connect";
        ui.className = "connect"; 
        ui.type = "button";
        ui.dataset.exe = exe;
        ui.dataset.session = session;
        ui.dataset.pc = pc;
        ui.addEventListener('click', connectRequested);

        const thumbnail = document.createElement('img');
        thumbnail.alt = 'Session ' + session;
        thumbnail.className = 'game-stream-thumbnail';
        const placeholder = "img/placeholder.png";
        if (info.hasOwnProperty('image')) {
            thumbnail.src = info.image;
            thumbnail.onerror = () => {
                if (thumbnail.src !== placeholder)
                    thumbnail.src = "img/placeholder.png";
            };
        } else
            thumbnail.src = placeholder;
        ui.appendChild(thumbnail);

        const stop = document.createElement('button');
        stop.innerText = '✖';
        stop.className = 'stop';
        stop.title = 'Stop';
        stop.type = 'button';
        Object.assign(stop.dataset, ui.dataset);
        stop.addEventListener('click', stopRequested);
        ui.appendChild(stop);
        
        container.appendChild(ui);

        pcUI.appendChild(container);
    }
    to.appendChild(pcUI);
}

function gameSelected(e) {
    Launcher.selectGame(e.target.value);
}

function pcChanged(e) {
    let offer = JSON.parse(e.target.options[e.target.selectedIndex].dataset.offer); 
    localStorage.setItem('lastGamePC-' + offer.Uri, offer.pc);
}

function connectRequested(e) {
    e.preventDefault();
    Launcher.launch(Launcher.selectedGame.offers[0], e.currentTarget.dataset.session);
}

function launchRequested(e) {
    Launcher.launch(JSON.parse(gamePC.options[gamePC.selectedIndex].dataset.offer));
}

async function stopRequested(e) {
    e.preventDefault();
    e.stopImmediatePropagation();
    const exe = e.target.dataset.exe;
    const session = e.target.dataset.session;
    const pc = e.target.dataset.pc;
    const node = e.target.closest('fieldset');
    node.disabled = true;

    try {
        await GameFS.stop(pc, exe, session);
        try{
            await GameFS.waitForStop(pc, exe, session, util.timeout(60000));
        } catch (e){
            console.error(e);
        }
        node.remove();
    } catch (e) {
        node.disabled = false;
        throw e;
    }
}
