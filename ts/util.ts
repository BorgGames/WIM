export interface ICancellationTokenSource {
    cancel(): void;
}
export class CancellationToken {
    canceled: boolean;

    constructor() {
        this.canceled = false;
    }

    cancel() {
        this.canceled = true;
    }
}

export class PubSub {
    subs: {[channel: string]: ((...args: any[]) => void)[]};

    constructor() {
        this.subs = {}
    }

    subscribe(channel: string, sub: any) {
        this.subs[channel] = this.subs[channel] || [];
        this.subs[channel].push(sub);
    }

    publish(channel: string, ...args: any[]) {
        (this.subs[channel] || []).forEach(sub => sub(...args));
    }
}

export async function promiseOr(promises: Promise<any>[], cancelRace?: any) {
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
