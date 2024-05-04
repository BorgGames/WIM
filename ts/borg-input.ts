import {Input} from "../js/streaming-client/built/input.js";

export function configureInput(input: Input) {
    input.keyFilter = (event: KeyboardEvent) => {
        if (event.code === 'Backquote' && event.ctrlKey && event.altKey)
            return false;
        if (event.code === 'Enter' && event.ctrlKey && event.altKey)
            return false;
        if (event.code === 'Slash' && event.ctrlKey && event.altKey)
            return false;
        return true;
    };
}
