const details = document.getElementById('game-details');
const titleUI = document.getElementById('game-title');
const launchButton = document.getElementById('launch-button');
const gamePC = document.getElementById('game-pc');

export class Launcher {
    static selectGame(uri) {
        if (uri === null) {
            details.style.display = 'none';
            Launcher.selectedGame = null;
            return;
        }

        details.style.display = 'block';
        const game = Launcher.games[uri];
        titleUI.innerText = game.title;
        gamePC.innerText = game.offers[0].pc;
        Launcher.selectedGame = game;
    }

    static initialize(games) {
        Launcher.games = games;
        details.addEventListener('change', gameSelected);
        launchButton.addEventListener('click', launchRequested)
    }
}

function gameSelected(e) {
    Launcher.selectGame(e.target.value);
}

function launchRequested(e) {
    Launcher.launch(Launcher.selectedGame.offers[0]);
}
