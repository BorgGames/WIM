const gameList = document.getElementById('game-list');
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
        while(gamePC.options.length > 0) {
            gamePC.options[0].remove();
         }
        for(const offer of game.offers){
            const option = document.createElement("option");
            option.value = offer.pc;
            option.innerText = game.offers[0].pc;
            gamePC.appendChild(option);
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

function gameSelected(e) {
    Launcher.selectGame(e.target.value);
}

function launchRequested(e) {
    Launcher.launch(Launcher.selectedGame.offers[0]);
}
