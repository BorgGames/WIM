export class CancellationToken {
    constructor() {
        this.canceled = false;
    }

    cancel() {
        this.canceled = true;
    }
}

export class PubSub {
    constructor() {
        this.subs = {}
    }

    subscribe(channel, sub) {
        this.subs[channel] = this.subs[channel] || [];
        this.subs[channel].push(sub);
    }

    publish(channel, ...args) {
        (this.subs[channel] || []).forEach(sub => sub(...args));
    }
}

export async function promiseOr(promises, cancelRace) {
    return new Promise((resolve, reject) => {
        let completed = 0;
        const total = promises.length;
        for (const promise of promises) {
            promise.then(v => {
                if (v) {
                    resolve(v);
                    if (cancelRace)
                        cancelRace.cancel();
                } else {
                    completed++;
                    if (completed === total)
                        resolve(false);
                }
            }).catch(e => {
                reject(e);
                if (cancelRace)
                    cancelRace.cancel();
            });
        }
    });
}
