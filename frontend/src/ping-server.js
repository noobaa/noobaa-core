/* Copyright (C) 2016 NooBaa */

(function(global) {
    const pingUrl = '/version';
    const redirectUrl = '/fe';
    const delay = 3000;

    (function tryGet() {
        const xhr = new global.XMLHttpRequest();
        xhr.open('GET', pingUrl, true);
        xhr.onerror = () => setTimeout(tryGet, delay);
        xhr.onload = evt => {
            if (evt.target.status === 200) {
                global.location = redirectUrl;
            } else {
                xhr.onerror();
            }
        };
        xhr.send();
    })();
})(window);
