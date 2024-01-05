export function devMode() {
    return +localStorage.getItem('dev-mode')! === 1;
}