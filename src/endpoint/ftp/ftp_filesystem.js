/* Copyright (C) 2016 NooBaa */
'use strict';


const path = require('path');

const dbg = require('../../util/debug_module')(__filename);
require('../../util/dotenv').load();


class FtpFileSystemNB {

    constructor(params) {
        this.bucket = process.env.FTP_ROOT_BUCKET || 'first.bucket';
        this.working_dir = '/';
        this.object_sdk = params.object_sdk;
        const auth_server = require('../../server/common_services/auth_server'); // eslint-disable-line global-require
        const system_store = require('../../server/system_services/system_store').get_instance(); // eslint-disable-line global-require
        this.authenticate = system_store.load()
            .then(() => {
                // TODO: fix authentication. currently autherizes everything.
                let system = system_store.data.systems[0];
                const auth_token = auth_server.make_auth_token({
                    system_id: system._id,
                    account_id: system.owner._id,
                    role: 'admin'
                });
                this.object_sdk.set_auth_token(auth_token);
            })
            .catch(err => dbg.error('authenticate_request: ERROR', err.stack || err));
    }

    // _parse_ftp_path(file_path) {
    //     let full_path = file_path;
    //     if (!file_path.startsWith('/')) {
    //         full_path = path.join('/', this.bucket, this.path_in_bucket, file_path);
    //     }
    //     const [, bucket, key] = full_path.split('/');
    //     return { bucket, key };
    // }

    _get_absolute_path(file_path) {
        if (file_path.startsWith('/')) {
            return file_path;
        } else {
            return path.join(this.working_dir, file_path);
        }
    }

    _get_new_file_stats_object(name, is_dir, size, create_time) {
        return {
            name,
            dev: 123, // dummy
            mode: 33206, // 666 permissions
            nlink: 1,
            uid: 0,
            gid: 0,
            rdev: 0,
            blksize: 0,
            ino: 0,
            size,
            blocks: 8,
            atime: new Date(create_time),
            mtime: new Date(create_time),
            ctime: new Date(create_time),
            birthtime: new Date(create_time),
            isFile: () => !is_dir,
            isDirectory: () => is_dir,
            isBlockDevice: () => false,
            isCharacterDevice: () => false,
            isSymbolicLink: () => false,
            isFIFO: () => false,
            isSocket: () => false,
        };
    }

    currentDirectory() {
        console.log(`returning current directory: ${this.working_dir}`);
        return this.working_dir;
    }

    get(file_name) {
        console.log(`get called with file_name=${file_name}`);
        const key = this._get_absolute_path(file_name).substring(1);
        if (!key) return this._get_new_file_stats_object('/', true, 0, new Date());
        // return this.authenticate.then(() => this.object_sdk.read_object_md({ bucket: this.bucket, key }))
        return this.authenticate.then(() => this.object_sdk.list_objects({
                bucket: this.bucket,
                upload_mode: false,
                prefix: key,
                delimiter: '/',
                limit: 100
            }))
            .tap(console.log)
            .then(res => {
                console.log(`in get - got res = `, res);
                if (res.objects.length) {
                    const object_md = res.objects[0];
                    return this._get_new_file_stats_object(object_md.key, false, object_md.size, object_md.create_time);
                } else if (res.common_prefixes.length) {
                    const name = res.common_prefixes[0];
                    return this._get_new_file_stats_object(name, true, 0, new Date());
                }
            })
            .tap(console.log)
            .catch(err => {
                dbg.error('got error in get(). ', err);
                err.code = 'ENOENT';
                throw err;
            });
    }


    list(dir_path = '.') {
        console.log(`list called with dir_path ${dir_path}`);
        const key = this._get_absolute_path(dir_path).substring(1);
        const params = {
            bucket: this.bucket,
            upload_mode: false,
            prefix: key.length ? path.join(key, '/') : undefined,
            delimiter: '/',
            limit: 1000
        };

        console.log(`calling list_objects with params =`, params);

        return this.authenticate.then(() => this.object_sdk.list_objects(params))
            .tap(console.log)
            .then(res => [this._get_new_file_stats_object('.', true, 0, new Date())]
                .concat(res.objects.filter(obj => !obj.key.endsWith('/')) // filter out dirs
                    .map(obj => this._get_new_file_stats_object(path.parse(obj.key).base, false, obj.size, obj.create_time)))
                .concat(res.common_prefixes.map(prefix => this._get_new_file_stats_object(path.parse(prefix).base, true, 0, new Date()))))
            .tap(list => console.log(`retruning list`, list));
    }

    chdir(dir_path = '.') {
        // no error checking, just change
        this.working_dir = this._get_absolute_path(dir_path);
        console.log(`changed dir to ${this.working_dir}`);
    }

    read(file_name, { start = undefined } = {}) {
        const key = this._get_absolute_path(file_name).substring(1);
        console.log(`got read for file`, key, ' with start offset = ', start);

        return this.object_sdk.read_object_md({
                bucket: this.bucket,
                key,
            })
            .then(object_md => {
                const params = {
                    object_md,
                    obj_id: object_md.obj_id,
                    bucket: this.bucket,
                    key
                };
                return this.object_sdk.read_object_stream(params);
            });
    }


    // mkdir(path) {
    //     const { fsPath } = this._resolvePath(path);
    //     return fs.mkdir(fsPath)
    //         .then(() => fsPath);
    // }

    // write(fileName, { append = false, start = undefined } = {}) {
    //     // const { fsPath } = this._resolvePath(fileName);
    //     // const stream = syncFs.createWriteStream(fsPath, { flags: !append ? 'w+' : 'a+', start });
    //     // stream.once('error', () => fs.unlink(fsPath));
    //     // stream.once('close', () => stream.end());
    //     // return stream;
    // }


    // delete(path) {
    //     const { fsPath } = this._resolvePath(path);
    //     return fs.stat(fsPath)
    //         .then(stat => {
    //             if (stat.isDirectory()) return fs.rmdir(fsPath);
    //             else return fs.unlink(fsPath);
    //         });
    // }


    // rename(from, to) {
    //     const { fsPath: fromPath } = this._resolvePath(from);
    //     const { fsPath: toPath } = this._resolvePath(to);
    //     return fs.rename(fromPath, toPath);
    // }

    // chmod(path, mode) {
    //     const { fsPath } = this._resolvePath(path);
    //     return fs.chmod(fsPath, mode);
    // }

    // getUniqueName() {
    //     return uuid.v4().replace(/\W/g, '');
    // }
}


exports.FtpFileSystemNB = FtpFileSystemNB;
