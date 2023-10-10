import * as ms from './auth/ms.js';

const driveUrl = 'https://graph.microsoft.com/v1.0/me/drive/';

export class OneDrive {
    clientID;
    accessToken = null;

    constructor(clientID) {
        this.clientID = clientID;
    }

    async makeRequest(url, options) {
        if (!this.accessToken) throw new Error('Not logged in');

        if (!options) options = {};
        options.headers = options.headers || {};
        options.headers['Authorization'] = 'Bearer ' + this.accessToken;
        if (!url.startsWith('https://'))
            url = driveUrl + url;
        while (true) {
            let result = await fetch(url, options);
            if (result.ok) return result;
            switch (result.status) {
                case 503:
                    console.warn('Retry after', result.headers.get('Retry-After'));
                    continue;
                case 401:
                    await this.login();
                    continue;
                default:
                    return result;
            }
        }
    }

    async download(url) {
        // workaround for https://github.com/microsoftgraph/msgraph-sdk-javascript/issues/388
        if (url.endsWith(':/content'))
            throw new RangeError();
        const response = await this.makeRequest(url + '?select=id,@microsoft.graph.downloadUrl');
        if (response.status === 404)
            return null;
        if (!response.ok)
            throw new Error('Failed to download ' + url + ': ' + response.status + ': ' + response.statusText);
        const item = await response.json();
        const realUrl = item['@microsoft.graph.downloadUrl'];
        return await fetch(realUrl);
    }

    async login(loud) {
        const partial = {};
        const token = await ms.login(this.clientID, ['user.read', 'files.readwrite.appfolder'], loud, partial);
        this.account = partial.account;
        if (!token) return false;
        this.accessToken = token;
        console.log('Logged in');
        return true;
    }

    async ensureBorgTag() {
        const ensureAppFolder = await this.makeRequest('special/approot', {});
        console.log('ensure: ', ensureAppFolder);

        const exists = await this.makeRequest('special/approot:/' + this.clientID, {});
        if (exists.status === 404 || (await exists.json()).size !== 73) {
            const response = await this.makeRequest('special/approot:/' + this.clientID + ':/content', {
                method: 'PUT',
                headers: {'Content-Type': 'text/plain'},
                body: `${crypto.randomUUID()}+${crypto.randomUUID()}`
            });

            if (response.status !== 201)
                throw new Error(`Failed to create tag file: HTTP ${response.status}: ${response.statusText}`);

            console.log('PUT Borg tag: ', response);
        } else {
            console.log('Borg tag already exists: ', exists);
        }
    }

    async deltaStream(resource, handler, restartDelay, shouldCancel) {
        let link = resource + ':/delta';
        while (!shouldCancel()) {
            const response = await this.makeRequest(link);

            if (!response.ok) {
                if (response.status === 404) {
                    link = await restartDelay(link);
                    continue;
                }
                console.error('delta stream error', response.status, response.statusText);
                throw new Error('delta stream HTTP ' + response.status + ': ' + response.statusText);
            }

            const delta = await response.json();
            for (const item of delta.value) {
                await handler(item);
            }

            if (delta.hasOwnProperty('@odata.deltaLink')) {
                link = await restartDelay(delta['@odata.deltaLink']);
            } else if (delta.hasOwnProperty('@odata.nextLink')) {
                link = delta['@odata.nextLink'];
            } else {
                console.warn('No delta link found');
                return;
            }
        }
    }

    isLoggedIn() {
        return !!this.accessToken;
    }
}

export const SYNC = new OneDrive('4c1b168d-3889-494d-a1ea-1a95c3ecda51');
export const MY = new OneDrive('c516d4c8-2391-481d-a098-b66382079a38');