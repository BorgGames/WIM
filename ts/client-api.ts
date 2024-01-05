import { IConnectionAPI } from "../js/streaming-client/built/client.js";

export class ClientAPI implements IConnectionAPI {
    connectionUpdate(data: any) {
        console.warn(data);
    }
}