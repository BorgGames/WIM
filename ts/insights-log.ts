declare var appInsights: any;
let consoleWrapper: any = (function (oldCons) {
    return {
        debug: function (...args: any[]) {
            oldCons.log(...args);
            con(appInsights.SeverityLevel.Verbose, ...args);
        },
        info: function (...args: any[]) {
            oldCons.info(...args);
            con(appInsights.SeverityLevel.Information, ...args);
        },
        log: function (...args: any[]) {
            oldCons.log(...args);
            con(appInsights.SeverityLevel.Verbose, ...args);
        },
        warn: function (...args: any[]) {
            oldCons.warn(...args);
            con(appInsights.SeverityLevel.Warning, ...args);
        },
        error: function (...args: any[]) {
            oldCons.error(...args);
            con(appInsights.SeverityLevel.Error, ...args);
        },
    };
}(window.console));

function con(severity: any, ...args: any[]) {
    let err = args[0] instanceof Error ? args[0] : null;
    if (err)
        args = args.slice(1);
    let text = args.join();
    if (severity <= appInsights.SeverityLevel.Verbose && text.startsWith('ping'))
        return;
    if (err)
        appInsights.trackException({exception: err, severityLevel: severity, properties: {message: text}});
    else
        appInsights.trackTrace({message: text, severity: severity});
}

if (window.appInsights)
    window.console = consoleWrapper;