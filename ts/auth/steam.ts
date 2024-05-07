import {SYNC} from "../onedrive.js";
import {ConduitService} from "../conduit.js";
import {timeout} from "../../js/streaming-client/built/util.js";
import {showLoginDialog} from "../home.js";

declare const QRCode: any;

let licenseBlob: ISignedLicenseList | null = null;
let instance: Promise<ConduitService | null> | null = null;

export function login(host?: string) {
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

async function getSteamTask() {
    const steamTimeout = timeout(60000);
    const steam = await ConduitService.connect('borg:cube:steam', {
        verMin: '1.1',
        verMax: '2.0'
    }, steamTimeout);
    if (steam) {
        steam.events.subscribe('close', () => {
            instance = null
        });
    }
    return steam;
}

export async function getSteam() {
    if (instance === null)
        instance = getSteamTask();
    return await instance;
}

export async function getSignedLicenses() {
    if (licenseBlob === null) {
        if (!SYNC.isLoggedIn())
            return null;
        const response = await SYNC.download('special/approot:/Games/Steam.json');
        if (response === null) {
            const stored = localStorage.getItem("STEAM_LICENSES");
            if (stored) {
                licenseBlob = JSON.parse(stored);
                await saveLicenses(licenseBlob!);
                return licenseBlob;
            }
            return null;
        }

        try {
            licenseBlob = await response.json();
        } catch (e) {
            console.error('corrupted Steam license list file Games/Steam.json', e);
            return null;
        }
    }

    return licenseBlob;
}

export async function hasLicenseToAny(appIDs: number[], packageIDs: number[]) {
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

export async function onLogin(): Promise<ISteamLicense[] | null> {
    const steam = await getSteam();
    if (steam === null) {
        console.warn('Steam login failed');
        return null;
    }

    const openID = <Record<string, string>>{};

    const currentUrl = new URL(window.location.href);
    const searchParams = currentUrl.searchParams;
    for (const key of [...searchParams.keys()]) {
        if (key.startsWith("openid.")) {
            console.debug(key.substring(7), searchParams.get(key));
            openID[key.substring(7)] = searchParams.get(key)!;
            searchParams.delete(key);
        }
    }
    currentUrl.search = searchParams.toString();
    window.history.replaceState({}, document.title, currentUrl.href);

    delete openID["mode"];

    let result: ISignedLicenseList;
    try {
        result = await steam.call<ISignedLicenseList>('LoginWithOpenID', openID);
    } catch (e: any) {
        if (e.data.type === "System.InvalidOperationException") {
            alert("QR code login required.");
            return null;
        }
        console.error(e);
        return null;
    }

    return await saveLicenses(result);
}

export async function loginWithQR(challengeURL: string) {
    const steam = await getSteam();
    if (steam === null)
        throw new Error('Steam login failed');
    const qrElement = document.getElementById('steam-qr')!;
    const steamQR = new QRCode(qrElement, 'https://borg.games');
    steamQR.makeCode(challengeURL);
    let result: ILoginResponse | null = null;
    while (true) {
        try {
            result = await steam.call<ILoginResponse>('LoginWithQR', [challengeURL]);
            if (result.ChallengeURL) {
                challengeURL = result.ChallengeURL;
                qrElement.style.opacity = "1";
                steamQR.makeCode(challengeURL);
            } else {
                if (!SYNC.isLoggedIn()) {
                    localStorage.setItem("STEAM_LICENSES", JSON.stringify(result.Licenses));
                    if (!await showLoginDialog(true))
                        window.location.reload();
                }
                return await saveLicenses(result.Licenses!);
            }
        } catch (e: any) {
            const err = e.data ?? e;
            if (err.type === "System.Runtime.InteropServices.ExternalException") {
                if (err.message.includes("TryAnotherCM")) {
                    challengeURL = null!;
                    qrElement.style.opacity = "0.5";
                    continue;
                }
            }

            console.error(e);
            return;
        }
    }
}

async function saveLicenses(signedLicenseList: ISignedLicenseList): Promise<ISteamLicense[]> {
    const licenses = JSON.parse(atob(signedLicenseList.LicensesUtf8));

    const saveResponse = await SYNC.makeRequest('special/approot:/Games/Steam.json:/content', {
        method: 'PUT',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(signedLicenseList),
    });
    if (!saveResponse.ok)
        console.warn('Failed to save Steam login: ', saveResponse.status, saveResponse.statusText);
    else
        licenseBlob = signedLicenseList;

    localStorage.removeItem("STEAM_LICENSES");

    return licenses;
}

export interface ISteamLicense {
    AppID?: number;
    PackageID?: number;
}

interface ISignedLicenseList {
    LicensesUtf8: string;
    Signature: string;
}

interface ILoginResponse {
    Licenses?: ISignedLicenseList;
    ChallengeURL?: string;
}