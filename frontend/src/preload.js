/* Copyright (C) 2016 NooBaa */

/* ------------------------------------------------------
IMPORTANT: Do not import anything that is included in
the main app bundle doing so may invalidate the entire
prelaod process (the process must be self contained);
------------------------------------------------------ */

const base = '/fe/assets';
const iconsSvg = 'icons.svg';
const images = [
    'search.png'
];

const prefix = 'PRELOAD';

function loadImage(uri) {
    return new Promise(
        (resolve, reject) => {
            const image = new Image();
            image.onload = () => resolve(image);
            image.onerror = () => reject(image);

            console.log(`${prefix} loading image ${uri}`);
            image.src = uri;
        }
    )
        .catch(
            image => console.warn(`${prefix} loading ${image.src} failed`)
        );
}

function loadSvg(uri) {
    console.log(`${prefix} loading SVG ${uri}`);

    return fetch(uri)
        .then(res => res.text())
        .then(html => {
            const template = document.createElement('template');
            template.innerHTML = html;
            return template.content.childNodes[0];
        })
        .catch(
            () => console.warn(`${prefix} loading SVG ${uri} failed`)
        );
}

function preload() {
    console.log(`${prefix} start loading`);

    const promiseList = [].concat(
        images.map(
            image => loadImage(`${base}/${image}`)
        ),
        loadSvg(`${base}/${iconsSvg}`).then(
            svg => {
                svg.style.display = 'none';
                document.body.appendChild(svg);
            }
        )
    );

    return Promise.all(promiseList)
        .then(() => console.log(`${prefix} loading completed`));
}

preload();
