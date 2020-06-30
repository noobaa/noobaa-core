export as namespace nb;

import { ObjectId as MongoID, Binary as MongoBinary } from 'mongodb';

type Semaphore = import('../util/semaphore');
type KeysSemaphore = import('../util/keys_semaphore');
type SensitiveString = import('../util/sensitive_string');

type BigInt = number | { n: number; peta: number; };
type Region = string;
type DigestType = 'sha1' | 'sha256' | 'sha384' | 'sha512';
type CompressType = 'snappy' | 'zlib';
type CipherType = 'aes-256-gcm';
type ParityType = 'isa-c1' | 'isa-rs' | 'cm256';
type ResourceType = 'HOSTS' | 'CLOUD' | 'INTERNAL';
type NodeType =
    'BLOCK_STORE_S3' |
    'BLOCK_STORE_MONGO' |
    'BLOCK_STORE_AZURE' |
    'BLOCK_STORE_GOOGLE' |
    'BLOCK_STORE_FS' |
    'ENDPOINT_S3';
type MapByID<T> = { [id: string]: T };

interface Base {
    toJSON?(): Object | string;
    toString?(): string;
}

type ID = MongoID;
type DBBuffer = MongoBinary | Buffer;

interface System extends Base {
    _id: ID;
    name: string;
    default_chunk_config?: ChunkConfig;
    buckets_by_name: { [name: string]: Bucket };
    tiering_policies_by_name: { [name: string]: Tiering };
    tiers_by_name: { [name: string]: Tier };
    pools_by_name: { [name: string]: Pool };
    chunk_configs_by_id: { [id: string]: ChunkConfig };
}

interface Account extends Base {
    _id: ID;
    name: string;
    system: System;
    email: SensitiveString;
    next_password_change: Date;
    is_support?: boolean;
    allowed_buckets: {
        full_permission: boolean;
        permission_list: Bucket[];
    },
    access_keys: {
        access_key: SensitiveString;
        secret_key: SensitiveString;
    }[];
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
    },
    drive: {
        mount: string,
    },
    // incomplete...
}

type NodesById = { [node_id: string]: NodeAPI };

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
    tiers: {
        order: number;
        tier: Tier;
        spillover?: boolean;
        disabled?: boolean;
    }[];
}

interface TierStatus {
    pools: PoolsStatus;
    mirrors_storage: MirrorStatus[];
}

interface TieringStatus {
    [tier_id: string]: TierStatus
}

interface PoolsStatus {
    [pool_id: string]: {
        valid_for_allocation: boolean;
        num_nodes: number;
        resource_type: ResourceType;
    }
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
    };
    quota?: Object;
    storage_stats: {
        last_update: number;
    };
    lifecycle_configuration_rules?: Object;
    lambda_triggers?: Object;
}

interface NamespaceResource {
    _id: ID;
    name: string;
    system: System;
    account: Account;
    connection: Object;
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
    upload_size?: number;
    upload_started?: ID;
    create_time?: Date;
    cache_last_valid_time?: Date;
    etag: string;
    md5_b64: string;
    sha256_b64: string;
    xattr: {};
    stats: { reads: number; last_read: Date; };
    encryption: { algorithm: string; kms_key_id: string; context_b64: string; key_md5_b64: string; key_b64: string; };
    tagging: { key: string; value: string; }[],
    lock_settings: { retention: { mode: string; retain_until_date: Date; }, legal_hold: { status: string } };
}

interface ObjectInfo {
    obj_id: string;
    bucket: string;
    key: string;
    version_id: string;
    lock_settings: { retention: { mode: string; retain_until_date: Date; }, legal_hold: { status: string } };
    is_latest: boolean;
    delete_marker?: boolean;
    size: number;
    num_parts: number;
    content_type: string;
    upload_size?: number;
    upload_started?: number;
    create_time?: number;
    cache_last_valid_time?: number;
    etag: string;
    md5_b64: string;
    sha256_b64: string;
    xattr: {};
    stats: { reads: number; last_read: number; };
    encryption: { algorithm: string; kms_key_id: string; context_b64: string; key_md5_b64: string; key_b64: string; };
    tagging: { key: string; value: string; }[],
    tag_count: number;
    s3_signed_url?: string;
    capacity_size?: number;
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

interface APIClient {
    RPC_BUFFERS: Symbol;

    create_auth_token(params: object): Promise<object>;
    create_access_key_auth(params: object): Promise<object>;
    create_k8s_auth(params: object): Promise<object>;

    readonly auth: object;
    readonly account: object;
    readonly system: object;
    readonly tier: object;
    readonly node: object;
    readonly host: object;
    readonly bucket: object;
    readonly events: object;
    readonly object: object;
    readonly agent: object;
    readonly block_store: object;
    readonly stats: object;
    readonly scrubber: object;
    readonly debug: object;
    readonly redirector: object;
    readonly tiering_policy: object;
    readonly pool: object;
    readonly cluster_server: object;
    readonly cluster_internal: object;
    readonly server_inter_process: object;
    readonly hosted_agents: object;
    readonly frontend_notifications: object;
    readonly func: object;
    readonly func_node: object;
}
