let console = (function (oldCons) {
    return {
        debug: function (...args) {
            oldCons.log(...args);
            con(appInsights.SeverityLevel.Verbose, ...args);
        },
        info: function (...args) {
            oldCons.info(...args);
            con(appInsights.SeverityLevel.Information, ...args);
        },
        log: function (...args) {
            oldCons.log(...args);
            con(appInsights.SeverityLevel.Verbose, ...args);
        },
        warn: function (...args) {
            oldCons.warn(...args);
            con(appInsights.SeverityLevel.Warning, ...args);
        },
        error: function (...args) {
            oldCons.error(...args);
            con(appInsights.SeverityLevel.Error, ...args);
        },
    };
}(window.console));

function con(severity, ...args) {
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
    window.console = console;