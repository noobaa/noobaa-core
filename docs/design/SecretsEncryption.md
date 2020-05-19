# Encryption Master Keys

## OVERVIEW
Previously, all sensitive data (cloud pool credentials, chunk cipher keys, account sync credentials, etc.) was stored plain and un-encrypted in the DB. This poses a security threat, in which accessing the PVC of mongo would allow access to all the secrets and through that the data on the system and access to the cloud services.

By encrypting these sensitive secrets, we can make sure that even if the PVC is compromised, the data and cloud access details won’t be.

The suggestion is to use encryption keys, which will encrypt the secrets at rest (DB), for in-memory usage these secrets will be used in their decrypted format.

## GOALS
 * Encrypt/decrypt all secret keys in the DB.
 * Maintain master keys per level (aka scope or tenant):
    * root-master-key - A global key stored in KMS / HSM / Kubernetes secret (mounted through env), and used to encrypt the system level keys. 
    * system-master-key - stored in the DB, encrypted by root-master-key, and used to encrypt the account/bucket level keys
    * account-master-key - stored in the DB, encrypted by system-master-key, and used to encrypt all the cloud credentials and account S3 credentials.
    * bucket-master-key - stored in the DB, encrypted by system-master-key, and used to encrypt all the chunks cipher keys of the bucket.
 * Key rotation policies:
    * On demand - API request to rotate all keys or a specific scope (root/system/account/bucket).
    * Master keys expiry policy - set a system wide policy to expire and rotate keys automatically.
    * Chunk keys expiry policy - set a bucket/system policy to expire the chunk cipher keys which will re-generate cipher keys and re-encrypt the chunks data on the background.

## OUT OF SCOPE
Integration with external HSM or KMS is out of scope for this delivery. Using a single system-master-key would provide us an easy interface to add it later on since we would need to worry only about our top level master key.

## SOLUTION

### Hierarchy master keys tree
The following diagram illustrates a simple key hierarchy and its relationship to NooBaa entities data.
<div id="top" />
<img src="/docs/design/images/master_keys_diagram.png" />
In the figure, “Chunk” and “Account” schemas have the data we ultimately want to protect, such as chunk cipher keys, cipher iv, access keys, etc. For these scenarios, symmetric key encryption (where the same key is used both to encrypt and decrypt the data) is the norm, because it’s efficient.


The application encrypts the sensitive data using the desired master key, the desired master key itself encrypted by his master key, and so on recursively.


Keys tree is stored encrypted in the DB memory (on disk memory), and stored decrypted at run-time (on process memory) for performance.
Structure of master key document in master keys collection:

```
required: [
       '_id',
   ],
   properties: {
       _id: { objectid: true },
       description: { type: 'string' },
       // If missing - encrypted with "global" key
       // 1. ENV - Mounted key from Kubernetes secret
       // 2. HSM configuration TBD - Get key from Vault
       master_key_id: { objectid: true },
       // cipher used to provide confidentiality - computed on the compressed data
       cipher_type: { $ref: 'common_api#/definitions/cipher_type' },
       cipher_key: { binary: true },
       cipher_iv: { binary: true },
       enabled: { type: 'boolean' }
   }
```

Notice that each cipher_key and cipher_iv is stored encrypted in DB memory and stored decrypted in process runtime memory (present different values depending on memory location).
These documents are stored in the system store’s cache, and there is no need to create any transactions to the DB in order for getting them (in memory operations).

### Decryption of master keys at runtime
The master key hierarchy is decrypted lazily on demnad at the system store, and stored in memory cache for efficient runtime encryption and decryption of sensitive data.
This means that for decrypting/encrypting sensitive data with a master key, in most cases we do not need to waste compute time decrypting the master key with its master key, and so on recursively.
There will be a method which will pull the decrypted master key from the available cache (if exists), if the master key does not exist then the method will load it lazily (hence spreading the compute time to on demand and not on every system store's load).

### Global master key
The “root” or “global” master key that does not have a master key id in its document is assumed to be stored and retrieved from an external HSM or mounted environment from a Kubernetes managed secret.
The system store resolves and retrieves it on the initial load.

### Disabling/Rotating master key
Master keys are not deleted upon rotation/disabling.


This is due to the asynchronous process of propagation and re-encryption of data (mainly chunks) that was encrypted with the master key that was rotated/disabled.
The rebuild process happens in the background and is eventually consistent.
The rotated/disabled master key will be used to decrypt the data until it (data) gets re-encrypted with the new/different master key.


Data that can be re-encrypted easily will get the propagation of a new/different master key immediately (account access keys etc...), other types of data (chunk ciphers) will be re-encrypted in the background or upon demand (reads).


Chunks schema indicates the master key that it is encrypted with but it doesn’t indicate the current master key that it needs to be encrypted with. The master key that needs to encrypt the chunk should be taken from the account that is managing the bucket that the chunk was uploaded to.
This is why in addition to the background worker that will re-encrypt the needed chunks with new master keys, the system also checks the re-encryption on reads and triggers re-encryption.


Notice that rotating/disabling master keys is a potentially long operation that takes up compute time and data transfer bandwidth.

### Sensitive string in memory
Master keys will be wrapped by a sensitive string in memory, which will obfuscate them from logs or any exports of the system.

### Integrating with System Store
System Store will resolve (decrypt) all of the master keys at load and cache them in process memory as sensitive strings under the Collections of the System Store and will be accessible by their ids.


Reads of encrypted data by master keys will be decrypted at run-time (lazy load on demand).


Updates and creation of existing/new documents of collections will be saved un-encrypted but protected by a sensitive string in the cache and undergo encryption before saving them to the database.

### Integrating with MD Store
Similar to System Store integration, but we do not have a cache for MD Store.
This means that the decryption will of chunk ciphers happen at run-time on reads.


Updates and creation of existing/new documents of collections (currently chunks) will undergo encryption before saving them to the database.


Note that all master keys will be decrypted and saved as a sensitive string in the cache (System Store master keys collection), and decryption/encryption on reads and writes won’t require a recursive resolvement of master keys.

### Upgrade from previous versions
System, Accounts, Buckets master keys will be added upon upgrade from older versions.
Everything sensitive under these entities will be encrypted and updated in the database.
Chunk ciphers (buckets), will be handled like master keys rotations in the background.

### Master keys rotation/disabling policy and APIs
The end user interaction with the master keys will be realized by calling APIs on specific resources that are connected to the master keys that the user is interested in rotating.


The process of rotation/disabling is asynchronous and not immediate.


The actual encryption/decryption will be performed in the background and the methods will return an acknowledgment without encrypting/decrypting the information of the underlying entity.

The following APIs will be hosted under the system_server component (system rpc):
 * rotate_master_key - 
 This method will create a new master_key and assign it to the entity that was passed in the request.


 The previous master_key (if existed) will be detached from the entity but not deleted from the database (in order to decrypt the information of the entity).


 Schema of the method:
 ```
    rotate_master_key: {
        method: 'PUT',
        params: {
            type: 'object',
            required: ['entity', 'entity_type'],
            properties: {
                // Sensitive String
                // For each entity it's unique identifier
                // System Name, Bucket Name, Account Email
                entity: { $ref: 'common_api#/definitions/entity' },
                entity_type: {
                    type: 'string',
                    enum: ['SYSTEM', 'BUCKET', 'ACCOUNT']
                },
            }
        },
        auth: {
            system: 'admin'
        }
    }
 ```


 * disable_master_key - 
 This method will detach the master_key (if existed) from the entity but not delete it from the database (in order to decrypt the information of the entity).


 Schema of the method:
 ```
    disable_master_key: {
        method: 'PUT',
        params: {
            type: 'object',
            required: ['entity', 'entity_type'],
            properties: {
                // Sensitive String
                // For each entity it's unique identifier
                // System Name, Bucket Name, Account Email
                entity: { $ref: 'common_api#/definitions/entity' },
                entity_type: {
                    type: 'string',
                    enum: ['SYSTEM', 'BUCKET', 'ACCOUNT']
                },
            }
        },
        auth: {
            system: 'admin'
        }
    }
 ```


### TODO
 *  KMS integration plans (TODO) : Vault plan, AWS KMS plan.
 *  Who manages the rotation of the root and how it is done.
 *  Root key as Kubernetes secret who manages it and how we work with it.