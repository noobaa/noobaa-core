// export * from './core-utils';
// export * from './string-utils';
// export * from './promise-utils';
// export * from './browser-utils';
// export * from './color-utils';
// export * from './s3-utils';

// TODO: Figure why the above code is not working, fix it and remove this hack.
Object.freeze(
    Object.assign(
        exports,
        require('./core-utils'),
        require('./string-utils'),
        require('./promise-utils'),
        require('./browser-utils'),
        require('./color-utils')
    )
);
