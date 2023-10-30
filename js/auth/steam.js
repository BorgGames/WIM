import {SYNC} from "../onedrive.js";
import {ConduitService} from "../conduit.js";
import {timeout} from "../streaming-client/src/util.js";


let licenseBlob = null;
let instance = null;

export function login(host) {
    if (host === undefined)
        host = window.location.host;
    const hostUrl = `https://${host}`;
    const hostArg = encodeURIComponent(hostUrl);
    window.location.href = `https://steamcommunity.com/openid/login?openid.ns=http://specs.openid.net/auth/2.0&openid.claimed_id=http://specs.openid.net/auth/2.0/identifier_select&openid.identity=http://specs.openid.net/auth/2.0/identifier_select&openid.return_to=${hostArg}&openid.realm=${hostArg}&openid.mode=checkid_setup`;
}

export function loginRedirected() {
    const query = new URLSearchParams(window.location.search);
    return query.get('openid.op_endpoint') === 'https://steamcommunity.com/openid/login';
}

export async function getSteam() {
    if (instance !== null)
        return instance;

    const steamTimeout = timeout(60000);
    instance = await ConduitService.connect('borg:cube:steam', '1.1', '2.0', steamTimeout);
    instance.events.subscribe('close', () => {
        instance = null
    });
    return instance;
}

export async function getSignedLicenses() {
    if (licenseBlob === null) {
        const response = await SYNC.download('special/approot:/Games/Steam.json');
        if (response === null)
            return false;

        try {
            licenseBlob = await response.json();
        } catch (e) {
            console.error('corrupted Steam license list file Games/Steam.json', e);
            return null;
        }
    }

    return licenseBlob;
}

export async function hasLicenseToAny(appIDs, packageIDs) {
    const blob = await getSignedLicenses();
    if (blob === null)
        return null;
    let licenses = null;
    try {
        licenses = JSON.parse(atob(blob.LicensesUtf8));
        if (typeof licenses !== 'object')
            throw new RangeError('invalid license list');
    } catch (e) {
        console.error('unable to process Steam license list', e);
        licenseBlob = null;
        return null;
    }
    // AppID; PackageID
    for (const license of licenses) {
        if (appIDs.includes(license.AppID))
            return true;
        if (packageIDs.includes(license.PackageID))
            return true;
    }
    return false;
}

export async function onLogin() {
    const steam = await getSteam();

    const openID = {};

    const currentUrl = new URL(window.location.href);
    const searchParams = currentUrl.searchParams;
    for (const key of [...searchParams.keys()]) {
        if (key.startsWith("openid.")) {
            console.debug(key.substring(7), searchParams.get(key));
            openID[key.substring(7)] = searchParams.get(key);
            searchParams.delete(key);
        }
    }
    currentUrl.search = searchParams.toString();
    window.history.replaceState({}, document.title, currentUrl.href);

    delete openID["mode"];

    let result;
    try {
        result = await steam.call('LoginWithOpenID', openID);
    } catch (e) {
        if (e.data.type === "System.InvalidOperationException") {
            alert("QR code login required.");
            return;
        }
        console.error(e);
    }
    const licenses = JSON.parse(atob(result.LicensesUtf8));

    const saveResponse = await SYNC.makeRequest('special/approot:/Games/Steam.json:/content', {
        method: 'PUT',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(result),
    });
    if (!saveResponse.ok)
        console.warn('Failed to save Steam login: ', saveResponse.status, saveResponse.statusText);

    return licenses;
}
