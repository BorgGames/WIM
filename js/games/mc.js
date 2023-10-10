import {makeApp} from "../auth/ms.js";

const clientID = '4c1b168d-3889-494d-a1ea-1a95c3ecda51';
export const auth = makeApp(clientID);
export const scopes = ['openid', 'profile', 'offline_access', 'XboxLive.signin'];