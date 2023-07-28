const clientID = 'c516d4c8-2391-481d-a098-b66382079a38';
const driveUrl = 'https://graph.microsoft.com/v1.0/me/drive/';

var accessToken = null;

export async function makeRequest(url, options) {
    if (!accessToken) throw new Error('Not logged in');

    if (!options) options = {};
    options.headers = options.headers || {};
    options.headers['Authorization'] = 'Bearer ' + accessToken;
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
                await login();
            default:
                return result;
        }
    }
}

export async function login() {
    const msalConfig = {
        auth: {
            clientId: clientID,
        },
        cache: {
            cacheLocation: 'localStorage'
        }
    };

    const loginRequest = {
        scopes: ['user.read', 'files.readwrite.appfolder']
    };

    const clientApp = new msal.PublicClientApplication(msalConfig);

    const redirectResult = await clientApp.handleRedirectPromise();
    console.debug('redirectResult', redirectResult);

    if (!clientApp.getActiveAccount()) {
        const currentAccounts = clientApp.getAllAccounts();
        if (currentAccounts.length !== 0) {
            if (currentAccounts.length > 1)
                console.warn('More than one account detected, logging in with the first account');
            clientApp.setActiveAccount(currentAccounts[0]);
            console.log('There is an active account');
        } else {
            console.log('No active accounts, logging in');
            try {
                const loginResponse = await clientApp.loginRedirect(loginRequest);
            } catch (err) {
                if (err instanceof msal.InteractionRequiredAuthError) {
                    document.write('Sign in required: session expired');
                } else {
                    throw err;
                }
            }
            const newAccounts = clientApp.getAllAccounts();
            console.log('got ' + newAccounts.length + ' accounts');
            clientApp.setActiveAccount(newAccounts[0]);
        }
    }

    try {
        var tokenResponse = await clientApp.acquireTokenSilent(loginRequest);
    } catch (err) {
        if (err instanceof msal.InteractionRequiredAuthError) {
            tokenResponse = await clientApp.acquireTokenRedirect(loginRequest);
        } else {
            throw err;
        }
    }

    accessToken = tokenResponse.accessToken;
}

export async function ensureBorgTag() {
    const ensureAppFolder = await makeRequest('special/approot', {});
    console.log('ensure: ', ensureAppFolder);

    const exists = await makeRequest('special/approot:/' + clientID, {});
    if (exists.status === 404) {
        const response = await makeRequest('special/approot:/' + clientID + ':/content', {
            method: 'PUT',
            headers: { 'Content-Type': 'text/plain' },
            body: ''
        });

        if (response.status !== 201)
            throw new Error('Failed to create tag file');

        console.log('PUT Borg tag: ', response);
    } else {
        console.log('Borg tag already exists: ', exists);
    }
}

export async function deltaStream(resource, handler, restartDelay, shouldCancel) {
    var link = resource + ':/delta';
    while (!shouldCancel()) {
        var response = await makeRequest(link);

        if (!response.ok) {
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

