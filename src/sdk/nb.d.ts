export as namespace nb;

import * as fs from 'fs';
import * as mongodb from 'mongodb';
import { EventEmitter } from 'events';
import { Readable, Writable } from 'stream';
import { IncomingMessage, ServerResponse } from 'http';

type Semaphore = import('../util/semaphore');
type KeysSemaphore = import('../util/keys_semaphore');
type SensitiveString = import('../util/sensitive_string');

type BigInt = number | { n: number; peta: number; };
type Region = string;
type DigestType = 'sha1' | 'sha256' | 'sha384' | 'sha512';
type CompressType = 'snappy' | 'zlib';
type CipherType = 'aes-256-gcm';
type ParityType = 'isa-c1' | 'isa-rs' | 'cm256';
type StorageClass = 'STANDARD' | 'GLACIER' | 'GLACIER_IR';
type ResourceType = 'HOSTS' | 'CLOUD' | 'INTERNAL';
type NodeType =
    'BLOCK_STORE_S3' |
    'BLOCK_STORE_MONGO' |
    'BLOCK_STORE_AZURE' |
    'BLOCK_STORE_GOOGLE' |
    'BLOCK_STORE_FS' |
    'ENDPOINT_S3';

type S3Response = ServerResponse;
type S3Request = IncomingMessage & {
    object_sdk: ObjectSDK;
};

type ReplicationLogAction = 'copy' | 'delete' | 'conflict';
type ReplicationLog = { key: string, action: ReplicationLogAction, time: Date };
type ReplicationLogs = Array<ReplicationLog>;
type ReplicationLogCandidates = Record<string, { action: ReplicationLogAction, time: Date }>;

type BucketDiffKeysDiff = { [key: string]: Array<object> };

interface MapByID<T> { [id: string]: T }

interface Base {
    toJSON?(): object | string;
    toString?(): string;
}

type ID = mongodb.ObjectID;
type DBBuffer = mongodb.Binary | Buffer;

interface System extends Base {
    _id: ID;
    name: string;
    default_chunk_config?: ChunkConfig;
    buckets_by_name: { [name: string]: Bucket };
    tiering_policies_by_name: { [name: string]: Tiering };
    tiers_by_name: { [name: string]: Tier };
    pools_by_name: { [name: string]: Pool };
    chunk_configs_by_id: { [id: string]: ChunkConfig };
    master_key_id: ID;
}

interface Account extends Base {
    _id: ID;
    name: string;
    system: System;
    email: SensitiveString;
    next_password_change: Date;
    is_support?: boolean;
    access_keys: Array<{
        access_key: SensitiveString;
        secret_key: SensitiveString;
    }>;
    master_key_id: ID;
}

interface NodeAPI extends Base {
    _id: ID;
    name: string;
    pool: string; // name!
    node_type: NodeType;
    rpc_address: string;
    ip: string;
    online: boolean;
    writable: boolean;
    readable: boolean;
    is_cloud_node: boolean;
    is_mongo_node: boolean;
    host_id: string;
    host_seq: string;
    heartbeat: number;
    os_info: {
        hostname: string,
    };
    drive: {
        mount: string,
    };
    // incomplete...
}

interface NodesById {
    [node_id: string]: NodeAPI;
}

interface Pool extends Base {
    _id: ID;
    name: string;
    system: System;
    resource_type: ResourceType;
    pool_node_type: NodeType;

    region?: Region;
    cloud_pool_info?: CloudPoolInfo;
    mongo_pool_info?: MongoPoolInfo;
}

interface CloudPoolInfo {

}

interface MongoPoolInfo {

}

interface Tier extends Base {
    _id: ID;
    name: string;
    system: System;
    chunk_config: ChunkConfig;
    data_placement: 'MIRROR' | 'SPREAD';
    mirrors: TierMirror[];
    storage_class?: StorageClass;
}

interface TierMirror {
    _id: ID;
    spread_pools: Pool[];
}

interface Tiering extends Base {
    _id: ID;
    name: string;
    system: System;
    chunk_split_config: {
        avg_chunk: number;
        delta_chunk: number;
    };
    tiers: Array<{
        order: number;
        tier: Tier;
        spillover?: boolean;
        disabled?: boolean;
    }>;
}

interface TierStatus {
    pools: PoolsStatus;
    mirrors_storage: MirrorStatus[];
}

interface TieringStatus {
    [tier_id: string]: TierStatus;
}

interface PoolsStatus {
    [pool_id: string]: {
        valid_for_allocation: boolean;
        num_nodes: number;
        resource_type: ResourceType;
    };
}

interface MirrorStatus {
    free: BigInt;
    regular_free: BigInt;
    redundant_free: BigInt;
}

interface Bucket extends Base {
    _id: ID;
    deleted?: Date;
    name: SensitiveString;
    system: System;
    versioning: 'DISABLED' | 'SUSPENDED' | 'ENABLED';
    tiering: Tiering;

    tag?: string;
    namespace?: {
        read_resources: NamespaceResource[];
        write_resource: NamespaceResource;
        caching?: CacheConfig;
    };
    quota?: object;
    storage_stats: {
        last_update: number;
    };
    lifecycle_configuration_rules?: object;
    lambda_triggers?: object;
    master_key_id: ID;
}

interface CacheConfig {
    ttl?: number;
}
interface NamespaceResource {
    _id: ID;
    name: string;
    system: System;
    account: Account;
    connection: object;
    path: string;
}

interface ChunkConfig extends Base {
    _id: ID;
    system: System;
    chunk_coder_config: ChunkCoderConfig;
}

interface ChunkCoderConfig {
    replicas: number;
    digest_type: DigestType;
    frag_digest_type: DigestType;
    compress_type: CompressType;
    cipher_type: CipherType;
    data_frags: number;
    parity_frags: number;
    parity_type: ParityType;
    lrc_group?: number;
    lrc_frags?: number;
    lrc_type?: ParityType;
}

interface LocationInfo {
    node_id?: string;
    host_id?: string;
    pool_id?: string;
    region?: Region;
}



/**********************************************************
 *
 * MAPPER - INTERFACES
 *
 **********************************************************/

interface Chunk {
    readonly _id: ID;
    readonly bucket_id: ID;
    readonly tier_id: ID;
    readonly size: number;
    readonly compress_size: number;
    readonly frag_size: number;
    readonly digest_b64: string;
    readonly cipher_key_b64: string;
    readonly cipher_iv_b64: string;
    readonly cipher_auth_tag_b64: string;
    readonly chunk_coder_config: ChunkCoderConfig;
    readonly storage_class?: StorageClass;
    master_key_id?: ID;

    dup_chunk_id?: ID;
    had_errors?: boolean;
    data?: Buffer;

    is_accessible: boolean;
    is_building_blocks: boolean;
    is_building_frags: boolean;

    readonly frags: Frag[];
    readonly frag_by_index: { [frag_index: string]: Frag };
    readonly bucket: Bucket;
    readonly tier: Tier;
    readonly chunk_config: ChunkConfig;
    readonly parts: Part[];

    set_new_chunk_id();
    add_block_allocation(frag: Frag, pools: Pool[], mirror: TierMirror);

    to_api(adminfo?: boolean): ChunkInfo;
    to_db(): ChunkSchemaDB;
}

interface Frag {
    readonly _id: ID;
    readonly data_index?: number;
    readonly parity_index?: number;
    readonly lrc_index?: number;
    readonly frag_index: string;
    readonly digest_b64: string;
    readonly blocks: Block[];

    data?: Buffer;

    allocations?: AllocationInfo[];
    is_accessible: boolean;
    is_building_blocks: boolean;

    set_new_frag_id();

    to_api(adminfo?: boolean): FragInfo;
    to_db(): FragSchemaDB;
}

interface Block {
    readonly _id: ID;
    readonly node_id: ID;
    readonly pool_id: ID;
    readonly chunk_id: ID;
    readonly frag_id: ID;
    readonly bucket_id: ID;
    readonly size: number;
    readonly address: string;

    readonly node: NodeAPI;
    readonly pool: Pool;
    readonly bucket: Bucket;
    readonly system: System;

    is_accessible: boolean;
    is_preallocated: boolean;
    is_deletion: boolean;
    is_future_deletion: boolean;

    // is_misplaced: boolean;
    // is_local_mirror: boolean;
    // is_missing: boolean;
    // is_tampered: boolean;

    set_parent_ids(frag: Frag, chunk: Chunk);
    set_node(node: NodeAPI, pool: Pool);
    set_digest_type(dig_type: DigestType);

    to_block_md(): BlockMD;
    to_api(adminfo?: boolean): BlockInfo;
    to_db(): BlockSchemaDB;
}

interface Part {
    readonly _id: ID;
    readonly deleted?: Date;
    readonly start: number;
    readonly end: number;
    readonly seq: number;
    readonly obj_id: ID;
    readonly multipart_id: ID;
    readonly chunk_id: ID;
    readonly chunk_offset?: number;

    set_new_part_id();
    set_chunk(chunk_id: ID);
    // set_obj_id(obj_id: ID);

    to_api(): PartInfo;
    to_db(): PartSchemaDB;
}

interface ObjectMultipart {
    _id: ID;
    obj: ObjectMD;
    num: number;
    size: number;
    md5_b64?: string;
    sha256_b64?: string;
    create_time?: Date;
    // partial
}

interface ObjectMD {
    _id: ID;
    deleted?: Date;
    bucket: ID;
    system: ID;
    key: string;
    version_seq: number;
    version_past: boolean;
    version_enabled: boolean;
    lock_enabled: boolean;
    delete_marker?: boolean;
    size: number;
    num_parts: number;
    content_type: string;
    content_encoding?: string;
    upload_size?: number;
    upload_started?: ID;
    create_time?: Date;
    cache_last_valid_time?: Date;
    last_modified_time?: Date;
    etag: string;
    md5_b64: string;
    sha256_b64: string;
    storage_class?: StorageClass;
    xattr: {};
    stats: { reads: number; last_read: Date; };
    encryption: { algorithm: string; kms_key_id: string; context_b64: string; key_md5_b64: string; key_b64: string; };
    tagging: Array<{ key: string; value: string; }>;
    lock_settings: { retention: { mode: string; retain_until_date: Date; }, legal_hold: { status: string } };
}

interface ObjectOwner {
    id: string,
    name: string;
}

interface ObjectInfo {
    obj_id: string;
    bucket: string;
    key: string;
    object_owner?: ObjectOwner;
    version_id: string;
    lock_settings: { retention: { mode: string; retain_until_date: Date; }, legal_hold: { status: string } };
    is_latest: boolean;
    delete_marker?: boolean;
    size: number;
    num_parts: number;
    content_type: string;
    content_encoding?: string;
    upload_size?: number;
    upload_started?: number;
    create_time?: number;
    cache_last_valid_time?: number;
    last_modified_time?: number;
    etag: string;
    md5_b64: string;
    sha256_b64: string;
    xattr: {};
    stats: { reads: number; last_read: number; };
    encryption: { algorithm: string; kms_key_id: string; context_b64: string; key_md5_b64: string; key_b64: string; };
    tagging: Array<{ key: string; value: string; }>;
    tag_count: number;
    s3_signed_url?: string;
    capacity_size?: number;
    num_multiparts?: number;
    first_range_data?: Buffer;
    content_length?: number;
    content_range?: string;
    ns?: Namespace;
    storage_class?: StorageClass;
    restore_status?: { ongoing?: boolean; expiry_time?: Date; };
}


/**********************************************************
 *
 * MAPPER - RPC API STRUCTURES
 *
 **********************************************************/


interface ChunkInfo {
    _id?: string;
    bucket_id?: string;
    tier_id?: string;
    dup_chunk?: string;
    chunk_coder_config?: nb.ChunkCoderConfig;
    size: number;
    compress_size?: number;
    frag_size?: number;
    digest_b64?: string;
    cipher_key_b64?: string;
    cipher_iv_b64?: string;
    cipher_auth_tag_b64?: string;
    frags: FragInfo[];
    parts?: PartInfo[];
    is_accessible?: boolean;
    is_building_blocks?: boolean;
    is_building_frags?: boolean;
    master_key_id?: ID;
    storage_class?: StorageClass;

    // Properties not in the API but used in memory
    data?: Buffer;
}

interface FragInfo {
    _id?: string;
    data_index?: number;
    parity_index?: number;
    lrc_index?: number;
    digest_b64?: string;
    blocks?: BlockInfo[];
    allocations?: AllocationInfo[];

    // Properties not in the API but used in memory
    data?: Buffer;
}

interface BlockInfo {
    block_md: BlockMD;
    is_accessible?: boolean;
    is_deletion?: boolean;
    is_future_deletion?: boolean;
    adminfo?: {
        mirror_group: string;
        node_name?: string;
        host_name?: string;
        mount?: string;
        pool_name?: string;
        node_ip?: string;
        online?: boolean;
        in_cloud_pool?: boolean;
        in_mongo_pool?: boolean;
    };
}

interface BlockMD {
    id: string;
    address?: string;
    node?: string;
    pool?: string;
    size?: number;
    digest_type?: string;
    digest_b64?: string;
    node_type?: string;
    is_preallocated?: boolean;
    mapping_info?: {
        obj_id: string;
        multipart_id?: string;
        part_id?: string;
        chunk_id?: string;
        frag_id?: string;
        bucket: string;
        key: string;
        part_start: number;
        part_end: number;
        part_seq: number;
        data_index?: number;
        parity_index?: number;
        lrc_index?: number;
    };
}

interface AllocationInfo {
    mirror_group: string;
    block_md: BlockMD;
    // mem only:
    mirror?: TierMirror;
    pools?: Pool[];
    locality_level?: number;
}

interface PartInfo {
    obj_id: string;
    chunk_id: string;
    multipart_id?: string;
    seq: number;
    start: number;
    end: number;
    chunk_offset?: number;
    uncommitted?: boolean;
}


/**********************************************************
 *
 * MAPPER - DATABASE SCHEMAS
 *
 **********************************************************/


interface ChunkSchemaDB {
    _id: ID;
    system: ID;
    deleted?: Date;
    bucket: ID;
    tier: ID;
    tier_lru: Date;
    chunk_config: ID;
    size: number;
    compress_size: number;
    frag_size: number;
    dedup_key: DBBuffer;
    digest: DBBuffer;
    cipher_key: DBBuffer;
    cipher_iv: DBBuffer;
    cipher_auth_tag: DBBuffer;
    frags: FragSchemaDB[];
    parts?: PartSchemaDB[]; // see MDStore.load_parts_objects_for_chunks()
    objects?: any[]; // see MDStore.load_parts_objects_for_chunks()
    master_key_id?: ID;
}

interface FragSchemaDB {
    _id: ID;
    data_index?: number;
    parity_index?: number;
    lrc_index?: number;
    digest?: DBBuffer;
    blocks?: BlockSchemaDB[]; // see MDStore.load_blocks_for_chunk()
}

interface BlockSchemaDB {
    _id: ID;
    system: ID;
    bucket: ID;
    node: ID;
    pool: ID;
    chunk: ID;
    frag: ID;
    size: number;

    deleted?: Date;
    reclaimed?: Date;
}

interface PartSchemaDB {
    _id: ID;
    system: ID;
    bucket: ID;
    chunk: ID;
    obj: ID;
    multipart: ID;

    seq: number;
    start: number;
    end: number;
    chunk_offset?: number;

    deleted?: Date;
    uncommitted?: boolean;
}

/**********************************************************
 *
 * API CLIENT - client interface based on default schema
 *
 **********************************************************/

interface APIParams {
    [key: string]: any;
}

type APIMethod = (params?: APIParams, options?: object) => Promise<any>;

interface APIGroup {
    [key: string]: APIMethod;
}

interface APIClient {
    readonly auth: APIGroup;
    readonly account: APIGroup;
    readonly system: APIGroup;
    readonly tier: APIGroup;
    readonly node: APIGroup;
    readonly host: APIGroup;
    readonly bucket: APIGroup;
    readonly events: APIGroup;
    readonly object: APIGroup;
    readonly agent: APIGroup;
    readonly block_store: APIGroup;
    readonly stats: APIGroup;
    readonly scrubber: APIGroup;
    readonly debug: APIGroup;
    readonly redirector: APIGroup;
    readonly tiering_policy: APIGroup;
    readonly pool: APIGroup;
    readonly cluster_server: APIGroup;
    readonly cluster_internal: APIGroup;
    readonly server_inter_process: APIGroup;
    readonly hosted_agents: APIGroup;
    readonly func: APIGroup;
    readonly func_node: APIGroup;
    readonly replication: APIGroup;

    options: {
        auth_token?: string;
        address?: string;
        connection?: object;
        return_rpc_req?: boolean;
    };

    RPC_BUFFERS: symbol;

    create_auth_token(params: APIParams): Promise<object>;
    create_access_key_auth(params: APIParams): Promise<object>;
    create_k8s_auth(params: APIParams): Promise<object>;
}


/**********************************************************
 *
 * DB CLIENT
 *
 **********************************************************/

type DBType = 'postgres' | 'mongodb' | 'none';

interface DBClient {
    operators: Set<string>;

    connect(skip_init_db?: 'skip_init_db'): Promise<void>;
    reconnect(): Promise<void>;
    disconnect(): Promise<void>;
    is_connected(): boolean;
    on(event: 'reconnect', listener: (name: string) => void): this;
    set_db_name(name: string): void;
    get_db_name(): string;

    define_collection(params: object): DBCollection;
    define_sequence(params: object): DBSequence;
    collection(name: string): DBCollection;
    validate(name: string, doc: object, warn?: 'warn'): object;

    dropDatabase(): Promise<void>;
    createDatabase(): Promise<void>;

    get_db_stats(): Promise<{ fsUsedSize: number, fsTotalSize: number }>;

    // Remove all of this
    define_gridfs(params: object): { gridfs(): mongodb.GridFSBucket };

    // Utils
    obj_ids_difference(base: any[], values: any[]): any[];
    uniq_ids(docs: object[], doc_path: string): any[];
    populate(docs: object[] | object, doc_path: string, collection: DBCollection, fields: object): Promise<object[] | object>;
    resolve_object_ids_recursive(idmap: object, item: object): object;
    resolve_object_ids_paths(idmap: object, item: object, paths: string[], allow_missing: boolean): object;
    new_object_id(): mongodb.ObjectId;
    parse_object_id(id_str: string): mongodb.ObjectId;
    fix_id_type(doc: object[] | object): object[] | object;
    is_object_id(id: object[] | object): boolean;
    is_err_duplicate_key(err: object): boolean;
    is_err_namespace_exists(err: object): boolean;
    check_duplicate_key_conflict(err: object, entity: string): void;
    check_entity_not_found(doc: object, entity: string): object;
    check_entity_not_deleted(doc: object, entity: string): object;
    check_update_one(res: object, entity: string): void;
    make_object_diff(current: object, prev: object): object;
}

interface DBSequence {
    nextsequence(): Promise<number>;
}

interface DBCollection {
    find(query?: object, options?: object): Promise<DBDoc[]>;
    findOne(query?: object, options?: object): Promise<DBDoc>;
    findOneAndUpdate(query: object, update: object, options?: object): Promise<DBDoc>;
    deleteOne(query: object, options?: object): Promise<object>;
    deleteMany(query: object, options?: object): Promise<mongodb.DeleteWriteOpResultObject>;
    insertOne(doc: DBDoc, options?: object): Promise<object>;
    insertManyUnordered(docs: DBDoc[]): Promise<object>;
    updateOne(query: object, update: object, options?: object): Promise<object>;
    updateMany(query: object, update: object, options?: object): Promise<object>;

    mapReduce(map: Function, reduce: Function, options?: object): Promise<DBDoc[]>;
    groupBy(match: object, group: object): Promise<DBDoc[]>;

    distinct(key: string, query?: object, options?: object): Promise<object[]>;
    initializeUnorderedBulkOp(): mongodb.UnorderedBulkOperation;
    initializeOrderedBulkOp(): mongodb.OrderedBulkOperation;

    countDocuments(query?: object, options?: object): Promise<number>;
    estimatedDocumentCount(options?: object): Promise<number>;
    estimatedQueryCount(query): Promise<number>;
    stats(): Promise<mongodb.CollStats>;

    validate(doc: object, warn?: 'warn'): object;
}

type DBDoc = any;


/**********************************************************
 *
 * NAMESPACE
 *
 **********************************************************/

interface ObjectSDK {
    [key: string]: any;
}

interface Namespace {

    is_server_side_copy(other: Namespace, other_md: ObjectInfo, params: object): boolean;
    is_readonly_namespace(): boolean;
    get_write_resource(): Namespace;
    get_bucket(): string;

    list_objects(params: object, object_sdk: ObjectSDK): Promise<any>;
    list_uploads(params: object, object_sdk: ObjectSDK): Promise<any>;
    list_object_versions(params: object, object_sdk: ObjectSDK): Promise<any>;

    read_object_md(params: object, object_sdk: ObjectSDK): Promise<ObjectInfo>;
    read_object_stream(params: object, object_sdk: ObjectSDK, res?: Writable): Promise<Readable>;

    upload_object(params: object, object_sdk: ObjectSDK): Promise<any>;
    delete_object(params: object, object_sdk: ObjectSDK): Promise<any>;
    delete_multiple_objects(params: object, object_sdk: ObjectSDK): Promise<any>;

    create_object_upload(params: object, object_sdk: ObjectSDK): Promise<any>;
    complete_object_upload(params: object, object_sdk: ObjectSDK): Promise<any>;
    abort_object_upload(params: object, object_sdk: ObjectSDK): Promise<any>;
    upload_multipart(params: object, object_sdk: ObjectSDK): Promise<any>;
    list_multiparts(params: object, object_sdk: ObjectSDK): Promise<any>;

    get_object_tagging(params: object, object_sdk: ObjectSDK): Promise<any>;
    put_object_tagging(params: object, object_sdk: ObjectSDK): Promise<any>;
    delete_object_tagging(params: object, object_sdk: ObjectSDK): Promise<any>;

    get_object_acl(params: object, object_sdk: ObjectSDK): Promise<any>;
    put_object_acl(params: object, object_sdk: ObjectSDK): Promise<any>;

    get_object_legal_hold(params: object, object_sdk: ObjectSDK): Promise<any>;
    put_object_legal_hold(params: object, object_sdk: ObjectSDK): Promise<any>;
    get_object_retention(params: object, object_sdk: ObjectSDK): Promise<any>;
    put_object_retention(params: object, object_sdk: ObjectSDK): Promise<any>;

    upload_blob_block(params: object, object_sdk: ObjectSDK): Promise<any>;
    commit_blob_block_list(params: object, object_sdk: ObjectSDK): Promise<any>;
    get_blob_block_lists(params: object, object_sdk: ObjectSDK): Promise<any>;

    restore_object(params: object, object_sdk: ObjectSDK): Promise<any>;
}

interface BucketSpace {

    read_account_by_access_key({ access_key: string }): Promise<any>;
    read_bucket_sdk_info({ name: string }): Promise<any>;

    list_buckets(object_sdk: ObjectSDK): Promise<any>;
    read_bucket(params: object): Promise<any>;
    create_bucket(params: object, object_sdk: ObjectSDK): Promise<any>;
    delete_bucket(params: object, object_sdk: ObjectSDK): Promise<any>;

    get_bucket_lifecycle_configuration_rules(params: object): Promise<any>;
    set_bucket_lifecycle_configuration_rules(params: object): Promise<any>;
    delete_bucket_lifecycle(params: object): Promise<any>;

    set_bucket_versioning(params: object, object_sdk: ObjectSDK): Promise<any>;

    put_bucket_tagging(params: object): Promise<any>;
    delete_bucket_tagging(params: object): Promise<any>;
    get_bucket_tagging(params: object): Promise<any>;

    put_bucket_logging(params: object): Promise<any>;
    delete_bucket_logging(params: object): Promise<any>;
    get_bucket_logging(params: object): Promise<any>;

    put_bucket_encryption(params: object): Promise<any>;
    get_bucket_encryption(params: object): Promise<any>;
    delete_bucket_encryption(params: object): Promise<any>;

    put_bucket_website(params: object): Promise<any>;
    delete_bucket_website(params: object): Promise<any>;
    get_bucket_website(params: object): Promise<any>;

    put_bucket_policy(params: object): Promise<any>;
    delete_bucket_policy(params: object): Promise<any>;
    get_bucket_policy(params: object, object_sdk: ObjectSDK): Promise<any>;

    put_bucket_notification(params: object): Promise<any>;
    get_bucket_notification(params: object): Promise<any>;

    get_object_lock_configuration(params: object, object_sdk: ObjectSDK): Promise<any>;
    put_object_lock_configuration(params: object, object_sdk: ObjectSDK): Promise<any>;

    is_nsfs_containerized_user_anonymous(token: string): boolean;
    is_nsfs_non_containerized_user_anonymous(token: string): boolean;
}

/**********************************************************
 *
 * ACCOUNTSPACE
 *
 **********************************************************/


interface AccountSDK {
    [key: string]: any;
}

interface AccountSpace {
    // user (CRUD)
    create_user(params: object, account_sdk: AccountSDK): Promise<any>;
    get_user(params: object, account_sdk: AccountSDK): Promise<any>;
    update_user(params: object, account_sdk: AccountSDK): Promise<any>;
    delete_user(params: object, account_sdk: AccountSDK): Promise<any>;
    list_users(params: object, account_sdk: AccountSDK): Promise<any>;
    // access keys (CRUD)
    create_access_key(params: object, account_sdk: AccountSDK): Promise<any>;
    update_access_key(params: object, account_sdk: AccountSDK): Promise<any>;
    get_access_key_last_used(params: object, account_sdk: AccountSDK): Promise<any>;
    delete_access_key(params: object, account_sdk: AccountSDK): Promise<any>;
    list_access_keys(params: object, account_sdk: AccountSDK): Promise<any>;
}


/**********************************************************
 *
 * NATIVE ADDONS
 *
 **********************************************************/

interface Native {
    chunk_splitter(state: ChunkSplitterState, buffers?: Buffer[], callback?: NodeCallback<number[]>);
    chunk_coder(coder: 'enc' | 'dec', chunk: Chunk, callback?: NodeCallback);

    b64_encode(input: Buffer): string;
    b64_decode(input_b64: string): Buffer;

    rand_seed(buffer: Buffer): void;
    set_fips_mode(is_fips_mode: boolean): void;

    x509(options?: X509Options): X509Cert;
    x509_verify(certificate: X509Cert): { owner: X509Name, issuer: X509Name }; // throws if invalid

    syslog(level: number, message: string, facility?: 'LOG_LOCAL0' | 'LOG_LOCAL1' | 'LOG_LOCAL2');
    openlog(ident: string);
    closelog(): void;

    Nudp: { new(): Nudp };
    Ntcp: { new(): Ntcp };

    MD5_MB: { new(): HasherSync };
    SHA1_MB: { new(): HasherSync };
    crypto: { MD5Async: { new(): HasherAsync } };

    fs: NativeFS;

    S3Select: { new(options: S3SelectOptions): S3Select };
    select_parquet: boolean;
}

interface NativeFS {
    open(fs_context: NativeFSContext, path: string, flags?: string, mode?: number): Promise<NativeFile>;
    opendir(fs_context: NativeFSContext, path: string, flags?: string, mode?: number): Promise<NativeDir>;

    stat(
        fs_context: NativeFSContext,
        path: string,
        options?: {
            use_lstat?: boolean;
            skip_user_xattr?: boolean;
            xattr_get_keys?: string[];
        },
    ): Promise<NativeFSStats>;
    statfs(fs_context: NativeFSContext, path: string): Promise<Record<string, number>>;
    realpath(fs_context: NativeFSContext, path: string): Promise<string>;
    checkAccess(fs_context: NativeFSContext, path: string): Promise<void>;
    getsinglexattr(fs_context: NativeFSContext, path: string, key: string): Promise<string>;
    getpwname(fs_context: NativeFSContext, user: string): Promise<NativeFSUserObject>;

    readFile(
        fs_context: NativeFSContext,
        path: string,
        options?: {
            read_xattr?: boolean;
            skip_user_xattr?: boolean;
            xattr_get_keys?: string[];
        },
    ): Promise<{
        data: Buffer;
        stat: NativeFSStats;
    }>;
    writeFile(fs_context: NativeFSContext, path: string, buffer: Buffer, options?: {
        mode?: number;
        xattr?: NativeFSXattr;
        xattr_try?: NativeFSXattr;
        xattr_need_fsync?: boolean;
        xattr_clear_prefix?: string;
    }): Promise<void>;
    fsync(fs_context: NativeFSContext, path: string): Promise<void>;

    rename(fs_context: NativeFSContext, from_path: string, to_path: string): Promise<void>;
    link(fs_context: NativeFSContext, from_path: string, to_path: string): Promise<void>;
    linkat(fs_context: NativeFSContext, from_path: string, to_path: string): Promise<void>;
    unlink(fs_context: NativeFSContext, path: string): Promise<void>;
    unlinkat(fs_context: NativeFSContext, path: string): Promise<void>;
    safe_link(fs_context: NativeFSContext, from_path: string, to_path: string, expect_mtime: bigint, expect_ino: number): Promise<void>;
    safe_unlink(fs_context: NativeFSContext, from_path: string, to_path: string, expect_mtime: bigint, expect_ino: number): Promise<void>;
    symlink(fs_context: NativeFSContext, target: string, linkpath: string): Promise<void>;

    readdir(fs_context: NativeFSContext, path: string): Promise<fs.Dirent[]>;
    mkdir(fs_context: NativeFSContext, path: string, mode?: number): Promise<void>;
    rmdir(fs_context: NativeFSContext, path: string): Promise<void>;

    dio_buffer_alloc(size: number): Buffer;
    set_debug_level(level: number);
    set_log_config(stderr_enabled: boolean, syslog_enabled: boolean);

    S_IFMT: number;
    S_IFDIR: number;
    S_IFLNK: number;
    DT_DIR: number;
    DT_LNK: number;
    PLATFORM_IOV_MAX: number;
    O_DIRECT?: number;
    O_TMPFILE?: number;

    gpfs?: {
        register_gpfs_noobaa(gpfs_noobaa_args: GPFSNooBaaArgs);
    };
}

interface NativeFile {
    close(fs_context: NativeFSContext): Promise<void>;
    stat(fs_context: NativeFSContext, options?: { skip_user_xattr?: boolean, xattr_get_keys?: string[] }): Promise<NativeFSStats>;
    read(fs_context: NativeFSContext, buffer: Buffer, offset: number, length: number, pos: number): Promise<number>;
    write(fs_context: NativeFSContext, buffer: Buffer, len: number, offset?: number): Promise<void>;
    writev(fs_context: NativeFSContext, buffers: Buffer[], offset?: number): Promise<void>;
    replacexattr(fs_context: NativeFSContext, xattr: NativeFSXattr, clear_prefix?: string): Promise<void>;
    linkfileat(fs_context: NativeFSContext, path: string, fd?: number): Promise<void>;
    fsync(fs_context: NativeFSContext): Promise<void>;
    fd: number;
    flock(fs_context: NativeFSContext, operation: "EXCLUSIVE" | "SHARED" | "UNLOCK"): Promise<void>;
    fcntllock(fs_context: NativeFSContext, operation: "EXCLUSIVE" | "SHARED" | "UNLOCK"): Promise<void>;
}

interface NativeDir {
    close(fs_context: NativeFSContext): Promise<void>;
    read(fs_context: NativeFSContext): Promise<fs.Dirent>;
    telldir(fs_context: NativeFSContext): Promise<bigint>;
    seekdir(fs_context: NativeFSContext, seek_pos: bigint): Promise<void>;
    // TODO
}

interface NativeFSContext {
    uid?: number;
    gid?: number;
    backend?: string;
    warn_threshold_ms?: number;
    report_fs_stats?: Function;
    do_ctime_check?: boolean;
}

type GPFSNooBaaArgs = {
    version: number;
    delay: number;
    flags: number;
};

type NativeFSXattr = { [key: string]: string };
type NativeFSStats = fs.Stats & {
    atimeNsBigint: bigint;
    ctimeNsBigint: bigint;
    mtimeNsBigint: bigint;
    xattr?: NativeFSXattr;
};

type NativeFSUserObject = {
    uid: number;
    gid: number;
    name: string;
};

interface HasherSync {
    update(buffer: Buffer): this;
    digest(): Buffer;
}

interface HasherAsync {
    update(buffer: Buffer): Promise<void>;
    digest(): Promise<Buffer>;
}

interface Nudp extends EventEmitter {
    close(): void;
    bind(port: number, address: string, callback: NodeCallback): void;
    send(msg: Buffer, callback: NodeCallback): void;
}

interface Ntcp extends EventEmitter {
    close(): void;
    bind(port: number, address: string, callback: NodeCallback): void;
    send(msg: Buffer, callback: NodeCallback): void;
}

interface ChunkSplitterState {
    min_chunk: number;
    max_chunk: number;
    avg_chunk_bits: number;
    calc_md5: boolean;
    calc_sha256: boolean;
}

interface X509Cert {
    key: string;
    cert: string;
}

interface X509Options {
    days?: number;
    dns?: string;
    owner?: X509Name;
    issuer?: X509Name;
    private?: string;
    public?: string;

}

interface X509Name {
    CN: string;
    C: string;
    ST: string;
    O: string;
}

type select_input_format =  'CSV' | 'JSON' | 'Parquet';
interface S3SelectOptions {
    query: string;
    input_format: select_input_format;
    input_serialization_format: {
        FieldDelimiter: string;
        RecordDelimiter: string;
        FileHeaderInfo: string;
    };
    records_header_buf: Buffer;
    size_bytes: number;
    fs_context: NativeFSContext;
    filepath: string;
}

interface S3Select {
    write(data: Buffer): Promise<Buffer>;
    flush(): Promise<Buffer>;
    select_parquet(): Promise<Buffer>;
}

type NodeCallback<T = void> = (err: Error | null, res?: T) => void;

type RestoreState = 'CAN_RESTORE' | 'ONGOING' | 'RESTORED';

interface RestoreStatus {
  state: nb.RestoreState;
  ongoing?: boolean;
  expiry_time?: Date;
}
