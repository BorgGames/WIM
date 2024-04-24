import {SYNC} from "./onedrive.js";
const MONITOR_PREFIX = "https://api.onedrive.com/v1.0/monitor/";
const MAX_CONTENT_SIZE = 128*1024;

function codeResponse(channel: RTCDataChannel, prefix: string, code: number, text: string) {
    channel.send(prefix + JSON.stringify({
        status: code,
        body: btoa(text),
    }));
}

const forbidden = (channel: RTCDataChannel, prefix: string, text: string) => codeResponse(channel, prefix, 403, text);
const unauthorized = (channel: RTCDataChannel, prefix: string, text: string) => codeResponse(channel, prefix, 401, text);
const invalidArg = (channel: RTCDataChannel, prefix: string, text: string) => codeResponse(channel, prefix, 400, text);

function odataError(channel: RTCDataChannel, prefix: string, httpCode: number, errorCode: string, message: string) {
    channel.send(prefix + JSON.stringify({
        status: httpCode,
        contentType: "application/json",
        body: strToBase64(JSON.stringify({
            error: {
                code: errorCode,
                message
            }
        })),
    }));
}

const canonicalize = (id: string) => decodeURIComponent(id);

function blobToBase64(blob: Blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            const val = reader.result as string;
            return resolve(val.substring(val.indexOf(',') + 1));
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

async function blobToObject(blob: Blob) {
    const json = await blob.text();
    return JSON.parse(json);
}

async function base64ToArrayBuffer(base64: string) {
    const dataUrl = "data:application/octet-stream;base64," + base64;
    const result = await fetch(dataUrl);
    return await result.arrayBuffer();
}

function bytesToBase64(bytes: Uint8Array) {
    const binString = Array.from(bytes, (x) => String.fromCodePoint(x)).join("");
    return btoa(binString);
}

function strToBase64(str: string) {
    return bytesToBase64(new TextEncoder().encode(str));
}

const isTypeJson = (contentType: string | null) => contentType && contentType.startsWith("application/json");

export class OneDrivePersistence {
    items: Set<string>;
    channel: RTCDataChannel;
    private _messageHandler: (event: any) => Promise<void>;

    async forward(event: MessageEvent<string>) {
        const channel = <RTCDataChannel>event.target;
        const jsonStart = event.data.indexOf('{');
        const prefix = event.data.substring(0, jsonStart);
        const json = event.data.substring(jsonStart);
        const request = JSON.parse(json);
        try {
            if (request.options?.body)
                request.options.body = await base64ToArrayBuffer(request.options.body);
            const method = request.options?.method?.trim().toUpperCase() ?? "GET";
            let u = new URL(request.uri);
            console.debug(method, request.uri);
            let call;
            switch (u.protocol) {
                case "bcd:":
                    call = parseRequest(u.pathname, method);
                    break;
                case "https:":
                    if (request.uri.startsWith(MONITOR_PREFIX))
                        call = new Request(request.uri, true);
                    else
                        return unauthorized(channel, prefix, "globalAccess");
                    break;
                default:
                    return invalidArg(channel, prefix, "protocol");
            }
            if (call?.drive && !this.allowed(call.drive) || call?.item && !this.allowed(call.item))
                return forbidden(channel, prefix, "drive or item");

            const response = await SYNC.makeRequest(call.url, request.options);
            const location = response.headers.get('Location');
            const contentType = response.headers.get('Content-Type');
            const body = await response.blob();
            
            if (body.size > MAX_CONTENT_SIZE) {
                console.error(request.uri, "content too large", body.size);
                return odataError(channel, prefix, 502, "responseTooLarge",
                    `The ${body.size} bytes response body is too large. The maximum size is ${MAX_CONTENT_SIZE} bytes.`);
            }

            if (response.ok && call.returnItems)
                await this.updateMapper(location, isTypeJson(contentType) ? body : null);

            const result = {
                status: response.status,
                body: await blobToBase64(body),
                location,
                contentType,
            };
            channel.send(prefix + JSON.stringify(result));
            console.debug(method, request.uri, response.status)
        } catch (e) {
            console.error(request.uri, e);
            channel.send(prefix + JSON.stringify({
                status: 502,
                contentType: "application/json",
                body: strToBase64(JSON.stringify(e)),
            }));
        }
    }

    async updateMapper(location: string | null, bytes: Blob | null) {
        if (location) {
            console.error("Unexpected location", location);
        }
        try {
            if (bytes === null)
                return;
            const object = await blobToObject(bytes);

            if ("id" in object)
                this.addItem(object.id);
            if ("resourceId" in object)
                this.addItem(object.resourceId);
            if ("value" in object)
                for (const item of object.value)
                    if ("id" in item)
                        this.addItem(item.id);
        } catch (e) {
            console.warn("Failed to parse response", e);
        }
    }

    addItem(id: string) {
        const canonical = canonicalize(id);
        this.items.add(canonical);
    }

    allowed(id: string) {
        const canonical = canonicalize(id);
        return this.items.has(canonical);
    }

    constructor(channel: RTCDataChannel, allowed?: string[]) {
        this.channel = channel;
        this.items = new Set<string>();
        this._messageHandler = this.forward.bind(this);
        if (allowed) {
            for (const id of allowed)
                this.addItem(id);
        }
        channel.addEventListener('message', this._messageHandler);
    }

    destroy() {
        this.channel.removeEventListener('message', this._messageHandler);
    }
}

function parseRequest(path: string, method: string) {
    const parts = path.substring(1).split('/');
    if (parts[0] !== "")
        throw new RangeError("Invalid path");

    let url = parts.slice(3).join("/");

    if (parts.length === 3 && parts[1] === "me" && parts[2] === "drive")
        return new Request("", true);

    if (parts.length < 5 || parts[1] !== "drives" || parts[3] !== "items")
        throw new RangeError("Invalid path");
    let [, , drive, , item] = parts;
    let request = new Request(url, false);
    request.drive = drive;
    request.item = item;

    if (parts.length === 5) {
        request.returnItems = true;
        return request;
    }

    if (parts.length === 6) {
        switch (parts[5]) {
            case "children":
            case "copy":
                request.returnItems = true;
                return request;
            case "content":
            case "createUploadSession":
                return request;
            default:
                throw new RangeError("Invalid path");
        }
    }

    if (parts.length === 7) {
        if (!request.item.endsWith(":"))
            throw new RangeError("Invalid path");
        request.item = request.item.substring(0, request.item.length - 1);
        let nameColon = parts[5];
        if (!nameColon.endsWith(":"))
            throw new RangeError("Invalid path");
        switch (parts[6]) {
            case "content":
                request.returnItems = method.toUpperCase() === "PUT";
                return request;
            case "createUploadSession":
                return request;
            default:
                throw new RangeError("Invalid path");
        }
    }

    throw new RangeError("Invalid path");
}

class Request {
    url: string;
    returnItems: boolean;
    drive?: string;
    item?: string;

    constructor(url: string, returnItems: boolean) {
        this.url = url;
        this.returnItems = returnItems;
    }
}