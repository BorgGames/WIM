import {wait} from "./streaming-client/src/util.js";

const container = document.getElementById('notifications');

export async function notify(message, timeout_ms) {
    const notification = document.createElement('div');
    notification.className = 'notification';
    notification.textContent = message;
    container.appendChild(notification);
    notification.addEventListener('click', () => {
        notification.classList.remove('show');
    });

    await wait(1);

    notification.classList.add('show');

    if (timeout_ms) {
        await wait(timeout_ms);
        notification.classList.remove('show');
        await wait(1000);
        notification.remove();
    }
}
