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