/* Copyright (C) 2016 NooBaa */

/* ------------------------------------------------------
IMPORTANT: Do not import anything that is included in
the main app bundle doing so may invalidate the entire
prelaod process (the process must be self contained);
------------------------------------------------------ */

const base = '/fe/assets';
const assets = [
    'loader.gif',
    'stars.jpg',
    'checkbox.png',
    'radiobtn.png',
    'search.png',
    'step-done.png'
];

const prefix = 'PRELOAD';

function loadImage(name) {
    return new Promise(
        (resolve, reject) => {
            const uri = `${base}/${name}`;
            const image = new Image();
            image.onload = () => resolve(image);
            image.onerror = () => reject(image);

            console.log(`${prefix} loading image ${uri}`);
            image.src = uri;
        }
    );
}

function handleLoadError(image) {
    console.warn(`${prefix} loading ${image.src} failed`);
    return image;
}

function preload(assets) {
    console.log(`${prefix} start loading`);

    let promiseList = assets.map(
        asset => loadImage(asset)
            .catch(handleLoadError)
    );

    return Promise.all(promiseList)
        .then(
            () => console.log(`${prefix} loading completed`)
        );
}

preload(assets);
