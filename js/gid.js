const exePrefix = '//exe/';

export class GameID {
    static tryGetExe(uriString) {
        const uri = new URL(uriString);
        if (uri.protocol !== "borg:" || !uri.pathname.startsWith(exePrefix))
            return null;
        return uri.pathname.substring(exePrefix.length);
    }
}